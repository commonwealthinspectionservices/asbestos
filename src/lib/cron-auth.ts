import { NextRequest, NextResponse } from "next/server";

/**
 * Verifies a cron-triggered request. Vercel Cron automatically sends
 * `Authorization: Bearer $CRON_SECRET` when a CRON_SECRET env var is set —
 * this checks that header, with a `?secret=` query param fallback for
 * manual/local testing (e.g. curl).
 */
export function requireCronAuth(req: NextRequest): NextResponse | null {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  }

  const authHeader = req.headers.get("authorization");
  const bearerToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  const queryToken = req.nextUrl.searchParams.get("secret");

  if (bearerToken === expected || queryToken === expected) {
    return null;
  }
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}
