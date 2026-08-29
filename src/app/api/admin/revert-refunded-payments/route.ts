import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { requireAdminApi } from "@/lib/admin-api";
import { getSupabaseAdminFresh } from "@/lib/supabase";
import { getStripe } from "@/lib/stripe";
import { withApiErrors } from "@/lib/api-handler";
import type { Job } from "@/lib/types";

type JobRow = Pick<Job, "id" | "project_number" | "stripe_invoice_id" | "paid_date" | "payment_reversed_at" | "status" | "notes">;

// Per Tim, 2026-08-28 — confirmed via check-stripe-refunds: 26-0007/26-0008
// were accidentally charged and then genuinely refunded in Stripe, but
// reconcile-stripe-paid-invoices (built earlier the same day, before this
// gap was known) had already marked them paid based on the Stripe
// invoice's own status field alone — which stays "paid" forever even after
// the underlying charge is refunded. Tim explicitly confirmed ("thats ok
// yes") he wants these reverted rather than left incorrectly marked paid.
// This is the general fix, not a one-off hardcoded to those two ids: any
// job currently marked paid whose underlying Stripe charge is refunded
// gets put back to report_invoice_sent ("Payment Pending" — where a
// sent-but-unpaid job normally sits), paid_date and stripe_fee_cents
// cleared (that fee was captured against a payment that no longer stands),
// and payment_reversed_at set as the permanent audit flag — same field
// markJobPaymentReversed already uses for this exact situation, just
// applied here alongside the status/paid_date correction Tim explicitly
// asked for, which that function deliberately never does on its own.
// GET, not POST — this only ever fires when check-stripe-refunds already
// confirmed a real refund via a live Stripe lookup right before acting, so
// there's no risk of it re-triggering itself into anything destructive.
export const GET = withApiErrors(async (req: NextRequest) => {
  const unauthorized = requireAdminApi(req);
  if (unauthorized) return unauthorized;

  const stripe = getStripe();
  const supabase = getSupabaseAdminFresh();
  const { data, error } = await supabase
    .from("jobs")
    .select("id, project_number, stripe_invoice_id, paid_date, payment_reversed_at, status, notes")
    .not("stripe_invoice_id", "is", null)
    .not("paid_date", "is", null);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  const jobs = (data ?? []) as unknown as JobRow[];

  const reverted: { project_number: string | null; amount_refunded: string }[] = [];
  const errors: { project_number: string | null; error: string }[] = [];

  for (const job of jobs) {
    const label = job.project_number ?? job.id;
    try {
      const invoice: Stripe.Invoice = await stripe.invoices.retrieve(job.stripe_invoice_id as string);
      const chargeId = typeof invoice.charge === "string" ? invoice.charge : invoice.charge?.id ?? null;
      if (!chargeId) continue;
      const charge = await stripe.charges.retrieve(chargeId);
      if (!charge.refunded && charge.amount_refunded <= 0) continue;

      // Per Tim, 2026-08-28 — this call's own result was never checked, so a
      // silent write failure (permissions, a constraint, anything) would
      // still report "reverted" success here while the row never actually
      // changed — exactly indistinguishable from what's been happening.
      // select() the row back so this can report the row's real
      // post-update state, not just "no error was thrown."
      // Same audit trail as markJobPaid's own (see lib/lab-email.ts) — a
      // permanent, visible record right on the job of every time this
      // reverted it, so the timeline of "marked paid" vs. "reverted" lines
      // up on the job itself instead of needing to cross-reference logs.
      const auditLine = `[revert-refunded-payments, ${new Date().toISOString()}]`;
      const { data: updated, error: updateError } = await supabase
        .from("jobs")
        .update({
          status: "report_invoice_sent",
          paid_date: null,
          stripe_fee_cents: null,
          payment_reversed_at: job.payment_reversed_at ?? new Date().toISOString(),
          notes: job.notes ? `${job.notes}\n${auditLine}` : auditLine,
        })
        .eq("id", job.id)
        .select("status, paid_date, payment_reversed_at")
        .maybeSingle();

      if (updateError || !updated || updated.status !== "report_invoice_sent") {
        errors.push({
          project_number: label,
          error: updateError?.message ?? `update returned no error but row now reads: ${JSON.stringify(updated)}`,
        });
        continue;
      }

      reverted.push({ project_number: label, amount_refunded: `$${(charge.amount_refunded / 100).toFixed(2)}` });
    } catch (e) {
      errors.push({ project_number: label, error: e instanceof Error ? e.message : String(e) });
    }
  }

  return NextResponse.json({ jobsScanned: jobs.length, reverted, errors });
});
