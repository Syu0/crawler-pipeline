import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { qoo10PostMethod } from "./src/qoo10Client.js";


dotenv.config();

const app = express();
app.use(express.json({ limit: "2mb" }));

app.use(
  cors({
    origin: ["http://localhost:5173"],
    methods: ["GET", "POST"],
  })
);
// (선택) 카테고리 캐시
let categoryCache = { ts: 0, data: null };
const CATEGORY_TTL_MS = 6 * 60 * 60 * 1000; // 6시간

app.get("/api/qoo10/categories", async (req, res) => {
  try {
    const lang_cd = (req.query.lang_cd || "KO").toString();

    const now = Date.now();
    if (categoryCache.data && now - categoryCache.ts < CATEGORY_TTL_MS) {
      return res.json({ ok: true, cached: true, ...categoryCache.data });
    }

    const result = await qoo10PostMethod("CommonInfoLookup.GetCatagoryListAll", {
      returnType: "application/json",
      lang_cd,
    });

    categoryCache = { ts: now, data: result };
    res.json({ ok: true, cached: false, ...result });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

app.post("/api/qoo10/refresh-key", async (req, res) => {
    try {
      const { user_id, pwd } = req.body || {};
  
      if (!user_id) throw new Error("missing user_id");
      if (!pwd) throw new Error("missing pwd");
  
      const methodName = "CertificationAPI.CreateCertificationKey";
      const QAPI_BASE = "https://api.qoo10.jp/GMKT.INC.Front.QAPIService/ebayjapan.qapi";
      const url = `${QAPI_BASE}/${methodName}`;
      
      // 스펙 강제: QAPIVersion 1.0
      const qapiVersion = "1.0";
      const sellerAuthKey = process.env.QOO10_SAK;
      if (!sellerAuthKey) {
        throw new Error("Missing env QOO10_SAK (Seller Authorization Key)");
      }
  
      const params = {
        returnType: "application/json",
        user_id: String(user_id),
        pwd: String(pwd),
      };
      
      const body = new URLSearchParams(params).toString();
  
      const headers = {
        "Content-Type": "application/x-www-form-urlencoded",
        "QAPIVersion": qapiVersion,
        "GiosisCertificationKey": sellerAuthKey,
      };
  
      // 디버그 로그 (항상 출력)
      const maskSensitive = (str) => {
        return str.replace(/(user_id=)([^&]*)/gi, "$1****")
                  .replace(/(pwd=)([^&]*)/gi, "$1****");
      };
      
      if (process.env.QOO10_DEBUG === "1" || true) { // 항상 출력
        console.log(`[QOO10 REFRESH-KEY] url=${url}`);
        console.log(`[QOO10 REFRESH-KEY] QAPIVersion=${qapiVersion}`);
        console.log(`[QOO10 REFRESH-KEY] body=${maskSensitive(body)}`);
      }
  
      const fetchRes = await fetch(url, {
        method: "POST",
        headers,
        body,
      });
  
      const text = await fetchRes.text();
      let parsedData;
      try {
        parsedData = JSON.parse(text);
      } catch {
        parsedData = text;
      }
  
      // 디버그 로그: ResultCode, ResultMsg
      if (process.env.QOO10_DEBUG === "1" || true) {
        console.log(`[QOO10 REFRESH-KEY] responseStatus=${fetchRes.status}`);
        if (typeof parsedData === "object" && parsedData !== null) {
          if ("ResultCode" in parsedData) {
            console.log(`[QOO10 REFRESH-KEY] ResultCode=${parsedData.ResultCode}`);
          }
          if ("ResultMsg" in parsedData) {
            console.log(`[QOO10 REFRESH-KEY] ResultMsg=${parsedData.ResultMsg}`);
          }
        }
      }
  
      // ResultCode=-1이면 상세 정보 저장/출력
      if (parsedData?.ResultCode === -1) {
        const { writeFileSync } = await import("fs");
        const errorInfo = {
          timestamp: new Date().toISOString(),
          request: {
            url,
            qapiVersion,
            headers: {
              "Content-Type": headers["Content-Type"],
              "QAPIVersion": headers["QAPIVersion"],
              "GiosisCertificationKey": "****",
            },
            body: maskSensitive(body),
          },
          response: {
            status: fetchRes.status,
            body: text,
            parsed: parsedData,
          },
        };
  
        const errorInfoJson = JSON.stringify(errorInfo, null, 2);
        console.log("⚠️  [QOO10 REFRESH-KEY] ResultCode=-1: 상세 정보");
        console.log(errorInfoJson);
        
        try {
          const filename = `qoo10_error_${Date.now()}.json`;
          writeFileSync(filename, errorInfoJson, "utf8");
          console.log(`📄 파일 저장: ${filename}`);
        } catch (fileError) {
          console.error(`❌ 파일 저장 실패: ${fileError.message}`);
        }
      }
  
      const ok = parsedData?.ResultCode === 0;
  
      res.json({
        ok,
        status: fetchRes.status,
        data: parsedData,
        certificationKey: ok ? parsedData.ResultObject : null,
      });
    } catch (e) {
      res.status(400).json({ ok: false, error: String(e.message || e) });
    }
  });

  
//curl "http://localhost:8787/api/qoo10/shipping-groups"

app.get("/api/qoo10/shipping-groups", async (req, res) => {
  try {
    const result = await qoo10PostMethod(
      "ItemsLookup.GetSellerDeliveryGroupInfo",
      { returnType: "application/json" }
    );
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

app.post("/api/qoo10/register", async (req, res) => {
    try {
      const { secondSubCat, itemTitle, itemPrice, itemQty, availableDateType, availableDateValue } = req.body || {};
  
      // 6개 필수 파라미터 검증 강화
      if (!secondSubCat || String(secondSubCat).trim() === "") {
        throw new Error("missing or empty secondSubCat (CATE_S_CD)");
      }
      if (!itemTitle || String(itemTitle).trim() === "") {
        throw new Error("missing or empty itemTitle");
      }
      if (!itemPrice || Number(itemPrice) <= 0) {
        throw new Error("invalid itemPrice: must be > 0");
      }
      if (!itemQty || Number(itemQty) < 1) {
        throw new Error("invalid itemQty: must be >= 1");
      }
      if (availableDateType === undefined || availableDateType === null || String(availableDateType).trim() === "") {
        throw new Error("missing or empty availableDateType");
      }
      if (availableDateValue === undefined || availableDateValue === null || String(availableDateValue).trim() === "") {
        throw new Error("missing or empty availableDateValue");
      }
  
      // 기본값 설정 (빈 문자열이 절대 전송되지 않도록 보장)
      const sellerCode = req.body?.sellerCode;
      const standardImage = req.body?.standardImage;
      const itemDescription = req.body?.itemDescription;
      const taxRate = req.body?.taxRate;
      const expireDate = req.body?.expireDate;
      const adultYN = req.body?.adultYN;

      const params = {
        returnType: "application/json",
  
        // 필수 파라미터 (6개) - 반드시 채워짐
        SecondSubCat: String(secondSubCat).trim(),
        ItemTitle: String(itemTitle).trim(),
        ItemPrice: String(Number(itemPrice)),
        ItemQty: String(Number(itemQty)),
        AvailableDateType: String(availableDateType).trim(),
        AvailableDateValue: String(availableDateValue).trim(),

        // 기본값이 있는 필드들 (빈 문자열이면 기본값 사용)
        SellerCode: (sellerCode && String(sellerCode).trim() !== "") 
          ? String(sellerCode).trim() 
          : "A12345b",
        StandardImage: (standardImage && String(standardImage).trim() !== "") 
          ? String(standardImage).trim() 
          : "https://dp.image-qoo10.jp/GMKT.IMG/loading_2017/qoo10_loading.v_20170420.png",
        ItemDescription: (itemDescription && String(itemDescription).trim() !== "") 
          ? String(itemDescription).trim() 
          : '<img src="https://dp.image-qoo10.jp/GMKT.IMG/loading_2017/qoo10_loading.v_20170420.png">',
        TaxRate: (taxRate && String(taxRate).trim() !== "") 
          ? String(taxRate).trim() 
          : "10",
        ExpireDate: (expireDate && String(expireDate).trim() !== "") 
          ? String(expireDate).trim() 
          : "2030-12-31",
        AdultYN: (adultYN && String(adultYN).trim() !== "") 
          ? String(adultYN).trim() 
          : "N",

        // 기타 기본값
        ShippingNo: "0",
      };

      // 값 검증
      // StandardImage 유효성 (http/https로 시작)
      if (!/^https?:\/\//.test(params.StandardImage)) {
        throw new Error("invalid StandardImage: must start with http:// or https://");
      }
      // TaxRate 허용값만
      const validTaxRates = ["S", "10", "8", "0"];
      if (!validTaxRates.includes(params.TaxRate)) {
        throw new Error("invalid TaxRate: valid values are " + validTaxRates.join(","));
      }
  
      const result = await qoo10PostMethod("ItemsBasic.SetNewGoods", params);
  
      // 성공/실패를 프론트가 쉽게 보게 정리
      const data = result.data;
      const ok = data?.ResultCode === 0;
  
      res.json({
        ok,
        status: result.status,
        data,
        // 상품코드(필드명은 실제 성공 응답 보고 확정)
        // itemCode: data?.ResultObject?.GdNo ?? null,
      });
    } catch (e) {
      res.status(400).json({ ok: false, error: String(e.message || e) });
    }
  });
  
const port = Number(process.env.PORT || 8787);
app.listen(port, () => {
  console.log(`Backend listening on http://localhost:${port}`);
});
