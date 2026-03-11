import { NextResponse } from "next/server";

function stripTrailingSlash(s: string) {
  return s.replace(/\/+$/, "");
}

export async function POST(req: Request) {
  const requestId = `aegis-send-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  try {
    const { message } = await req.json();
    const base = process.env.AEGIS_BASE_URL?.trim();
    const token = process.env.AEGIS_API_TOKEN?.trim();
    const session = process.env.AEGIS_SESSION_ID?.trim();

    if (!base || !token || !session) {
      return NextResponse.json({ ok: false, accepted: false, error: "Missing Aegis config", requestId }, { status: 400 });
    }

    const b = stripTrailingSlash(base);

    // Try responses endpoint first, then sessions/send
    const candidates = [
      { kind: "responses", url: `${b}/v1/responses` },
      { kind: "sessions", url: `${b}/sessions/send` },
    ];

    for (const cand of candidates) {
      const upstream = await fetch(cand.url, {
        method: "POST",
        headers:
          cand.kind === "responses"
            ? {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`,
                "x-openclaw-session-key": session,
                "x-openclaw-agent-id": "main",
              }
            : {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`,
              },
        body:
          cand.kind === "responses"
            ? JSON.stringify({
                model: "openclaw:main",
                stream: false,
                input: [{ type: "message", role: "user", content: [{ type: "input_text", text: String(message ?? "") }] }],
              })
            : JSON.stringify({ sessionKey: session, message }),
      });

      const data = await upstream.json().catch(() => ({}));

      if (upstream.ok) {
        return NextResponse.json({ ok: true, accepted: true, data, requestId }, { status: 200 });
      }

      if (upstream.status !== 404 && upstream.status !== 405) break;
    }

    return NextResponse.json({ ok: false, accepted: false, error: "Aegis send failed", requestId }, { status: 502 });
  } catch (e: unknown) {
    const error = e instanceof Error ? e.message : "aegis send failed";
    return NextResponse.json({ ok: false, accepted: false, error, requestId }, { status: 500 });
  }
}
