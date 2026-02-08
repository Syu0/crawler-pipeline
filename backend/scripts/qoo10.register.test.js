/**
 * Qoo10 API 로컬 테스트 스크립트 (ESM)
 * - A) ItemsLookup.GetSellerDeliveryGroupInfo
 * - B) ItemsBasic.SetNewGoods (상품등록)
 * 민감정보(env 키값)는 콘솔에 출력하지 않음.
 */
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { qoo10PostMethod } from "../src/qoo10Client.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// backend/.env 로드 (스크립트 위치 기준 상위 디렉터리)
dotenv.config({ path: join(__dirname, "..", ".env") });

// ---------- SetNewGoods 테스트용 상수 (필요 시 수정) ----------
const REGISTER_PAYLOAD = {
  secondSubCat: "320002863",
  itemTitle: "test item",
  itemPrice: 4000,
  itemQty: 99,
  availableDateType: "0",
  availableDateValue: "2",
  shippingNo: "0",
};
// ------------------------------------------------------------

function printResult(label, methodName, result) {
  const { status, data } = result;
  const code = data?.ResultCode;
  const msg = data?.ResultMsg ?? "(none)";

  console.log(`\n[${label}] ${methodName}`);
  console.log(`  status: ${status}`);
  console.log(`  ResultCode: ${code}`);
  console.log(`  ResultMsg: ${msg}`);

  const ok = code === 0;
  if (!ok) {
    console.log(`  --- response (full) ---`);
    console.log(JSON.stringify(data, null, 2));
    console.log(`  -----------------------`);
  }
  return ok;
}

async function runTestA() {
  const methodName = "ItemsLookup.GetSellerDeliveryGroupInfo";
  const result = await qoo10PostMethod(methodName, { returnType: "application/json" });
  return printResult("A", methodName, result);
}

function buildSetNewGoodsParams(payload) {
  return {
    returnType: "application/json",
    SecondSubCat: String(payload.secondSubCat).trim(),
    ItemTitle: String(payload.itemTitle).trim(),
    ItemPrice: String(Number(payload.itemPrice)),
    ItemQty: String(Number(payload.itemQty)),
    AvailableDateType: String(payload.availableDateType).trim(),
    AvailableDateValue: String(payload.availableDateValue).trim(),
    ShippingNo: String(Number(payload.shippingNo ?? 0)),
    SellerCode: "A12345b",
    StandardImage: "https://dp.image-qoo10.jp/GMKT.IMG/loading_2017/qoo10_loading.v_20170420.png",
    ItemDescription: '<img src="https://dp.image-qoo10.jp/GMKT.IMG/loading_2017/qoo10_loading.v_20170420.png">',
    TaxRate: "10",
    ExpireDate: "2030-12-31",
    AdultYN: "N",
  };
}

async function runTestB() {
  const methodName = "ItemsBasic.SetNewGoods";
  const params = buildSetNewGoodsParams(REGISTER_PAYLOAD);
  const result = await qoo10PostMethod(methodName, params);
  return printResult("B", methodName, result);
}

async function main() {
  console.log("========== Qoo10 API Register Test ==========");

  try {
    const okA = await runTestA();
    const okB = await runTestB();

    console.log("\n---------- Summary ----------");
    console.log(`  A) GetSellerDeliveryGroupInfo: ${okA ? "OK" : "FAIL"}`);
    console.log(`  B) SetNewGoods:                ${okB ? "OK" : "FAIL"}`);
    console.log("--------------------------------\n");

    process.exit(okA && okB ? 0 : 1);
  } catch (err) {
    console.error("\n[ERROR]", err.message);
    console.error("(env/키값은 출력하지 않음)\n");
    process.exit(1);
  }
}

main();
