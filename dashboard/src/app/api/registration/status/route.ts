import { NextRequest, NextResponse } from "next/server";
import { jobs } from "@/lib/jobs";

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("jobId") || "";
  const job = jobs.get(id);
  if (!job) return NextResponse.json({ ok: false, error: "job not found" }, { status: 404 });
  return NextResponse.json(job);
}
