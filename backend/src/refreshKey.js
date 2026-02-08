import dotenv from "dotenv";
import { writeFileSync } from "fs";
import { qoo10PostMethod } from "./qoo10Client.js";

dotenv.config();

function maskSensitive(formBodyString) {
  const sensitiveKeys = ["pwd", "password", "user_id"];
  let maskedBody = formBodyString;
  sensitiveKeys.forEach((key) => {
    const regex = new RegExp(`(${key}=)([^&]*)`, "gi");
    maskedBody = maskedBody.replace(regex, (match, prefix) => {
      return prefix + "****";
    });
  });
  return maskedBody;
}

async function refreshCertificationKey(userId, password) {
  const methodName = "CertificationAPI.CreateCertificationKey";
  const QAPI_BASE = "https://api.qoo10.jp/GMKT.INC.Front.QAPIService/ebayjapan.qapi";
  const url = `${QAPI_BASE}/${methodName}`;
  
  // 스펙 강제: QAPIVersion 1.0
  const qapiVersion = "1.0";
  
  // Seller Authorization Key 확인
  const sellerAuthKey = process.env.QOO10_SAK;
  if (!sellerAuthKey) {
    throw new Error("Missing env QOO10_SAK (Seller Authorization Key)");
  }

  // Body 파라미터 준비
  const params = {
    returnType: "application/json",
    user_id: String(userId),
    pwd: String(password),
  };
  
  const body = new URLSearchParams(params).toString();
  const maskedBody = maskSensitive(body);

  const headers = {
    "Content-Type": "application/x-www-form-urlencoded",
    "QAPIVersion": qapiVersion,
    "GiosisCertificationKey": sellerAuthKey,
  };

  // 디버그 로그 출력 (항상)
  console.log("\n=== Qoo10 Certification Key Refresh Debug ===\n");
  console.log(`[DEBUG] url=${url}`);
  console.log(`[DEBUG] QAPIVersion=${qapiVersion}`);
  console.log(`[DEBUG] body=${maskedBody}`);
  console.log(`[DEBUG] GiosisCertificationKey=****\n`);

  let requestInfo = null;
  let responseText = null;
  let parsedData = null;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body,
    });

    responseText = await res.text();
    
    try {
      parsedData = JSON.parse(responseText);
    } catch {
      parsedData = responseText;
    }

    // 요청 정보 저장 (ResultCode=-1 처리용)
    requestInfo = {
      url,
      qapiVersion,
      headers: {
        "Content-Type": headers["Content-Type"],
        "QAPIVersion": headers["QAPIVersion"],
        "GiosisCertificationKey": "****",
      },
      body: maskedBody,
    };

    // 디버그 로그: ResultCode, ResultMsg
    console.log(`[DEBUG] responseStatus=${res.status}`);
    if (typeof parsedData === "object" && parsedData !== null) {
      if ("ResultCode" in parsedData) {
        console.log(`[DEBUG] ResultCode=${parsedData.ResultCode}`);
      }
      if ("ResultMsg" in parsedData) {
        console.log(`[DEBUG] ResultMsg=${parsedData.ResultMsg}`);
      }
    }
    console.log("");

    // ResultCode=-1이면 상세 정보 저장/출력
    if (parsedData?.ResultCode === -1) {
      const errorInfo = {
        timestamp: new Date().toISOString(),
        request: requestInfo,
        response: {
          status: res.status,
          body: responseText,
          parsed: parsedData,
        },
      };

      const errorInfoJson = JSON.stringify(errorInfo, null, 2);
      
      // 콘솔에 출력
      console.log("⚠️  ResultCode=-1: 상세 정보 출력 (서포트 재문의용)\n");
      console.log("─".repeat(60));
      console.log(errorInfoJson);
      console.log("─".repeat(60));
      
      // 파일로 저장
      const filename = `qoo10_error_${Date.now()}.json`;
      try {
        writeFileSync(filename, errorInfoJson, "utf8");
        console.log(`\n📄 상세 정보가 파일로 저장되었습니다: ${filename}\n`);
      } catch (fileError) {
        console.error(`\n❌ 파일 저장 실패: ${fileError.message}\n`);
      }
    }

    // 결과 출력
    if (parsedData?.ResultCode === 0 && parsedData?.ResultObject) {
      console.log("✅ SUCCESS! New Certification Key:");
      console.log("─".repeat(60));
      console.log(parsedData.ResultObject);
      console.log("─".repeat(60));
      console.log("\n📋 Copy the key above and update your .env file:");
      console.log(`   QOO10_SAK=${parsedData.ResultObject}`);
      console.log("\n");
    } else {
      console.log("❌ Failed to get certification key");
      if (parsedData?.ResultMsg) {
        console.log(`Error: ${parsedData.ResultMsg}`);
      }
      console.log("");
    }

    return { status: res.status, data: parsedData };
  } catch (error) {
    console.error("\n❌ Error:", error.message);
    console.error("");
    
    // 에러 발생 시에도 요청 정보 저장 (가능한 경우)
    if (requestInfo) {
      const errorInfo = {
        timestamp: new Date().toISOString(),
        request: requestInfo,
        error: error.message,
        response: responseText ? { raw: responseText, parsed: parsedData } : null,
      };
      
      const errorInfoJson = JSON.stringify(errorInfo, null, 2);
      console.log("─".repeat(60));
      console.log(errorInfoJson);
      console.log("─".repeat(60));
    }
    
    throw error;
  }
}

// Command line usage
const args = process.argv.slice(2);
if (args.length < 2) {
  console.error("Usage: node src/refreshKey.js <user_id> <pwd>");
  console.error("Example: node src/refreshKey.js myuser@example.com mypassword");
  process.exit(1);
}

const [userId, password] = args;
refreshCertificationKey(userId, password)
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    process.exit(1);
  });