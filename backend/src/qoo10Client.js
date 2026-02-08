import dotenv from "dotenv";
dotenv.config();

const QAPI_BASE =
  "https://api.qoo10.jp/GMKT.INC.Front.QAPIService/ebayjapan.qapi";

function getSAK() {
  const sak = process.env.QOO10_SAK;
  if (!sak) throw new Error("Missing env QOO10_SAK");
  return sak;
}

function sanitizeParams(params) {
  const sanitized = {};
  
  for (const [key, value] of Object.entries(params)) {
    // undefined, null, 빈 문자열("") 제거
    if (value === undefined || value === null) {
      continue;
    }
    
    // 모든 값을 String으로 정규화
    let stringValue;
    
    if (typeof value === "string") {
      stringValue = value.trim();
      // 빈 문자열이면 제거
      if (stringValue === "") {
        continue;
      }
    } else if (Array.isArray(value)) {
      // 빈 배열 제거
      if (value.length === 0) {
        continue;
      }
      // 배열 요소를 문자열로 변환하고 빈 요소 제거
      const processedArray = value
        .map((item) => {
          if (item === null || item === undefined) return null;
          const str = String(item).trim();
          return str === "" ? null : str;
        })
        .filter((item) => item !== null);
      
      if (processedArray.length === 0) {
        continue;
      }
      stringValue = processedArray.join(",");
    } else if (typeof value === "object") {
      // 객체 처리: toString()이 "[object Object]"면 에러
      if (value.toString() === "[object Object]") {
        throw new Error(
          `Invalid parameter "${key}": plain object cannot be serialized to form-urlencoded`
        );
      }
      stringValue = String(value).trim();
      if (stringValue === "") {
        continue;
      }
    } else {
      // number, boolean 등은 String으로 변환
      stringValue = String(value).trim();
      if (stringValue === "") {
        continue;
      }
    }
    
    sanitized[key] = stringValue;
  }
  
  return sanitized;
}

function normalizeParams(params) {
  const normalized = {};
  
  for (const [key, value] of Object.entries(params)) {
    // undefined 또는 null 제거
    if (value === undefined || value === null) {
      continue;
    }
    
    // 문자열 처리: trim 후 빈 문자열이면 제거
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed === "") {
        continue;
      }
      normalized[key] = trimmed;
      continue;
    }
    
    // 배열 처리
    if (Array.isArray(value)) {
      // 빈 배열 제거
      if (value.length === 0) {
        continue;
      }
      
      // 배열 요소가 문자열인 경우 trim하고 빈 요소 제거
      const processedArray = value
        .map((item) => {
          if (typeof item === "string") {
            const trimmed = item.trim();
            return trimmed === "" ? null : trimmed;
          }
          return item;
        })
        .filter((item) => item !== null);
      
      // 처리 후 빈 배열이면 제거
      if (processedArray.length === 0) {
        continue;
      }
      
      normalized[key] = processedArray;
      continue;
    }
    
    // 객체 처리: toString()이 "[object Object]"면 에러
    if (typeof value === "object") {
      if (value.toString() === "[object Object]") {
        throw new Error(
          `Invalid parameter "${key}": plain object cannot be serialized to form-urlencoded`
        );
      }
      normalized[key] = value;
      continue;
    }
    
    // 그 외의 값은 그대로 유지 (number, boolean 등)
    normalized[key] = value;
  }
  
  return normalized;
}

function maskSensitive(formBodyString) {
  // form-urlencoded 문자열에서 민감한 키의 값을 마스킹
  const sensitiveKeys = [
    "SellerAuthKey",
    "pwd",
    "password",
    "LoginID",
    "user_id",
  ];
  
  let maskedBody = formBodyString;
  sensitiveKeys.forEach((key) => {
    // 키=값 패턴을 찾아서 값만 마스킹
    // 예: SellerAuthKey=ABCDE → SellerAuthKey=****
    // URL 인코딩된 경우도 고려: SellerAuthKey%3DABCDE → SellerAuthKey%3D****
    const regex = new RegExp(`(${key}=)([^&]*)`, "gi");
    maskedBody = maskedBody.replace(regex, (match, prefix) => {
      return prefix + "****";
    });
  });
  
  return maskedBody;
}

export async function qoo10PostMethod(methodName, params = {}) {
  const url = `${QAPI_BASE}/${methodName}`;
  
  // params 정규화: sanitizeParams로 빈 값 제거 및 String 정규화
  const sanitizedParams = sanitizeParams(params);
  const body = new URLSearchParams(sanitizedParams).toString();
  const sak = getSAK();

  // QAPIVersion 동적 선택: ItemsBasic.SetNewGoods는 1.1, 나머지는 1.0
  const qapiVersion = methodName === "ItemsBasic.SetNewGoods" ? "1.1" : "1.0";

  const headers = {
    "Content-Type": "application/x-www-form-urlencoded",
    "QAPIVersion": qapiVersion,
    "GiosisCertificationKey": sak,
  };

  // 디버그 로그 (요청 전)
  if (process.env.QOO10_DEBUG === "1") {
    const maskedHeaders = {
      "Content-Type": headers["Content-Type"],
      "QAPIVersion": headers["QAPIVersion"],
      "GiosisCertificationKey": "****",
    };
    const maskedBody = maskSensitive(body);
    
    console.log("[QOO10 DEBUG] method=" + methodName);
    console.log("[QOO10 DEBUG] url=" + url);
    console.log("[QOO10 DEBUG] headers=" + JSON.stringify(maskedHeaders));
    console.log("[QOO10 DEBUG] body=" + maskedBody);
  }


  const res = await fetch(url, {
    method: "POST",
    headers,
    body,
  });

  const text = await res.text();
  let parsedData;
  try {
    parsedData = JSON.parse(text);
  } catch {
    parsedData = text;
  }

  // 디버그 로그 (응답 후)
  if (process.env.QOO10_DEBUG === "1") {
    console.log("[QOO10 DEBUG] responseStatus=" + res.status);
    if (typeof parsedData === "object" && parsedData !== null) {
      if ("ResultCode" in parsedData || "ResultMsg" in parsedData) {
        const resultLog = {};
        if ("ResultCode" in parsedData) resultLog.ResultCode = parsedData.ResultCode;
        if ("ResultMsg" in parsedData) resultLog.ResultMsg = parsedData.ResultMsg;
        console.log("[QOO10 DEBUG] " + JSON.stringify(resultLog));
      }
    }
  }

  return { status: res.status, data: parsedData };
}