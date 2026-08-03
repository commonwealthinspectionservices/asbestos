import { NextRequest, NextResponse } from "next/server";
import { requireCronAuth } from "@/lib/cron-auth";
import { withApiErrors } from "@/lib/api-handler";
import { checkForLabResultEmails } from "@/lib/lab-email";

// Automatic replacement for the old "Check for new lab emails" button
// (removed from Settings — see checkForLabResultEmails's own doc comment).
// That button was always meant as a Phase 1 stand-in for real automation
// (see check-now/route.ts's comment); this is that automation, on a timer
// rather than real-time Gmail push (which needs a Pub/Sub subscription —
// bigger lift, revisit if polling every 15 min ever isn't fast enough).
export const GET = withApiErrors(async (req: NextRequest) => {
  const unauthorized = requireCronAuth(req);
  if (unauthorized) return unauthorized;

  const result = await checkForLabResultEmails();
  return NextResponse.json(result);
});
