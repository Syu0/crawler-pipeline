# image-processing

쿠팡 → Qoo10 재판매 시 발생하는 **이미지 저작권 리스크**를 완화하기 위한 모듈.
2026-04-24 Qoo10 마켓 운영사 공지 "타 사이트 상품정보·이미지 무단 도용 금지" 대응으로 신설.

> ⚠️ "부분 완화"다. 원본 이미지를 입력으로 사용하는 한 저작권 침해 소지는 남는다.
> 자동 봇의 해시·EXIF 기반 적발은 회피 가능하나, 인간 신고에 대한 면책은 불가.
> 완전 면책이 필요하면 `B안 (Vision 텍스트 추출 + 자체 템플릿 재구성)` 또는 자체 촬영으로 가야 함.
> 관련: `projects/manus/TASK_IMAGE_COPYRIGHT_2026-04-24.md` (judy-brain workspace).

---

## 처리 파이프라인

```
쿠팡 원본 URL  ─[fetch]→  메모리 buffer
                            │
                            ↓ sharp.rotate() + composite(SVG 워터마크 5%) + EXIF strip
                          재가공본
                            │
                            ↓ 로컬 디스크 저장
              hosted/products/<itemCode>/{main,extra_NN}.jpg
                            │
                            ↓ Node http static (port 8787)
                            │
                            ↓ cloudflared quick tunnel (HTTPS)
              https://<random>.trycloudflare.com/images/products/<itemCode>/<file>.jpg
                            │
                            ↓ Qoo10 API (EditGoodsImage / EditGoodsMultiImage / EditGoodsContents)
                            │
                            ↓ Qoo10이 fetch → 자기 CDN(gd.image-qoo10.jp)에 복사
                          최종 노출 URL
```

> 핵심: Qoo10이 외부 URL을 **자기 CDN에 복사**함이 2026-04-25 실증됨. tunnel은 API 호출 + 동기화 30분만 살아있으면 되고, 이후엔 죽여도 상품 이미지 유지.

---

## 모듈 구성

| 파일 | 역할 |
|------|------|
| `processImage.js` | 이미지 다운로드 → EXIF strip → 워터마크 → 저장. core 유틸. |
| `server.js` | 로컬 static HTTP 서버 (포트 8787). `hosted/`를 `/images/`로 서빙. |
| `driveUploader.js` | Google Drive 업로드 (실패: SA 자체 quota 없음. 참조용 보존). |
| `inspect-sheet.js` | 시트의 이미지 컬럼 3개(StandardImage/ExtraImages/DetailImages) 분포 진단. |
| `probe-resolution.js` | 쿠팡 이미지 URL 포맷별 실제 해상도 확인. |
| `run-sample.js` | 샘플 N건 처리 → 시각 검증용. format override 지원. |
| `backfill-extraimages.js` | 시트의 ExtraImages URL을 `/492x492ex/` → `/800x800ex/`로 일괄 치환. |
| `run-qoo10-test.js` | Qoo10 EditGoodsImage 실전 1건 테스트 (랜덤 SUCCESS 1건). |
| `rollback-qoo10-image.js` | 위 테스트 롤백용. |
| **`batch-replace-phase1.js`** | **Standard + Extra 일괄 교체 배치.** idempotent (logs/batch-phase1.jsonl 기반 skip). |

### 부속 디렉토리

| 디렉토리 | 용도 | git |
|---------|------|------|
| `output/` | run-sample.js 결과. 시각 검증용. | ignored |
| `hosted/` | tunnel로 서빙되는 디렉토리. 실 판매용 재가공본 + 테스트 샘플. | ignored |
| `logs/` | 배치 실행 로그 (idempotent skip 판정용). | ignored |

---

## 운영 절차

### 0) tunnel 가동 (필요할 때만)

```bash
# Mac mini 어디서든
cd /Users/judy/dev/crawler-pipeline
node backend/image-processing/server.js &
cloudflared tunnel --url http://127.0.0.1:8787 --no-autoupdate
# 출력에서 https://<random>.trycloudflare.com URL 메모
```

quick tunnel은 매 실행 새 URL을 받는다. **API 호출 + 30분 동기화 완료 후 종료** 가능.
재가공된 이미지는 이미 Qoo10 CDN에 복사돼 있어 영향 없음.

### 1) Phase 1 — Standard + Extra 일괄 교체

```bash
cd /Users/judy/dev/crawler-pipeline
IMAGE_TUNNEL_BASE='https://<random>.trycloudflare.com' \
  node backend/image-processing/batch-replace-phase1.js          # dry-run

IMAGE_TUNNEL_BASE='https://<random>.trycloudflare.com' \
QOO10_ALLOW_REAL_REG=1 \
  node backend/image-processing/batch-replace-phase1.js --apply  # 실행
```

