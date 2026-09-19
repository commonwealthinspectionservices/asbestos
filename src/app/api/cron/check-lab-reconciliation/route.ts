import { NextRequest, NextResponse } from "next/server";
import { requireCronAuth, withCronAlert } from "@/lib/cron-auth";
import { withApiErrors } from "@/lib/api-handler";
import { runLabReconciliation, alertLabReconciliationProblems } from "@/lib/lab-email";

export const dynamic = "force-dynamic";

// Per Tim, 2026-09-19 — daily cross-check of Crystal's own summary reports
// against what's actually recorded on jobs (see runLabReconciliation).
// Emails the owner only when something's off, and repeats daily until it's
// fixed.
export const GET = withApiErrors(withCronAlert("check-lab-reconciliation", async (req: NextRequest) => {
  const unauthorized = requireCronAuth(req);
  if (unauthorized) return unauthorized;

  const result = await runLabReconciliation();
  const alerted = await alertLabReconciliationProblems(result);
  return NextResponse.json({ ok: true, alerted, ...result });
}));
