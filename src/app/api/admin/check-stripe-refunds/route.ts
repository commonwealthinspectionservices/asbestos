import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { requireAdminApi } from "@/lib/admin-api";
import { getSupabaseAdmin } from "@/lib/supabase";
import { getStripe } from "@/lib/stripe";
import { withApiErrors } from "@/lib/api-handler";
import type { Job } from "@/lib/types";

type JobRow = Pick<Job, "id" | "project_number" | "stripe_invoice_id" | "paid_date" | "payment_reversed_at">;

// Per Tim, 2026-08-28 — urgent check after reconcile-stripe-paid-invoices
// marked 26-0007/26-0008 paid: that endpoint (and audit-stripe-invoices
// before it) only ever checked the Stripe *invoice*'s own status field.
// Stripe invoices stay "status: paid" forever even after the underlying
// charge is refunded — a refund lives on the Charge/PaymentIntent, not on
// the Invoice object — so neither of those checks could ever have noticed
// a job that was charged, refunded, and is now sitting incorrectly marked
// paid in our system. This is the check that was missing: for every job
// currently marked paid with a Stripe invoice on record, pull the
// invoice's underlying charge and see whether Stripe itself says it was
// refunded. Read-only — reports what it finds, changes nothing. Fixing
// any job this flags is a real business decision (was the refund actually
// warranted, does the report need pulling back) — not something to guess
// at automatically, same reasoning markJobPaymentReversed's own comment
// already gives for never auto-reverting status.
export const GET = withApiErrors(async (req: NextRequest) => {
  const unauthorized = requireAdminApi(req);
  if (unauthorized) return unauthorized;

  const stripe = getStripe();
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("jobs")
    .select("id, project_number, stripe_invoice_id, paid_date, payment_reversed_at")
    .not("stripe_invoice_id", "is", null)
    .not("paid_date", "is", null);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  const jobs = (data ?? []) as unknown as JobRow[];

  const findings: {
    project_number: string | null;
    paid_date: string | null;
    already_flagged_reversed: boolean;
    stripe_invoice_status: string;
    charge_refunded: boolean;
    amount_paid: string;
    amount_refunded: string;
  }[] = [];
  const errors: { project_number: string | null; error: string }[] = [];

  for (const job of jobs) {
    const label = job.project_number ?? job.id;
    try {
      const invoice: Stripe.Invoice = await stripe.invoices.retrieve(job.stripe_invoice_id as string);
      const chargeId = typeof invoice.charge === "string" ? invoice.charge : invoice.charge?.id ?? null;
      if (!chargeId) continue;
      const charge = await stripe.charges.retrieve(chargeId);
      if (charge.refunded || charge.amount_refunded > 0) {
        findings.push({
          project_number: label,
          paid_date: job.paid_date,
          already_flagged_reversed: Boolean(job.payment_reversed_at),
          stripe_invoice_status: invoice.status ?? "unknown",
          charge_refunded: charge.refunded,
          amount_paid: `$${(charge.amount / 100).toFixed(2)}`,
          amount_refunded: `$${(charge.amount_refunded / 100).toFixed(2)}`,
        });
      }
    } catch (e) {
      errors.push({ project_number: label, error: e instanceof Error ? e.message : String(e) });
    }
  }

  return NextResponse.json({ jobsScanned: jobs.length, findings, errors });
});
