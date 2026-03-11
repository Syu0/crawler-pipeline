import { NextResponse } from "next/server";

function asRecord(data: unknown): Record<string, unknown> | null {
  return data && typeof data === "object" ? (data as Record<string, unknown>) : null;
}

function parseMaybeJson(raw: string): unknown {
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return { raw };
  }
}

function extractError(data: unknown, fallback = "send failed") {
  const d = asRecord(data);
  if (!d) return fallback;
  if (typeof d.error === "string" && d.error.trim()) return d.error;

  const nested = asRecord(d.error);
  if (nested && typeof nested.message === "string" && nested.message.trim()) return nested.message;

  if (typeof d.message === "string" && d.message.trim()) return d.message;
  return fallback;
}

function extractReplyText(data: unknown): string | null {
  const d = asRecord(data);
  if (!d) return null;
  const output = Array.isArray(d.output) ? d.output : [];
  for (const item of output) {
    const i = asRecord(item);
    if (!i) continue;
    const content = Array.isArray(i.content) ? i.content : [];
    for (const part of content) {
      const p = asRecord(part);
      if (!p) continue;
      if (typeof p.text === "string" && p.text.trim()) return p.text;
    }
  }
  return null;
}

function stripTrailingSlash(s: string) {
  return s.replace(/\/+$/, "");
}

function getDeployMeta() {
  return {
    vercelEnv: process.env.VERCEL_ENV || null,
    vercelUrl: process.env.VERCEL_URL || null,
    gitCommit: process.env.VERCEL_GIT_COMMIT_SHA || null,
    gitBranch: process.env.VERCEL_GIT_COMMIT_REF || null,
    appVersion: process.env.npm_package_version || null,
  };
}

function buildEndpointCandidates(base: string) {
  const b = stripTrailingSlash(base);
  return [
    { kind: "responses", url: `${b}/v1/responses` },
    { kind: "sessions", url: `${b}/sessions/send` },
    { kind: "sessions", url: `${b}/api/sessions/send` },
    { kind: "sessions", url: `${b}/v1/sessions/send` },
  ];
}

export async function POST(req: Request) {
  const requestId = `send-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const deploy = getDeployMeta();

  try {
    const { message } = await req.json();
    const base = process.env.OPENCLAW_BASE_URL?.trim();
    const token = process.env.OPENCLAW_API_TOKEN?.trim();
    const session = process.env.OPENCLAW_SESSION_ID?.trim();

    if (!base || !token || !session) {
      console.error("[openclaw/send] missing_config", {
        requestId,
        deploy,
        hasBase: Boolean(base),
        hasToken: Boolean(token),
        hasSession: Boolean(session),
      });
      return NextResponse.json({ ok: false, accepted: false, error: "Missing OpenClaw config", requestId, deploy }, { status: 400 });
    }

    const attempts: Array<{ endpoint: string; mode: string; status: number; statusText: string; error: string; bodySnippet: string }> = [];

    let lastStatus = 0;
    let lastStatusText = "";
    let lastError = "upstream request failed";
    let lastData: unknown = {};
    let selectedEndpoint = "";

    for (const cand of buildEndpointCandidates(base)) {
      selectedEndpoint = cand.url;

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
                input: [
                  {
                    type: "message",
                    role: "user",
                    content: [{ type: "input_text", text: String(message ?? "") }],
                  },
                ],
              })
            : JSON.stringify({ sessionKey: session, message }),
      });

      const raw = await upstream.text();
      const data = parseMaybeJson(raw);

      const accepted = upstream.ok && (() => {
        const d = asRecord(data);
        if (!d) return true;
        if (d.ok === false) return false;
        if (d.status === "failed") return false;
        const nested = asRecord(d.error);
        if (nested && typeof nested.message === "string" && nested.message.trim()) return false;
        if (typeof d.error === "string" && d.error.trim()) return false;
        return true;
      })();

      if (accepted) {
        return NextResponse.json(
          {
            ok: true,
            accepted: true,
            status: upstream.status,
            endpoint: cand.url,
            mode: cand.kind,
            data,
            replyText: cand.kind === "responses" ? extractReplyText(data) : null,
            error: null,
            attempts,
            requestId,
            deploy,
          },
          { status: 200 },
        );
      }

      lastStatus = upstream.status;
      lastStatusText = upstream.statusText;
      lastError = extractError(data, `upstream ${upstream.status}`);
      lastData = data;

      const bodySnippet = raw.slice(0, 800);
      attempts.push({ endpoint: cand.url, mode: cand.kind, status: upstream.status, statusText: upstream.statusText, error: lastError, bodySnippet });

      console.error("[openclaw/send] upstream_error", {
        requestId,
        deploy,
        endpoint: cand.url,
        mode: cand.kind,
        status: upstream.status,
        statusText: upstream.statusText,
        error: lastError,
        bodySnippet,
      });

      if (upstream.status !== 404 && upstream.status !== 405) break;
    }

    return NextResponse.json(
      {
        ok: false,
        accepted: false,
        status: lastStatus || 502,
        statusText: lastStatusText,
        endpoint: selectedEndpoint,
        data: lastData,
        error: lastError,
        attempts,
        requestId,
        deploy,
      },
      { status: 502 },
    );
  } catch (e: unknown) {
    const error = e instanceof Error ? e.message : "send failed";
    console.error("[openclaw/send] internal_error", { requestId, deploy, error });
    return NextResponse.json({ ok: false, accepted: false, error, requestId, deploy }, { status: 500 });
  }
}
