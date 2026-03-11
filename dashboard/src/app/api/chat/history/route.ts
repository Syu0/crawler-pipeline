import { NextResponse } from "next/server";

export async function GET() {
  const base = process.env.OPENCLAW_BASE_URL?.trim();
  const token = process.env.OPENCLAW_API_TOKEN?.trim();
  const session = process.env.OPENCLAW_SESSION_ID?.trim();
  if (!base || !token || !session) return NextResponse.json({ ok: false, error: "Missing OpenClaw config" }, { status: 400 });

  const r = await fetch(`${base}/sessions/history`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ sessionKey: session, limit: 50 }),
    cache: "no-store",
  });
  const d = await r.json().catch(() => ({}));

  const messages = (d.messages || d.history || []).map((m: any) => ({ role: m.role, text: m.content || m.text || "" }));
  return NextResponse.json({ ok: true, messages });
}
