import { NextResponse } from "next/server";

export async function POST(req: Request) {
  const { message } = await req.json();
  const base = process.env.OPENCLAW_BASE_URL?.trim();
  const token = process.env.OPENCLAW_API_TOKEN?.trim();
  const session = process.env.OPENCLAW_SESSION_ID?.trim();
  if (!base || !token || !session) return NextResponse.json({ ok: false, error: "Missing OpenClaw config" }, { status: 400 });

  const r = await fetch(`${base}/sessions/send`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ sessionKey: session, message }),
  });
  const d = await r.json().catch(() => ({}));
  return NextResponse.json({ ok: r.ok, data: d });
}
