import { NextResponse } from "next/server";

export async function GET() {
  try {
    const base = process.env.OPENCLAW_BASE_URL?.trim();
    const token = process.env.OPENCLAW_API_TOKEN?.trim();
    const session = process.env.OPENCLAW_SESSION_ID?.trim();

    if (!base || !token || !session) {
      return NextResponse.json({ ok: false, error: "Missing OpenClaw config" }, { status: 400 });
    }

    const upstream = await fetch(`${base}/sessions/history`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ sessionKey: session, limit: 80 }),
      cache: "no-store",
    });

    const data = await upstream.json().catch(() => ({}));
    const raw = data.messages || data.history || [];
    const messages = raw.map((m: any) => ({
      role: m.role || "assistant",
      text: m.content || m.text || "",
      createdAt: m.createdAt || m.time || null,
    }));

    return NextResponse.json({ ok: upstream.ok, messages }, { status: upstream.ok ? 200 : 502 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message || "history failed" }, { status: 500 });
  }
}
