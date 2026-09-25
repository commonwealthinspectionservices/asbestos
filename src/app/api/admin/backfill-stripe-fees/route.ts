import { NextRequest, NextResponse } from "next/server";
import { requireOwnerApi } from "@/lib/admin-api";
import { backfillMissingStripeFees } from "@/lib/stripe-fee-backfill";
import { withApiErrors } from "@/lib/api-handler";

// Per Tim, 2026-09-23 — "rev and earnings page still missing stripe fees":
// audit-invoices (and this page's own "Stripe fee not recorded" list) only
// ever flagged this gap, never fixed it — reconcile-stripe-paid-invoices
// doesn't cover it either, since that route only touches jobs NOT yet
// marked paid (`is("paid_date", null)`), and this gap is specifically
// about jobs that already ARE marked paid but never got their fee. Same
// captureStripeFee already used elsewhere (reconcile-stripe-paid-invoices,
// the webhook itself) — it already returns null on its own for a charge
// whose balance transaction isn't finalized yet (still-processing ACH),
// so this is safe to run repeatedly: each run just fills in whatever's
// actually ready by then, same idempotent-GET pattern as every other
// audit/reconcile route here.
export const GET = withApiErrors(async (req: NextRequest) => {
  const unauthorized = requireOwnerApi(req);
  if (unauthorized) return unauthorized;

  // The 15-minute cron (check-sent-drafts) now runs this same backfill on
  // its own for recent payments — this stays as the manual, all-time run.
  return NextResponse.json(await backfillMissingStripeFees());
});
