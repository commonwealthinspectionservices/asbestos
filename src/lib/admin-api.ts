import { NextResponse } from "next/server";
import { requestHasAdminSession } from "@/lib/auth";

/** Returns a 401 response if the request isn't an authenticated admin session, else null. */
export function requireAdminApi(req: Request): NextResponse | null {
  if (!requestHasAdminSession(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}
