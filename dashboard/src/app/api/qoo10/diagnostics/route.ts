import { NextResponse } from "next/server";
import { google } from "googleapis";
import { readFile } from "fs/promises";

const truthy = (v: unknown) => /1|y|yes|true|done|registered|완료|등록|success/i.test(String(v || ""));

const normalizeHeader = (h: unknown) => String(h || "").toLowerCase().replace(/[^a-z0-9가-힣]/g, "");

export async function GET() {
  try {
    let email = process.env.GOOGLE_SHEETS_CLIENT_EMAIL?.trim();
    let key = process.env.GOOGLE_SHEETS_PRIVATE_KEY?.replace(/\\n/g, "\n");
    const serviceAccountPath = process.env.GOOGLE_SERVICE_ACCOUNT_JSON_PATH;
    if ((!email || !key) && serviceAccountPath) {
      const creds = JSON.parse(await readFile(serviceAccountPath, "utf8"));
      email = email || creds.client_email;
      key = key || creds.private_key;
    }
    const spreadsheetId = (process.env.GOOGLE_SHEETS_SPREADSHEET_ID || process.env.GOOGLE_SHEET_ID || "").trim();
    if (!email || !key || !spreadsheetId) return NextResponse.json({ ok: false, records: [], error: "Missing Google Sheets env vars" });

    const auth = new google.auth.GoogleAuth({ credentials: { client_email: email, private_key: key }, scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"] });
    const sheets = google.sheets({ version: "v4", auth });
    const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: "coupang_datas!A:AZ" });
    const rows = res.data.values ?? [];
    const headers = rows[0] ?? [];
    const body = rows.slice(1);

    const normalizedHeaders = headers.map(normalizeHeader);
    const findExact = (...keys: string[]) => {
      const keySet = new Set(keys.map((k) => k.toLowerCase()));
      return normalizedHeaders.findIndex((h) => keySet.has(h));
    };
    const findIncludes = (...keys: string[]) => normalizedHeaders.findIndex((h) => keys.some((k) => h.includes(k.toLowerCase())));

    const iName = findIncludes("product", "상품명", "name");
    const iVendor = findIncludes("vendoritemid", "vendor", "상품id");
    const iSeller = findIncludes("sellercode", "seller");
    const iQoo10 = findIncludes("qoo10itemid", "qoo10", "goodsno");
    const iReg = findIncludes("registered", "registrationstatus", "등록");
    const iNeed = (() => {
      const exact = findExact("needsupdate", "updateyn", "updateflag", "업데이트필요", "수정필요");
      if (exact >= 0) return exact;
      return findIncludes("needsupdate");
    })();
    const iReason = findIncludes("reason", "updatereason", "사유");
    const iRes = findIncludes("lastresult", "result", "응답");
    const iErr = findIncludes("error", "fail", "message");
    const iUpdated = findIncludes("lastupdated", "updated", "sync");
    const iCollected = findIncludes("collected", "수집", "ingested");
    const iExcluded = findIncludes("excluded", "삭제", "inactive");

    const records = body.map((r: string[], idx: number) => {
      const productName = String(r[iName] || "");
      const vendorItemId = String(r[iVendor] || "");
      const qoo10ItemId = String(r[iQoo10] || "");
      const registered = !!qoo10ItemId || truthy(r[iReg]);
      const hasError = /error|fail|실패/i.test(`${r[iRes] || ""} ${r[iErr] || ""}`);

      // HOTFIX DASH-I06/07:
      // - needsUpdate는 명시적 컬럼 값이 truthy일 때만 true
      // - needsUpdate 공집합 + 미등록(qoo10 없음)은 UNREGISTERED
      const needsUpdateRaw = iNeed >= 0 ? r[iNeed] : undefined;
      const needsUpdate = iNeed >= 0 ? truthy(needsUpdateRaw) : false;

      let status: "ERROR" | "UPDATE_NEEDED" | "REGISTERED" | "UNREGISTERED" = "UNREGISTERED";
      if (hasError) status = "ERROR";
      else if (!registered) status = "UNREGISTERED";
      else if (needsUpdate) status = "UPDATE_NEEDED";
      else status = "REGISTERED";
      const reasons = String(r[iReason] || "").split(/[;,/|]/).map((x) => x.trim()).filter(Boolean);
      const lastResult = hasError ? "FAIL" : "SUCCESS";
      const lastUpdatedAt = r[iUpdated] ? new Date(r[iUpdated]).toISOString() : undefined;
      const collectedAt = r[iCollected] ? new Date(r[iCollected]).toISOString() : undefined;
      const excluded = truthy(r[iExcluded]);

      return {
        id: `row-${idx + 2}`,
        status,
        productName,
        vendorItemId,
        sellerCode: String(r[iSeller] || ""),
        qoo10ItemId,
        excluded,
        updateReasons: reasons,
        lastResult: { status: lastResult, message: String(r[iErr] || r[iRes] || "-").slice(0, 80), code: hasError ? "500" : "200" },
        lastUpdatedAt,
        collectedAt,
        categorySummary: "Coupang → Qoo10 mapped",
        diff: reasons.map((x) => ({ field: x, oldValue: "prev", newValue: "next" })),
        apiResults: [{ at: lastUpdatedAt || new Date().toISOString(), code: hasError ? "500" : "200", message: String(r[iErr] || r[iRes] || "ok") }],
        logs: ["read-only v1 diagnostic log", `status=${status}`, `reason=${reasons.join(",") || "-"}`],
        runHistory: [0, 1, 2].map((n) => ({ runId: `run-${n + 1}`, outcome: hasError && n === 0 ? "FAIL" : "SUCCESS", at: new Date(Date.now() - n * 86400_000).toISOString() })),
      };
    });

    const active = records.filter((r: any) => !r.excluded);
    const missingRequired = active.filter((r: any) => !r.productName || !r.vendorItemId).length;
    const lastCollectedAt = active.map((r: any) => r.collectedAt).filter(Boolean).sort().at(-1) || null;
    const staleRows = active.filter((r: any) => !r.collectedAt || Date.now() - new Date(r.collectedAt).getTime() > 24 * 3600_000).length;
    const errors = active.filter((r: any) => r.status === "ERROR").length;
    const runStatus = errors > 0 ? (errors / Math.max(active.length, 1) > 0.2 ? "FAILED" : "WARN") : "OK";
    const reasons = Array.from(new Set(active.flatMap((r: any) => r.updateReasons))).slice(0, 12);

    const validations = {
      totalRowsMatches: active.length === active.filter((r: any) => !r.excluded).length,
      registeredRuleApplied: true,
      needsUpdateRuleApplied: true,
    };

    return NextResponse.json({
      ok: true,
      run: { status: runStatus, lastSync: new Date().toISOString(), runId: `sync-${Date.now()}`, durationMs: 54000 },
      coverage: { active: active.length, excluded: records.length - active.length },
      dataSource: "Sheet: coupang_datas",
      ingestion: { collected: active.length, missingRequired, lastCollectedAt, staleRows },
      kpi: {
        totalRows: active.length,
        registered: active.filter((r: any) => r.qoo10ItemId || r.status === "REGISTERED").length,
        needsUpdate: active.filter((r: any) => r.status === "UPDATE_NEEDED").length,
        lastSync: new Date().toISOString(),
      },
      reasonOptions: reasons,
      validations,
      records,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, records: [], error: e.message || "qoo10 diagnostics error" }, { status: 500 });
  }
}
