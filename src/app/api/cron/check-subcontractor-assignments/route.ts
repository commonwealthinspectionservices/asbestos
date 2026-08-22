import { NextRequest, NextResponse } from "next/server";
import { requireCronAuth, withCronAlert } from "@/lib/cron-auth";
import { withApiErrors } from "@/lib/api-handler";
import { checkForSubcontractorAssignments } from "@/lib/subcontractor-intake";

// Reads req.headers (via requireCronAuth) — without this, Next tries to
// statically render the route at build time and throws "Dynamic server
// usage", which surfaced as this cron failing every single invocation
// once deployed (see withCronAlert's failure emails).
export const dynamic = "force-dynamic";

// Same 15-minute cadence and same "separate route per concern" reasoning
// as check-job-intake — a genuinely different kind of intake (calendar-only
// subcontracted work vs. Tim's own client jobs), kept as its own cron so a
// failure here shows up as its own line in withCronAlert instead of being
// ambiguous with job-intake's.
export const GET = withApiErrors(withCronAlert("check-subcontractor-assignments", async (req: NextRequest) => {
  const unauthorized = requireCronAuth(req);
  if (unauthorized) return unauthorized;

  const result = await checkForSubcontractorAssignments();
  return NextResponse.json({ ok: true, ...result });
}));
