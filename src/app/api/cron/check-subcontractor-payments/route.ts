import { NextRequest, NextResponse } from "next/server";
import { requireCronAuth, withCronAlert } from "@/lib/cron-auth";
import { withApiErrors } from "@/lib/api-handler";
import { checkForSubcontractorPayments } from "@/lib/subcontractor-payment-intake";

export const dynamic = "force-dynamic";

// Polls every 15 minutes (see vercel.json), same cadence as check-job-intake
// — Fast Mold Testing's invoice and Mercury's payment confirmation are each
// their own emails, so this shows up as its own line in the
// automation-failure alerting (withCronAlert) rather than folded into an
// unrelated cron.
export const GET = withApiErrors(withCronAlert("check-subcontractor-payments", async (req: NextRequest) => {
  const unauthorized = requireCronAuth(req);
  if (unauthorized) return unauthorized;

  const result = await checkForSubcontractorPayments();
  return NextResponse.json({ ok: true, ...result });
}));
