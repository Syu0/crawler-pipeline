'use strict';

/**
 * qoo10-archive-strategy-notes.js
 * EXT_ 상품 전략 인사이트 메모를 coupang_datas 시트 strategyNote 컬럼에 기록.
 *
 * 사용:
 *   node backend/scripts/qoo10-archive-strategy-notes.js --dry-run
 *   node backend/scripts/qoo10-archive-strategy-notes.js
 */

require('dotenv').config({
  path: require('path').join(__dirname, '..', '.env'),
});

const { getSheetsClient } = require('../coupang/sheetsClient');

const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID;
const TAB = 'coupang_datas';
const DRY_RUN = process.argv.includes('--dry-run');

// 컬럼 인덱스 → A1 컬럼 문자 변환
function colLetter(idx) {
  let letter = '';
  let n = idx;
  while (n >= 0) {
    letter = String.fromCharCode((n % 26) + 65) + letter;
    n = Math.floor(n / 26) - 1;
  }
  return letter;
}

const ARCHIVE_DATA = [
  {
    qoo10ItemId: '1065693226',
    strategyNote: '[패턴A] 뷰티세럼 수요검증(112건). 토리든 신규브랜드 선점 성공. 도태=원가구조+경쟁포화. 신규K뷰티세럼 브랜드 모니터링 가치있음.',
  },
  {
    qoo10ItemId: '1065493732',
    strategyNote: '[패턴B] 미백×치약×한국산 조합 수요검증(25건). 도태=경쟁사 3PL배송단축. 수요자체는유효. 3PL가능 치약류 재탐색 가치있음.',
  },
  {
    qoo10ItemId: '1086158498',
    strategyNote: '[패턴B] 미백치약 3개세트(6건). 1065493732 동일카테고리.',
  },
  {
    qoo10ItemId: '1045951709',
    strategyNote: '[패턴C] 한국캐릭터+완구 부피큰상품 역발상틈새(27건). 경쟁사기피조건 역공략성공. 도태=쿠팡품절(전략문제아님). 품절해제시 재등록 가치있음.',
  },
  {
    qoo10ItemId: '1048261233',
    strategyNote: '[패턴A] 워터밤축제 트렌드선점(34건). 한국문화 일본도입 타이밍포착 성공. 도태=경쟁포화. 유사 문화크로스보더 트렌드감지 패턴으로 활용가치있음.',
  },
  {
    qoo10ItemId: '1072078947',
    strategyNote: '[패턴B] 라로슈포제 시카+비타민C 성분트렌드(7건). 도태원인불명확(트렌드소멸or경쟁). 뷰티성분 키워드 트렌드모니터링 가치있음.',
  },
  {
    qoo10ItemId: '1083256428',
    strategyNote: '[패턴B] 비타민C앰플 뷰티성분 트렌드수요(6건). 1072078947 동일패턴.',
  },
  {
    qoo10ItemId: '1040943931',
    strategyNote: '[패턴B] 오트밀미니바이트 대용량(26건). judy-ops 연결됨. 식품 수요검증 완료.',
  },
  {
    qoo10ItemId: '1037952073',
    strategyNote: '[패턴B] 오트밀미니바이트 1+1(9건). judy-ops 연결됨.',
  },
  {
    qoo10ItemId: '1045928388',
    strategyNote: '[패턴B] 오트밀미니바이트 초코(9건). judy-ops 연결됨.',
  },
  {
    qoo10ItemId: '1061622381',
    strategyNote: '[패턴B] 오트밀미니바이트 1kg(4건). judy-ops 연결됨.',
  },
  {
    qoo10ItemId: '1045797129',
    strategyNote: '[패턴B] 오트밀초코 크리스피 3봉(8건). judy-ops 연결됨.',
  },
  {
    qoo10ItemId: '1065424766',
    strategyNote: '[패턴B] 그라놀라 250g(6건). judy-ops 연결됨.',
  },
  {
    qoo10ItemId: '1066257031',
    strategyNote: '[패턴B] 까르보불닭 컵라면세트(6건). 한국라면 카테고리 수요검증.',
  },
  {
    qoo10ItemId: '1042619085',
    strategyNote: '[패턴B] 삼양불닭볶음면 대용량세트(6건). 한국라면 카테고리.',
  },
  {
    qoo10ItemId: '1066261696',
    strategyNote: '[패턴B] 불닭볶음면 4종세트(3건). 한국라면 카테고리.',
  },
  {
    qoo10ItemId: '1059812958',
    strategyNote: '[패턴B] 한국라면 골라담기세트(5건). 커스텀구성 포맷 흥미로움.',
  },
  {
    qoo10ItemId: '1041262600',
    strategyNote: '[패턴C] 포로로 봉제인형 대용량세트(8건). 한국캐릭터 완구. judy-ops 연결됨.',
  },
  {
    qoo10ItemId: '1040962793',
    strategyNote: '[패턴C] 로보카폴리 완구(4건). 한국캐릭터 완구.',
  },
  {
    qoo10ItemId: '1040964829',
    strategyNote: '[패턴C] 로보카폴리 완구(3건). 한국캐릭터 완구.',
  },
  {
    qoo10ItemId: '1050612037',
    strategyNote: '[패턴A] BTS타이니탄 공식굿즈(12건). 공식굿즈 공급어려움. K팝굿즈 카테고리 수요확인.',
  },
  {
    qoo10ItemId: '1039429814',
    strategyNote: '[생산중단] 수요있었으나 공급불가 확인. 거래폐지 처리.',
  },
  {
    qoo10ItemId: '1042190609',
    strategyNote: '[패턴B] 초코미니바이트(13건). 오트밀/초코스낵 카테고리 수요검증.',
  },
];

