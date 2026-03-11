import { NextRequest, NextResponse } from "next/server";

export function middleware(req: NextRequest) {
  const pass = (process.env.DASHBOARD_PASSCODE || "judy").trim();

  const auth = req.headers.get("authorization") || "";
  if (!auth.startsWith("Basic ")) {
    return new NextResponse("Auth required", { status: 401, headers: { "WWW-Authenticate": 'Basic realm="RoughDiamond"' } });
  }

  const [, encoded] = auth.split(" ");
  const decoded = atob(encoded);
  const [, password] = decoded.split(":");
  if (password !== pass) {
    return new NextResponse("Unauthorized", { status: 401, headers: { "WWW-Authenticate": 'Basic realm="RoughDiamond"' } });
  }
  return NextResponse.next();
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
