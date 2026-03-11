# QOO10_FIELD_API_MAP.md

> **목적:** Qoo10 QAPI에서 각 상품 필드를 실제로 제어하는 엔드포인트를 매핑한 문서.
> **작성일:** 2026-03-05
> **데이터 출처:**
> - 공식 QAPI 문서 내부 API (`QAPI.GetQAPIMethodList`) — 4,929개 메서드 전수 조회
> - 실험적 API 탐색 + 실제 응답 분석 (테스트 아이템 ItemCode: 1194045329)

---

## 1. 핵심 발견 요약

| 구분 | 결론 |
|---|---|
| **ItemQty 전용 API** | ✅ 존재 — `ItemsOrder.SetGoodsPriceQty` (가격/수량/만료일 통합 수정) |
| **ItemDescription 전용 API** | ✅ 존재 — `ItemsContents.EditGoodsContents` (상품상세 컨텐츠 수정) |
| **UpdateGoods의 ItemQty 처리** | ❌ 반영 안 됨 — UpdateGoods는 ItemQty를 무시함 |
| **UpdateGoods의 ItemDescription 처리** | ❌ 반영 안 됨 — UpdateGoods는 ItemDetail 필드를 무시함 |
| **UpdateGoods의 ItemTitle 처리** | ✅ 즉시 반영 확인됨 |
| **재고(옵션형) 전용 API** | ✅ `ItemsOptions.UpdateInventoryQtyUnit`, `EditGoodsInventory` 등 다수 존재 |

**핵심 결론: UpdateGoods는 제목/가격 등 기본 정보만 수정. 수량은 `ItemsOrder.SetGoodsPriceQty`, 설명은 `ItemsContents.EditGoodsContents`를 사용해야 한다.**

---

## 2. 필드별 올바른 API 매핑

| Field | 올바른 API Endpoint | Update 가능 | 비고 |
|---|---|---|---|
| **ItemTitle** | `ItemsBasic.UpdateGoods` | ✅ YES | 즉시 반영 확인 |
| **ItemPrice** | `ItemsBasic.UpdateGoods` 또는 `ItemsOrder.SetGoodsPriceQty` | ✅ YES | 두 경로 모두 가능 |
| **ItemQty** | `ItemsOrder.SetGoodsPriceQty` | ✅ YES | UpdateGoods로는 불가 |
| **ItemDescription** | `ItemsContents.EditGoodsContents` | ✅ YES | UpdateGoods로는 불가 |
| **StandardImage (메인)** | `ItemsContents.EditGoodsImage` | ✅ YES | |
| **멀티 이미지** | `ItemsContents.EditGoodsMultiImage` | ✅ YES | |
| **헤더/풋터** | `ItemsContents.EditGoodsHeaderFooter` | ✅ YES | |
| **옵션 (단일형)** | `ItemsOptions.EditGoodsOption` | ✅ YES | |
| **옵션 (텍스트)** | `ItemsOptions.EditGoodsTextOption` | ✅ YES | |
| **옵션 재고 (조합형)** | `ItemsOptions.UpdateInventoryQtyUnit` | ✅ YES | 옵션별 수량 수정 |
| **옵션 재고 수량 가감** | `ItemsOptions.UpdateInventoryQtyPlusUnit` | ✅ YES | 현재 수량 기준 +/- |
| **상품 상태** | `ItemsBasic.EditGoodsStatus` | ✅ YES | S1/S2 전환 등 |
| **구매수량 제한** | `ItemsOrder.EditGoodsOrderLimit` | ✅ YES | |
| **기본 할인** | `ItemsOrder.UpdateItemDiscount` | ✅ YES | |
| **ExpireDate** | `ItemsOrder.SetGoodsPriceQty` | ✅ YES | 판매종료일 포함 |

---

## 3. 공개 QAPI 서비스 전체 목록 (display_yn=Y)

공식 문서 내부 API(`QAPI.GetQAPIMethodList`) 조회 결과 — **총 4,929개 메서드 중 공개 메서드:**

### ItemsBasic (8개)
| Method | 설명 |
|---|---|
| `SetNewGoods` | 신규 상품 등록 |
| `UpdateGoods` | 상품 기본 정보 수정 (제목, 가격 등 — 수량/설명 제외) |
| `EditGoodsStatus` | 거래상태 변경 |
| `EditItemCondition` | 상품 컨디션 수정 |
| `SetGoodsSubDeliveryGroup` | 배송 그룹 설정 |
| `SetNewMoveGoods` | MOVE 상품 신규 등록 |
| `UpdateMoveGoods` | MOVE 상품 수정 |
| `EditMoveGoodsStatus` | MOVE 상품 상태 변경 |

### ItemsOrder (6개) — **수량/가격 수정 핵심**
| Method | 설명 |
|---|---|
| **`SetGoodsPriceQty`** | **판매가격 / 재고수량 / 판매종료일 수정** |
| `SetGoodsPriceQtyBulk` | 위와 동일 (복수 처리) |
| `UpdateItemDiscount` | 기본 할인 수정 |
| `EditGoodsOrderLimit` | 구매수량 제한 수정 |
| `EditMoveGoodsPrice` | MOVE 가격 설정 |
| `UpdateMoveItemDiscount` | MOVE 기본 할인 수정 |

