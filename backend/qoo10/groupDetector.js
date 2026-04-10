'use strict';

/**
 * groupDetector.js — 멀티옵션 그룹 감지 및 시트 write-back
 *
 * ItemTitle에서 수량 패턴을 감지해 같은 베이스 상품의 변형들을 그룹핑한다.
 * MASTER(대표 등록용), SLAVE(옵션으로 묶임), SOLO(단일 상품) 역할을 부여하고
 * optionIncluded YES/NO를 적용한다.
 *
 * delta 초과(±판매가×50%) 옵션은 optionIncluded=NO로 설정되어
 * auto-register에서 SOLO_SPLIT으로 독립 등록된다.
 */

const { decideItemPriceJpy } = require('../pricing/priceDecision');

// 수량 패턴: ", X개" 로 끝나는 경우
const QUANTITY_PATTERN = /^(.+?),\s*(\d+)개$/;

/**
 * ItemTitle에서 수량 패턴 감지
 * @param {string} itemTitle
 * @returns {{ baseTitle: string, optionValue: number, patternType: string } | null}
 */
function detectGroupPattern(itemTitle) {
  const m = itemTitle?.match(QUANTITY_PATTERN);
  if (!m) return null;
  return {
    baseTitle: m[1].trim(),
    optionValue: parseInt(m[2], 10),
    patternType: 'quantity',
  };
}

/**
 * groupId 생성: GRP_{coupang_product_id}_{정규화된베이스명}
 */
function buildGroupId(coupangProductId, baseTitle) {
  const normalized = baseTitle
    .replace(/\s+/g, '_')
    .replace(/[^\w가-힣]/g, '')
    .toLowerCase();
  return `GRP_${coupangProductId}_${normalized}`;
}

/**
 * 시트 전체 rows 스캔 → 그룹 구성 → updates 배열 반환
 * write-back은 호출자(detect-groups.js)가 batchUpdate로 처리.
 *
 * @param {Array<object>} rows - coupang_datas 전체 행 (sheetSchema 키 기반 객체)
 * @param {boolean} dryRun - true면 콘솔 출력
 * @param {{ sheetsClient: object, sheetId: string }} ctx - 가격 계산용 (delta 체크)
 * @returns {Promise<Array<object>>} 변경 사항 목록
 */
