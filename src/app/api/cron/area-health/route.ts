import { NextRequest, NextResponse } from "next/server";
import { sendWeeklyAreaHealthDigest } from "@/lib/area-health";
import { requireCronAuth } from "@/lib/cron-auth";
import { withApiErrors } from "@/lib/api-handler";

export const GET = withApiErrors(async (req: NextRequest) => {
  const unauthorized = requireCronAuth(req);
  if (unauthorized) return unauthorized;

  const metrics = await sendWeeklyAreaHealthDigest();
  return NextResponse.json({ ok: true, crossings: metrics.crossings.map((c) => c.key) });
});