### ItemsContents (4개) — **설명/이미지 수정 핵심**
| Method | 설명 |
|---|---|
| **`EditGoodsContents`** | **상품 상세 컨텐츠(설명) 수정** |
| `EditGoodsImage` | 메인 이미지 수정 |
| `EditGoodsMultiImage` | 멀티 이미지 수정 |
| `EditGoodsHeaderFooter` | 상품상세 헤더/풋터 수정 |

### ItemsOptions (12개) — **옵션/재고 수정**
| Method | 설명 |
|---|---|
| `EditGoodsOption` | 단일형 옵션 수정 |
| `EditGoodsTextOption` | 텍스트 옵션 수정 |
| `EditGoodsInventory` | 옵션 정보 수정 |
| `EditCommonGoodsInventory` | 옵션 정보 수정 (공통) |
| `InsertInventoryDataUnit` | 조합형 옵션 개별 등록 |
| `UpdateInventoryDataUnit` | 조합형 옵션 개별 수정 |
| `DeleteInventoryDataUnit` | 조합형 옵션 개별 삭제 |
| `UpdateInventoryQtyUnit` | 조합형 옵션 개별 수량 수정 |
| `UpdateInventoryQtyPlusUnit` | 조합형 옵션 수량 가감 (+/-) |
| `InsertInventoryDataBulk` | 재고 정보 대량 등록 |
| `UpdateInventoryDataBulk` | 재고 정보 대량 수정 |
| `EditMoveGoodsInventory` | MOVE 옵션 정보 수정 |

### ItemsLookup (7개) — **조회**
| Method | 설명 |
|---|---|
| `GetItemDetailInfo` | 상품 상세 정보 조회 |
| `GetAllGoodsInfo` | 전체 상품 조회 |
| `GetGoodsOptionInfo` | 옵션 정보 조회 |
| `GetGoodsInventoryInfo` | **재고 정보 조회** |
| `GetSellerDeliveryGroupInfo` | 배송비 정보 조회 |
| `GetMoveItemDetailInfo` | MOVE 상품 상세 조회 |
| `RequestFileDownload` | 정보 다운로드 요청 |

### 기타 서비스
| Service | 주요 용도 |
|---|---|
| `ShippingBasic` | 배송/클레임 처리 (11개 메서드) |
| `Claim` | 취소/클레임 처리 (3개) |
| `CSCenter` | 문의 메시지 (2개) |
| `CommonInfoLookup` | 카테고리/브랜드/메이커 조회 (3개) |
| `CertificationAPI` | API 키 발급 (1개) |
| `ECouponAuth` | 이쿠폰 인증 (2개) |
| `DPCShipping` | 해외배송 (4개) |

---

## 4. v2a 수정 방향

### 현재 문제
- v2a가 `ItemsBasic.UpdateGoods`로 ItemQty, ItemDescription을 수정 시도
- UpdateGoods는 해당 필드를 수락(ResultCode=0)하지만 **실제로 무시**
- 14초 대기 후에도 값 미반영 → propagation delay가 아닌 **필드 무시**

### 수정 필요 사항

| 필드 | 기존 (잘못됨) | 수정 후 (올바름) |
|---|---|---|
| ItemQty | `ItemsBasic.UpdateGoods` | **`ItemsOrder.SetGoodsPriceQty`** |
| ItemDescription | `ItemsBasic.UpdateGoods` | **`ItemsContents.EditGoodsContents`** |
| ItemTitle | `ItemsBasic.UpdateGoods` | 그대로 유지 ✅ |

### read-back 수정
- ItemQty 수정 후 검증: `ItemsLookup.GetGoodsInventoryInfo` 또는 `GetItemDetailInfo`
- ItemDescription 수정 후 검증: `ItemsLookup.GetItemDetailInfo` (ItemDetail 필드)

---

## 5. 실험 근거

### 5-1. UpdateGoods ItemTitle 즉시 반영
- 출처: `backend/logs/qoo10-update-overwrite-proof-97437740.json` (2026-03-04)
- readBackAttempts: 1 (즉시 반영)

### 5-2. UpdateGoods ItemQty 반영 안 됨
- 출처: `backend/logs/v2a-field-discovery-v2a-1772680046718-e1gq3.jsonl` (2026-03-05)
- write_ok: true, ResultCode: 0, 14,000ms / 4 reads → 원본값 유지
- ChangedDate 갱신됨 → API 수락됐지만 해당 필드 무시

### 5-3. UpdateGoods ItemDescription 반영 안 됨
- 동일 실험, 동일 결론

### 5-4. 공식 API 목록 확인
- 출처: `swe_DynamicDataService.asmx/ExecuteToDataTable` (`QAPI.GetQAPIMethodList`)
- 4,929개 메서드 중 공개 항목 파싱
- ItemsOrder.SetGoodsPriceQty: "판매가격/재고수량/판매종료일수정" 명시
- ItemsContents.EditGoodsContents: "상품상세 컨텐츠 수정" 명시

---

## 6. 미조사 항목

- [ ] `ItemsOrder.SetGoodsPriceQty` 파라미터 상세 (m_no=10024)
- [ ] `ItemsContents.EditGoodsContents` 파라미터 상세 (m_no=10027)
- [ ] `ItemsLookup.GetGoodsInventoryInfo` 응답 구조
- [ ] QSM 웹 UI 네트워크 트래픽 캡처 (교차 검증용)

---

_Last updated: 2026-03-05 — Official API list obtained via internal document service_
