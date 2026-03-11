import { NextResponse } from "next/server";
import { google } from "googleapis";
import { readFile } from "fs/promises";

export async function GET() {
  try {
    let email = process.env.GOOGLE_SHEETS_CLIENT_EMAIL?.trim();
    let key = process.env.GOOGLE_SHEETS_PRIVATE_KEY?.replace(/\\n/g, "\n");

    const serviceAccountPath = process.env.GOOGLE_SERVICE_ACCOUNT_JSON_PATH;
    if ((!email || !key) && serviceAccountPath) {
      const raw = await readFile(serviceAccountPath, "utf8");
      const creds = JSON.parse(raw);
      email = email || creds.client_email;
      key = key || creds.private_key;
    }

    const spreadsheetId = (process.env.GOOGLE_SHEETS_SPREADSHEET_ID || process.env.GOOGLE_SHEET_ID || "").trim();
    if (!email || !key || !spreadsheetId) {
      return NextResponse.json({ ok: false, error: "Missing Google Sheets env vars" }, { status: 400 });
    }

    const auth = new google.auth.GoogleAuth({
      credentials: { client_email: email, private_key: key },
      scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
    });
    const sheets = google.sheets({ version: "v4", auth });
    const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: "coupang_datas!A:Z" });
    const rows = res.data.values ?? [];
    const headers = rows[0] ?? [];
    const body = rows.slice(1);

    const idx = (keys: string[]) => headers.findIndex((h: string) => keys.some((k) => String(h).toLowerCase().includes(k)));
    const regIdx = idx(["registered", "등록", "status"]);
    const updIdx = idx(["needsupdate", "업데이트", "update"]);

    const registeredCount = regIdx >= 0 ? body.filter((r: string[]) => /1|y|yes|done|registered|완료|등록/i.test(String(r[regIdx] || ""))).length : 0;
    const needsUpdateCount = updIdx >= 0 ? body.filter((r: string[]) => /1|y|yes|need|true|필요/i.test(String(r[updIdx] || ""))).length : 0;

    return NextResponse.json({
      ok: true,
      rowCount: Math.max(rows.length - 1, 0),
      registeredCount,
      needsUpdateCount,
      lastSyncTime: new Date().toISOString(),
      headers,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message || "sheet error" }, { status: 500 });
  }
}