- 시트의 `registrationStatus=SUCCESS` + `qoo10ItemId` 있는 모든 상품 대상.
- 각 상품: `EditGoodsImage` 1회 + `EditGoodsMultiImage` 1회 (extras가 있을 때).
- `logs/batch-phase1.jsonl`에 결과 append. 재실행 시 성공한 건은 skip.
- API 사이 sleep 800ms (Qoo10 rate 안전 마진).

### 2) Phase 2 — title + DetailImages + description (이미지만, 텍스트 본문 보류)

**현재 동작** (2026-04-26):
- Title: gemma3:12b 번역 + 자동 후처리 + 9건 수동 보정 → `title-rework-output.json`의 `fixedJpTitle`
- DetailImages: 다운로드 + processImage → `hosted/products/<itemCode>/detail_NN.jpg`
- description: **이미지만** (`<p><img src="tunnel/..."/></p>` 반복). DetailImages 우선, 없으면 ExtraImages
- API 두 단계로 분리 호출:
  1. `ItemsBasic.UpdateGoods` — `ItemTitle`·`ItemDescription`·`StandardImage`·`ExtraImages` 갱신 (`batch-replace-phase2.js`)
  2. `ItemsContents.EditGoodsContents` — **상세페이지 본문 HTML** 갱신 (`batch-edit-contents.js`)

> ⚠️ **중요**: Qoo10은 description을 두 영역으로 분리 관리한다.
> - `ItemDescription` (UpdateGoods 페이로드 안) — 검색·간략 안내 영역
> - `Contents` (EditGoodsContents 별도 API) — **상세페이지 본문 HTML** (商品情報 탭 안)
>
> Phase 2에서 `UpdateGoods`만 호출하면 본문 HTML은 등록 시점의 한국어 잔존이 그대로 남는다.
> **반드시 `EditGoodsContents`도 같이 호출**해야 한다 (2026-04-28 실증).

**실행**:
```bash
cd /Users/judy/dev/crawler-pipeline

# 1) UpdateGoods (ItemTitle·ItemDescription·StandardImage·ExtraImages)
IMAGE_TUNNEL_BASE='https://<random>.trycloudflare.com' QOO10_ALLOW_REAL_REG=1 \
  node backend/image-processing/batch-replace-phase2.js --apply

# 2) EditGoodsContents (상세페이지 본문 HTML) — 반드시 같이 실행
IMAGE_TUNNEL_BASE='https://<random>.trycloudflare.com' QOO10_ALLOW_REAL_REG=1 \
  node backend/image-processing/batch-edit-contents.js --apply
```

**Idempotent**: 각 batch 별도 로그 (`logs/batch-phase2.jsonl`, `logs/batch-edit-contents.jsonl`).

**dry-run**: 두 스크립트 모두 `--apply` 빼면 dry-run.

---

### 🚧 Phase 2 보류 작업 — description 텍스트 본문 (복구 가능)

**보류 사유** (2026-04-26):
- `descriptionGenerator.js`의 Ollama vision 호출이 매번 timeout (90s) → 사실상 vision 미작동
- Text fallback (gemma3:4b 또는 gemma3:12b) 모두 한국 고유어 번역 한계: 「김」→「김」그대로 또는 「김치」오역, 브랜드명 한국어 잔존 (예: "고메이494" → "ごめい494", "캔김" → "缶김")
- titleTranslator는 KR_JP_GLOSSARY 가이드로 해결됐지만 descriptionGenerator는 동일 가이드 미적용
- 위기 모드 시간 부담: 51건 vision+text = ~1.5시간, gemma3:12b text-only = ~40분, 그래도 품질 가변
- 결론: **이미지만 반복하는 단순 description**으로 우선 처리. 텍스트 본문은 후속 사이클에 별도 처리.

**현재 description 형태** (51건):
```html
<p><img src="https://<tunnel>/images/products/<itemCode>/detail_01.jpg" /></p>
<p><img src="https://<tunnel>/images/products/<itemCode>/detail_02.jpg" /></p>
...
```

**복구 절차** (description 텍스트 본문 재생성하려면):

1. **`descriptionGenerator.js` prompt 보강** — `titleTranslator.js`의 `KR_JP_GLOSSARY` 패턴을 그대로 도입:
   - 「김」→「海苔」 (절대 「キムチ」「김パ」 금지)
   - 「곱창」→「ホルモン」
   - 「광천김」→「廣川海苔」, 「대천김」→「大川海苔」
   - 한국 브랜드명·지명 음차 카타카나 무리하지 말 것 (예: 「고메이494」→「Gomei494」 또는 한자/원어 그대로)