async function main() {
  if (!SPREADSHEET_ID) {
    console.error('[archive] ERROR: GOOGLE_SHEET_ID가 설정되지 않았습니다.');
    process.exit(1);
  }

  console.log(`[archive] ${DRY_RUN ? '--- DRY-RUN ---' : '--- REAL ---'}`);
  console.log(`[archive] 아카이빙 대상: ${ARCHIVE_DATA.length}개`);

  const sheets = await getSheetsClient();

  // 시트 전체 읽기
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${TAB}!A:ZZ`,
  });

  const rows = res.data.values || [];
  if (rows.length < 2) {
    console.log('[archive] 데이터가 없습니다. 종료합니다.');
    return;
  }

  const headers = rows[0];
  const qoo10IdIdx    = headers.indexOf('qoo10ItemId');
  const strategyIdx   = headers.indexOf('strategyNote');
  const vendorItemIdx = headers.indexOf('vendorItemId');

  if (qoo10IdIdx === -1) {
    console.error('[archive] ERROR: qoo10ItemId 컬럼 없음');
    process.exit(1);
  }
  if (strategyIdx === -1) {
    console.error('[archive] ERROR: strategyNote 컬럼 없음 — npm run sheets:setup 먼저 실행하세요');
    process.exit(1);
  }

  // qoo10ItemId → sheet row number (1-based, 헤더=1이므로 데이터 시작=2)
  const idToSheetRow = new Map();
  for (let i = 1; i < rows.length; i++) {
    const id = (rows[i][qoo10IdIdx] || '').trim();
    if (id) idToSheetRow.set(id, i + 1); // sheet row = array index + 1
  }

  let matched = 0;
  let notFound = 0;
  const updates = [];

  for (const entry of ARCHIVE_DATA) {
    const sheetRow = idToSheetRow.get(entry.qoo10ItemId);
    if (sheetRow === undefined) {
      console.warn(`[WARN] 미매칭: qoo10ItemId=${entry.qoo10ItemId}`);
      notFound++;
      continue;
    }
    const vendorItemId = rows[sheetRow - 1][vendorItemIdx] || '-';
    matched++;
    console.log(`[MATCH] ${entry.qoo10ItemId} (vendorItemId=${vendorItemId}) → row ${sheetRow} | ${entry.strategyNote.slice(0, 50)}...`);
    updates.push({ sheetRow, note: entry.strategyNote });
  }

  console.log(`\n매칭 결과: ${matched}/${ARCHIVE_DATA.length} (미매칭 ${notFound}개)`);

  if (DRY_RUN) {
    console.log('[archive] dry-run 완료. 시트 쓰기 건너뜀.');
    return;
  }

  if (updates.length === 0) {
    console.log('[archive] 업데이트할 행 없음.');
    return;
  }

  // batchUpdate로 일괄 write
  const noteCol = colLetter(strategyIdx);
  const batchData = updates.map(({ sheetRow, note }) => ({
    range: `${TAB}!${noteCol}${sheetRow}`,
    values: [[note]],
  }));

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: {
      valueInputOption: 'RAW',
      data: batchData,
    },
  });

  console.log(`[archive] 완료: ${updates.length}개 행 strategyNote 업데이트.`);
}

main().catch(err => {
  console.error('[archive] 오류:', err.message);
  process.exit(1);
});
