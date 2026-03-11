import { NextResponse } from "next/server";
import { spawn } from "child_process";
import { jobs } from "@/lib/jobs";
import { randomUUID } from "crypto";

export async function POST() {
  const id = randomUUID();
  jobs.set(id, { id, status: "running", output: "", startedAt: Date.now() });

  const cwd = process.env.REGISTRATION_WORKDIR || "../backend";
  const cmd = process.env.REGISTRATION_CMD || "npm run test:qoo10:register";

  const child = spawn(cmd, { cwd: new URL(cwd, `file://${process.cwd()}/`).pathname, shell: true });
  child.stdout.on("data", (d) => {
    const j = jobs.get(id); if (!j) return; j.output += d.toString(); jobs.set(id, j);
  });
  child.stderr.on("data", (d) => {
    const j = jobs.get(id); if (!j) return; j.output += d.toString(); jobs.set(id, j);
  });
  child.on("close", (code) => {
    const j = jobs.get(id); if (!j) return;
    j.status = code === 0 ? "done" : "error";
    j.endedAt = Date.now();
    jobs.set(id, j);
  });

  return NextResponse.json({ ok: true, jobId: id });
}
