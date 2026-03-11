import { NextResponse } from "next/server";

export async function GET() {
  const base = process.env.OPENCLAW_BASE_URL?.trim();
  const token = process.env.OPENCLAW_API_TOKEN?.trim();

  if (!base || !token) {
    return NextResponse.json({ ok: false, error: "Missing OpenClaw config" }, { status: 400 });
  }

  const started = Date.now();
  try {
    const r = await fetch(`${base}/status`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    const latencyMs = Date.now() - started;
    return NextResponse.json({ ok: r.ok, status: r.status, latencyMs });
  } catch (e: any) {
    return NextResponse.json({ ok: false, status: 0, latencyMs: Date.now() - started, error: e.message }, { status: 502 });
  }
}
