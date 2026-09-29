import { NextRequest, NextResponse } from "next/server";
import { requireOwnerApi } from "@/lib/admin-api";
import { withApiErrors } from "@/lib/api-handler";
import { checkForSubcontractorPayments } from "@/lib/subcontractor-payment-intake";

// Owner-triggered manual run of the same pipeline the 15-minute cron
// (check-subcontractor-payments) runs automatically — same on-demand
// pattern as backfill-stripe-fees/reprocess-lab-summary, useful for
// testing without waiting for the next poll.
export const GET = withApiErrors(async (req: NextRequest) => {
  const unauthorized = requireOwnerApi(req);
  if (unauthorized) return unauthorized;

  const result = await checkForSubcontractorPayments();
  return NextResponse.json({ ok: true, ...result });
});
