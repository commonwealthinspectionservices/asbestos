import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { requireAdminApi } from "@/lib/admin-api";
import { getSupabaseAdmin } from "@/lib/supabase";
import { getStripe, captureStripeFee } from "@/lib/stripe";
import { withApiErrors } from "@/lib/api-handler";
import type { Job } from "@/lib/types";

type JobRow = Pick<Job, "id" | "project_number" | "stripe_invoice_id" | "paid_date" | "payment_reversed_at">;

// Per Tim, 2026-08-28 — real gap found by audit-stripe-invoices: 26-0007
// and 26-0008 (both Newton Fire & Flood, both on the net-30 auto-charge
// path — see lib/net30-autocharge.ts) are genuinely paid in Stripe, but
// the invoice.paid webhook that's supposed to call markJobPaid never
// landed here, so the job never learned about it. Rather than hand-editing
// those two rows, this calls the *exact same* markJobPaid/captureStripeFee
// the webhook itself would have called — so a job fixed this way ends up
// in an identical state to one the webhook handled correctly, including
// the normal just-got-paid follow-through (auto-drafting the report if it
// hasn't gone out yet — see autoDraftReportIfJustPaid).
//
// Per Tim, 2026-08-28 (round two) — this endpoint originally only checked
// the Stripe invoice's own status field, exactly the same blind spot
// audit-stripe-invoices had: a Stripe invoice stays "status: paid" forever
// even after the underlying charge is refunded. That meant this endpoint
// would happily re-mark 26-0007/26-0008 paid *again* the moment their
// payment_reversed_at flag was cleared (e.g. dismissing the "Payment
// reversed — review needed" banner in the Project Info tab) — completely
// undoing revert-refunded-payments' own fix, since nothing here knew the
// money had actually gone back. markJobPaid itself now independently
// verifies the underlying charge before ever marking a job paid (see its
// own comment in lib/lab-email.ts) — this endpoint just calls it and reads
// back what actually happened, rather than duplicating that check here
// where it could drift out of sync again.
//
// Safe to run repeatedly / GET rather than POST: every step here is
// already idempotent by the design of the functions it calls
// (markJobPaid only sets paid_date if it isn't already set, and never
// marks a refunded or already-reversed job paid; autoDraftReportIfJustPaid
// only drafts once, checking report_drafted_at first) — the same
// at-least-once-delivery assumption the real webhook is already built to
// tolerate. Only ever acts on a job whose Stripe invoice is independently
// confirmed "paid" at call time, never on say-so alone.
export const GET = withApiErrors(async (req: NextRequest) => {
  const unauthorized = requireAdminApi(req);
  if (unauthorized) return unauthorized;

  const stripe = getStripe();
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("jobs")
    .select("id, project_number, stripe_invoice_id, paid_date, payment_reversed_at")
    .not("stripe_invoice_id", "is", null)
    .is("paid_date", null)
    .is("payment_reversed_at", null);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  const jobs = (data ?? []) as unknown as JobRow[];

  const fixed: { project_number: string | null; stripe_invoice_id: string }[] = [];
  const skippedRefunded: { project_number: string | null }[] = [];
  const errors: { project_number: string | null; error: string }[] = [];

  for (const job of jobs) {
    const label = job.project_number ?? job.id;
    const invoiceId = job.stripe_invoice_id as string;
    try {
      const invoice: Stripe.Invoice = await stripe.invoices.retrieve(invoiceId);
      if (invoice.status !== "paid") continue;

      const { markJobPaid } = await import("@/lib/lab-email");
      await markJobPaid(job.id);

      const { data: after } = await supabase.from("jobs").select("paid_date, payment_reversed_at").eq("id", job.id).single();
      if (!after?.paid_date) {
        // markJobPaid found the underlying charge refunded (or already
        // flagged reversed) and set payment_reversed_at instead of paying —
        // nothing more to do here, and definitely no fee to capture for a
        // payment that isn't actually standing.
        skippedRefunded.push({ project_number: label });
        continue;
      }

      const feeCents = await captureStripeFee(stripe, invoice);
      if (feeCents != null) {
        await supabase.from("jobs").update({ stripe_fee_cents: feeCents }).eq("id", job.id);
      }
      fixed.push({ project_number: label, stripe_invoice_id: invoiceId });
    } catch (e) {
      errors.push({ project_number: label, error: e instanceof Error ? e.message : String(e) });
    }
  }

  return NextResponse.json({ scanned: jobs.length, fixed, skippedRefunded, errors });
});