2. **vision 단계 검토** — Ollama vision 11b가 매번 timeout → vision 자체 사용 보류 또는 더 가벼운 모델로 교체
3. **text 모델 변경** — `OLLAMA_TEXT_MODEL=gemma3:12b` 또는 더 큰 모델
4. **batch-replace-phase2.js 코드 복원**:
   - 상단 `require('../qoo10/descriptionGenerator')` 주석 해제
   - `runOne()` 안의 description 생성 블록을 다음과 같이 교체:
     ```js
     // descGen vision 우회 + text 본문 + 이미지 임베드
     const descRow = {
       ItemTitle: rowData.ItemTitle,
       ItemDescriptionText: rowData.ItemDescriptionText || '',
       DetailImages: [],   // vision skip (또는 tunnelDetails 전달해 vision 시도)
       ExtraImages: [],
     };
     const descResult = await generateJapaneseDescription(descRow);
     let newHtml = descResult?.html || '';
     const embedUrls = tunnelDetails.length > 0 ? tunnelDetails : tunnelExtras;
     if (embedUrls.length > 0) {
       newHtml += embedUrls.map(u => `<p><img src="${u}" /></p>`).join('');
     }
     ```
5. **재실행**: `logs/batch-phase2.jsonl` 백업 후 삭제 → 51건 재처리 (idempotent log 초기화).
   - 동일 batch가 같은 itemCode에 대해 UpdateGoods 재호출 → 새 description으로 덮어쓰기.
6. **30분 동기화** + 마켓 검증.

**복구 시 보존되는 자산**:
- `title-rework-output.json` — 51건 fixedJpTitle (제목 재번역 결과). 변하지 않으니 재사용.
- `hosted/products/<itemCode>/{main,extra_NN,detail_NN}.jpg` — 모든 재가공 이미지. 재사용.
- 즉 복구 작업은 **descGen 호출 + UpdateGoods 호출만** 추가하면 됨.

**Phase 2 미완 잔존 리스크 (현 상태)**:
- description 본문에 텍스트 SEO 내용이 없음 (이미지 + placeholder만). 검색 노출은 title이 담당하므로 영향 작음.
- 단 일본 구매자가 상품 상세 페이지에서 텍스트 설명 기대 시 부족. 전환율에 부정 영향 가능.

---

### 3) 신규 수집 자동화 — Phase 3 (파이프라인 통합)

**목표**: `qoo10-auto-register` 호출 시점에 자동으로 이미지가 재가공되어 Qoo10 CDN에 들어가도록.
신규 등록 상품은 처음부터 워터마크 + EXIF strip 된 이미지로 노출됨.

#### 설계 결정 (2026-04-28)

**선택지 비교**:
- ❌ Option A: collect 시점에 재가공 + 시트의 StandardImage/ExtraImages 컬럼을 tunnel URL로 덮어쓰기
  - 단점: tunnel URL은 휘발성(cloudflared 재시작 시 변경) → 시트가 stale 될 위험. 시트는 영구·진실 소스로 유지해야 함.
