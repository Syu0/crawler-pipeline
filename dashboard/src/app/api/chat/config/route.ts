import { NextResponse } from "next/server";

function parseVercelRequestId(raw: string | null) {
  if (!raw) return null;
  const parts = raw.split("::").filter(Boolean);
  return parts.length ? parts[parts.length - 1] : raw;
}

export async function GET(req: Request) {
  const base = (process.env.OPENCLAW_BASE_URL || "").trim();
  const session = (process.env.OPENCLAW_SESSION_ID || "").trim();
  const hasToken = Boolean(process.env.OPENCLAW_API_TOKEN);

  const vercelReqId = req.headers.get("x-vercel-id");
  const deploymentFromHeader = parseVercelRequestId(vercelReqId);

  const deploy = {
    vercelEnv: process.env.VERCEL_ENV || null,
    vercelUrl: process.env.VERCEL_URL || req.headers.get("host") || null,
    gitCommit: process.env.VERCEL_GIT_COMMIT_SHA || null,
    gitBranch: process.env.VERCEL_GIT_COMMIT_REF || null,
    deploymentId: process.env.VERCEL_DEPLOYMENT_ID || deploymentFromHeader,
    appVersion: process.env.npm_package_version || null,
  };

  return NextResponse.json({ ok: true, base, session, hasToken, deploy });
}