async function assignGroupIds(rows, dryRun = false, ctx = {}) {
  const { sheetsClient, sheetId } = ctx;

  // 1. 패턴 감지
  const detected = rows.map((row) => {
    const pattern = detectGroupPattern(row.ItemTitle);
    return { row, pattern };
  });

  // 2. 그룹핑: (coupang_product_id, baseTitle) 기준
  const groupMap = new Map(); // groupKey → [{ row, pattern }]
  for (const item of detected) {
    if (!item.pattern) continue;
    const { baseTitle } = item.pattern;
    const pid = item.row.coupang_product_id;
    if (!pid) continue;
    const key = `${pid}::${baseTitle}`;
    if (!groupMap.has(key)) groupMap.set(key, []);
    groupMap.get(key).push(item);
  }

  // 3. 각 행에 부여할 값 계산
  const updates = []; // { row, groupId, groupRole, optionLabel, optionIncluded }

  // 패턴 감지된 행 처리
  for (const [, members] of groupMap) {
    const pid = members[0].row.coupang_product_id;
    const baseTitle = members[0].pattern.baseTitle;

    // 구성원 1개뿐이면 SOLO로 처리 (아래 SOLO 루프에서 처리)
    if (members.length === 1) continue;

    const groupId = buildGroupId(pid, baseTitle);

    // optionValue 오름차순 정렬 (MASTER = 최솟값)
    members.sort((a, b) => a.pattern.optionValue - b.pattern.optionValue);

    // delta 초과 체크: sheetsClient 있을 때만 수행
    const includedFlags = new Array(members.length).fill(true);
    if (sheetsClient && sheetId) {
      const masterRow = members[0].row;
      const masterResult = await decideItemPriceJpy({
        row: masterRow,
        vendorItemId: masterRow.vendorItemId,
        mode: 'MIGRATE',
        sheetsClient,
        sheetId,
      });

      if (!masterResult.valid) {
        console.warn(`[GroupDetector] MASTER 가격 계산 실패 (vendorItemId=${masterRow.vendorItemId}): ${masterResult.error} — delta 체크 스킵`);
      } else {
        const masterJpy = Number(masterResult.priceJpy);
        const limit = Math.floor(masterJpy * 0.5);

        for (let i = 1; i < members.length; i++) {
          const slaveRow = members[i].row;
          const slaveResult = await decideItemPriceJpy({
            row: slaveRow,
            vendorItemId: slaveRow.vendorItemId,
            mode: 'MIGRATE',
            sheetsClient,
            sheetId,
          });
          if (!slaveResult.valid) {
            console.warn(`[GroupDetector] SLAVE 가격 계산 실패 (vendorItemId=${slaveRow.vendorItemId}): ${slaveResult.error} — 포함 유지`);
            continue;
          }
          const delta = Number(slaveResult.priceJpy) - masterJpy;
          if (delta > limit) {
            includedFlags[i] = false;
            console.warn(
              `[GroupDetector] delta 초과 → SOLO 분리: ${members[i].pattern.optionValue}個 delta=${delta} limit=±${limit}`
            );
          }
        }
      }
    }

    // delta 통과 멤버 인덱스 목록
    const passedIndices = includedFlags
      .map((f, i) => (f ? i : -1))
      .filter((i) => i !== -1);

    // 50자 제한: 통과 멤버 중 최솟값+최댓값 2개만 선택
    const selectedSet = new Set(
      passedIndices.length <= 2
        ? passedIndices
        : [passedIndices[0], passedIndices[passedIndices.length - 1]]
    );

    // MASTER: selectedSet 중 최솟값 (오름차순 정렬 기준 첫 번째)
    let masterAssigned = false;
    for (let i = 0; i < members.length; i++) {
      if (!includedFlags[i]) {
        // delta 초과 → SOLO 독립 등록 대상
        updates.push({
          row: members[i].row,
          groupId: '',
          groupRole: 'SOLO',
          optionLabel: '',
          optionIncluded: '',
        });
        continue;
      }
      const included = selectedSet.has(i);
      if (!included) {
        // delta 통과했지만 50자 제한으로 제외 → SLAVE NO
        updates.push({
          row: members[i].row,
          groupId,
          groupRole: 'SLAVE',
          optionLabel: `${members[i].pattern.optionValue}個`,
          optionIncluded: 'NO',
        });
        continue;
      }
      const groupRole = !masterAssigned ? 'MASTER' : 'SLAVE';
      if (!masterAssigned) masterAssigned = true;
      updates.push({
        row: members[i].row,
        groupId,
        groupRole,
        optionLabel: `${members[i].pattern.optionValue}個`,
        optionIncluded: 'YES',
      });
    }
  }

  // 패턴 미감지 행 처리 (SOLO)
  const detectedRows = new Set(updates.map((u) => u.row.vendorItemId));
  for (const { row, pattern } of detected) {
    if (!pattern && !detectedRows.has(row.vendorItemId)) {
      updates.push({
        row,
        groupId: '',
        groupRole: 'SOLO',
        optionLabel: '',
        optionIncluded: '',
      });
    }
  }

  // 4. dry-run 출력 (updates 배열 기반)
  if (dryRun) {
    // groupId별로 묶어서 출력
    const groupIds = [...new Set(updates.filter((u) => u.groupId).map((u) => u.groupId))];
    console.log(`\n[dry-run] 감지된 그룹 수: ${groupIds.length}`);
    for (const gid of groupIds) {
      const members = updates.filter((u) => u.groupId === gid);
      const baseTitle = members[0].row.ItemTitle.replace(/,\s*\d+개$/, '').trim();
      const includedLabels = members.filter((u) => u.optionIncluded === 'YES').map((u) => u.optionLabel);
      console.log(`  ${gid} | "${baseTitle}" | 포함(${includedLabels.join(', ')})`);
    }
    const soloSplitCount = updates.filter((u) => u.groupRole === 'SOLO' && updates.some((u2) => u2.groupId && u2.row.coupang_product_id === u.row.coupang_product_id)).length;
    const soloCount = updates.filter((u) => u.groupRole === 'SOLO').length;
    console.log(`[dry-run] SOLO 행 수: ${soloCount} (delta 초과 분리: ${soloSplitCount})`);
    console.log(`[dry-run] 전체 업데이트 대상: ${updates.length}행\n`);
  }

  return updates;
}

module.exports = { detectGroupPattern, buildGroupId, assignGroupIds };