- ✅ **Option B: register 시점에 재가공 + payload만 tunnel URL로 치환** (시트는 안 건드림)
  - 시트는 쿠팡 원본 URL 영구 보존. hosted/* 로컬 파일은 영구. tunnel URL은 휘발성이지만 register 호출 + 30분 동기화만 살아있으면 됨.
  - 등록 실패 시 재시도 = 같은 hosted/* 파일에 새 tunnel URL 부여 → idempotent.

**아키텍처**:
```
시트(쿠팡 URL, 영구)  ──[register 시점]──> prepareForRegister(itemCode, row)
                                              │
                                              ↓ hosted/products/<itemCode>/ 부재면 다운로드+가공
                                              │ 있으면 재사용 (idempotent)
                                              │
                                              ↓ 현재 tunnel URL을 .tunnel-base에서 읽음
                                              │
                                              ↓ { tunnelStandard, tunnelExtras[], tunnelDetails[] }
                                              │
                                              ↓ payload의 StandardImage/ExtraImages/DetailImages를 tunnel URL로 치환
                                              │
                                              ↓ registerNewGoods(payload) — Qoo10이 tunnel에서 fetch → 자기 CDN으로 복사
                                              │
                                              ↓ 30분 후 tunnel 죽여도 무관 (CDN에 영구 저장됨)
```

#### 모듈 분담

| 컴포넌트 | 역할 |
|---------|------|
| `image-processing/prepareForRegister.js` (신규) | itemCode + row → 이미지 가공·저장·tunnel URL 반환. 단일 진입점. |
| `image-processing/tunnel-daemon.sh` (신규) | cloudflared quick tunnel 가동 + URL을 `.tunnel-base`에 기록. 죽으면 재시작. |
| `.tunnel-base` (신규, gitignored) | 현재 활성 tunnel base URL (예: `https://abc123.trycloudflare.com`). register 스크립트 + batch 모두 여기서 읽음. |
| `qoo10-auto-register.js` (수정) | payload 빌드 직전 `prepareForRegister` 호출 → payload 치환. EditGoodsImage/MultiImage 별도 호출 제거. |
| `descriptionGenerator.js` (수정 예정) | row.DetailImages 대신 prepareForRegister가 준 tunnel URL 사용. 단 위기 모드 텍스트 본문 보류 중이므로 인터페이스만 추가. |
| `LaunchAgents/com.openclaw.tunnel-daemon.plist` (신규) | tunnel-daemon을 상시 가동. Mac mini 부팅 시 자동 시작. |

#### 컬럼 정책 (Phase 3 진입 후)

| 컬럼 | 정책 | 비고 |
|------|------|------|
| `StandardImage` | 쿠팡 원본 URL **유지** | 시트는 진실 소스. 가공은 register 시점 동적 처리. |
| `ExtraImages` | 쿠팡 `/800x800ex/` **유지** | 동일. |
| `DetailImages` | 쿠팡 `/q89/` **유지** | 동일. |

→ Phase 1·2에서 검토했던 `StandardImageHosted` 컬럼 추가는 **하지 않음**. tunnel URL의 휘발성 때문에 시트에 기록하는 의미가 없다.

#### 실패 모드 / 복구

- **tunnel 죽은 상태에서 register 시도** → `prepareForRegister`가 `.tunnel-base` 미존재 또는 unreachable 감지 → 명확한 에러로 abort. 시트 상태 변경 없음. tunnel-daemon 재기동 후 재시도.
- **hosted/* 파일 손실** → `prepareForRegister`가 자동 재다운로드+재가공. 단 쿠팡 원본 URL이 만료된 상품은 실패 → 사람이 재수집하거나 해당 상품 skip.
- **등록 후 30분 이내 tunnel 죽음** → Qoo10 CDN 동기화 미완 가능성 → 해당 상품 이미지 깨짐. **tunnel-daemon은 register 후 최소 30분 살아있어야 함**. LaunchAgent의 KeepAlive=true로 보장.

#### 단계별 진입 순서

1. ✅ `prepareForRegister.js` 작성 + 단위 테스트 (idempotent reuse 검증)
2. ✅ `tunnel-daemon.sh` 작성 + `.tunnel-base` 자동 갱신 로직
3. ✅ `qoo10-auto-register.js`에 통합 (payload 빌드 직전 치환 + descGen 행 override)
4. ⏳ **다음 단계**: dry-run 1건 → 실거래 1건 → 마켓 검증
5. ⏳ LaunchAgent 등록 (tunnel-daemon 상시 가동)
6. ⏳ 운영 1주 관찰 → 이상 없으면 기존 EditGoodsImage/MultiImage 호출 경로 재검토

**의존**: Phase 2 완료 (✅ 2026-04-28). Phase 3 코드 통합 완료 (2026-04-28).

#### 운영 — tunnel-daemon

**foreground 테스트**:
```bash
cd /Users/judy/dev/crawler-pipeline
bash backend/image-processing/tunnel-daemon.sh
# server + cloudflared 동시 가동, .tunnel-base에 URL 기록.
# Ctrl-C 시 둘 다 정리.
```

**상시 가동 (LaunchAgent 설치)**:
```bash
cp backend/image-processing/com.roughdiamond.tunnel-daemon.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.roughdiamond.tunnel-daemon.plist
# 부팅 시 자동 시작 + 죽으면 자동 재시작 (KeepAlive=true).
# 로그: /tmp/tunnel-daemon.log, /tmp/tunnel-daemon-error.log
```

**상태 확인**:
```bash
launchctl list | grep tunnel-daemon
cat /Users/judy/dev/crawler-pipeline/.tunnel-base    # 현재 활성 URL
curl -sf "$(cat /Users/judy/dev/crawler-pipeline/.tunnel-base)/health"
```

**중단**:
```bash
launchctl unload ~/Library/LaunchAgents/com.roughdiamond.tunnel-daemon.plist
```

#### Phase 3 코드 통합 지점 (2026-04-28)

`scripts/qoo10-auto-register.js`:
- `prepareForRegister` import 추가 (line 31).
- payload 빌드 직전 (line ~520): `prepareForRegister(vendorItemId, row)` 호출 → `tunnelStandard`/`tunnelExtras`/`tunnelDetails` 획득.
  - EXT_ 상품(쿠팡 수집 데이터 없음) 또는 StandardImage 없으면 skip.
  - tunnel 미가동·실패 시 자동 fallback (쿠팡 원본 URL 그대로 사용 → 저작권 리스크 노출, 경고 로그).
- payload의 `StandardImage`·`ExtraImages`를 tunnel URL로 치환.
- `rowForDescGen` 클론 — `DetailImages`/`ExtraImages` 컬럼만 tunnel URL로 override해서 `generateJapaneseDescription`에 전달. row 원본은 보존.

**fallback 동작 확인 방법**:
```bash
# .tunnel-base 없는 상태 (또는 IMAGE_TUNNEL_BASE 미지정) → fallback 발동
node scripts/qoo10-auto-register.js --dry-run --limit 1
# 로그에서 "[Phase3] image prep failed ... fallback to 쿠팡 원본 URL" 확인.
```

#### 검증 시나리오

| 케이스 | 기대 동작 |
|--------|----------|
| tunnel 가동 + REGISTER_READY 신규 상품 | payload에 trycloudflare URL → registerNewGoods 성공 → 30분 후 마켓 페이지에 워터마크 이미지 노출 |
| tunnel 미가동 + REGISTER_READY 신규 상품 | `[Phase3] image prep failed` 경고 → 쿠팡 원본 URL로 등록 (구공지 위반 리스크) |
| tunnel 가동 + 이미 처리된 상품 (hosted/* 존재) | `stats.reused>0`, 다운로드 0회, 빠른 응답 |
| tunnel 가동 + EXT_ 상품 | imagePrep skip (수집 데이터 없음) |

---

## 시트 컬럼 정책

| 컬럼 | 현재 정책 | 비고 |
|------|----------|------|
| `StandardImage` | 쿠팡 `/492x492ex/` 그대로 | Phase 1에선 시트 미수정. Qoo10 측만 교체. Phase 3에서 tunnel URL로 전환 검토. |
| `ExtraImages` | 쿠팡 `/800x800ex/`로 backfill 완료 (2026-04-24 backfill-extraimages.js) | 신규 수집은 `coupangApiClient.upsizeSliderUrl`이 자동 적용. |
| `DetailImages` | 쿠팡 `/q89/` 원본 해상도 | 손대지 않음 (Phase 2까지 보류). |

**왜 시트는 안 바꾸나**: 
- Phase 1·2는 Qoo10 side만 교체. 시트는 진실 소스(원본)로 남겨둠.
- 향후 재등록·복구 시 원본 URL을 알 수 있어야 함.
- Phase 3에서 시트 정책 재검토 (예: `StandardImageHosted` 컬럼 추가).

---

## 검증

### Phase 1 결과 확인 (Qoo10 마켓 동기화 ~30분 후)

랜덤 샘플 5건 마켓 페이지 접속 → 대표 이미지가 우리 워터마크가 들어간 재가공본인지 + URL이 `https://gd.image-qoo10.jp/...`로 바뀌었는지.

```bash
# itemCode → 마켓 URL
echo "https://www.qoo10.jp/g/${ITEMCODE}"
```

### 기록 위치

- 배치 로그: `backend/image-processing/logs/batch-phase1.jsonl`
- 첫 실전 검증 1건: itemCode `1200584296` (해달음 캔김), 2026-04-25 정식 재가공본 적용. URL `8195687271`(원본)→`8195719024`(TEST)→`8195899200`(정식) 3회 변경 확인.

---

## 한계 및 위험 (재기재)

1. **저작권 부분 완화**: 원본 이미지를 입력으로 사용. 인간 신고 대응 불가. 자체 촬영 또는 vision 재구성으로의 이행이 근본적 해결.
2. **tunnel URL 휘발성**: quick tunnel은 cloudflared 재시작마다 URL 변경. 동기화 전에 tunnel 죽으면 그 시점 등록은 이미지 깨짐. 향후 named tunnel(도메인 필요)로 전환 검토.
3. **Description 본문 이미지**: Phase 2 미진행 상태에서는 상세 페이지 본문에 쿠팡 원본 URL이 그대로 남음.
4. **로컬 디스크 의존**: `hosted/` 손실 시 Qoo10 등록 후 update API 재호출 불가. 정기 백업 권장 (Mac mini Time Machine 등).
