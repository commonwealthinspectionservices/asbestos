import { NextRequest, NextResponse } from "next/server";
import { sendWeeklyAreaHealthDigest } from "@/lib/area-health";
import { requireCronAuth } from "@/lib/cron-auth";
import { withApiErrors } from "@/lib/api-handler";

// Reads req.headers (via requireCronAuth) — without this, Next tries to
// statically render the route at build time and throws "Dynamic server
// usage" (see the sibling cron routes' identical comment).
export const dynamic = "force-dynamic";

export const GET = withApiErrors(async (req: NextRequest) => {
  const unauthorized = requireCronAuth(req);
  if (unauthorized) return unauthorized;

  const metrics = await sendWeeklyAreaHealthDigest();
  return NextResponse.json({ ok: true, crossings: metrics.crossings.map((c) => c.key) });
});
