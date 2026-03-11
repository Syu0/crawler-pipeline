import { NextResponse } from "next/server";

type AnyRecord = Record<string, unknown>;

function asRecord(v: unknown): AnyRecord | null {
  return v && typeof v === "object" ? (v as AnyRecord) : null;
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function asNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim()) {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function pickNumber(...values: unknown[]): number | null {
  for (const v of values) {
    const n = asNumber(v);
    if (n !== null) return n;
  }
  return null;
}

export async function GET() {
  try {
    const base = process.env.OPENCLAW_BASE_URL?.trim();
    const token = process.env.OPENCLAW_API_TOKEN?.trim();
    const session = process.env.OPENCLAW_SESSION_ID?.trim();

    if (!base || !token || !session) {
      return NextResponse.json({ ok: false, error: "Missing OpenClaw config" }, { status: 400 });
    }

    const upstream = await fetch(`${base.replace(/\/+$/, "")}/sessions/list`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ limit: 200, messageLimit: 0 }),
      cache: "no-store",
    });

    const data = await upstream.json().catch(() => ({}));
    const sessions = asArray((asRecord(data) ?? {}).sessions);
    const current = sessions
      .map((s) => asRecord(s))
      .find((s) => {
        if (!s) return false;
        return s.key === session || s.sessionKey === session || s.id === session;
      });

    if (!current) {
      return NextResponse.json({ ok: false, sessionKey: session, error: "Session not found" }, { status: upstream.ok ? 404 : 502 });
    }

    const usage = asRecord(current.usage) ?? asRecord(current.tokenUsage) ?? null;
    const totalTokens = pickNumber(current.totalTokens, usage?.totalTokens, usage?.total, usage?.tokens);
    const contextTokens = pickNumber(current.contextTokens, current.contextWindow, current.maxContextTokens, usage?.contextTokens, usage?.contextWindow, usage?.context);

    const usagePercent =
      totalTokens !== null && contextTokens !== null && contextTokens > 0
        ? Number(((totalTokens / contextTokens) * 100).toFixed(1))
        : null;

    return NextResponse.json({
      ok: upstream.ok,
      sessionKey: String(current.key ?? current.sessionKey ?? current.id ?? session),
      totalTokens,
      contextTokens,
      usagePercent,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "session status failed";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
