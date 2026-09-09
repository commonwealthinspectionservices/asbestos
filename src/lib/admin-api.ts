import { NextResponse } from "next/server";
import { requestHasAdminSession, requestSessionRole } from "@/lib/auth";

/** Returns a 401 response if the request isn't an authenticated admin session (either role), else null. */
export function requireAdminApi(req: Request): NextResponse | null {
  if (!requestHasAdminSession(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

/**
 * Owner-only gate for billing/financial routes — per Tim, 2026-09-09,
 * Joe's staff login stays locked out of billing/pricing specifically
 * (everything else on the admin side is fine for him to see). Returns
 * a 401 for no session at all (same message as requireAdminApi, so a
 * logged-out request can't tell billing routes apart from any other
 * admin route) and a 403 for a valid-but-staff session.
 */
export function requireOwnerApi(req: Request): NextResponse | null {
  const role = requestSessionRole(req);
  if (!role) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (role !== "owner") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  return null;
}
