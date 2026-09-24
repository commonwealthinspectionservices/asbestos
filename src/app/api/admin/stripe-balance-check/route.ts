import { NextRequest, NextResponse } from "next/server";
import { requireOwnerApi } from "@/lib/admin-api";
import { getSupabaseAdminFresh } from "@/lib/supabase";
import { getStripe } from "@/lib/stripe";
import { withApiErrors } from "@/lib/api-handler";
import type { Job } from "@/lib/types";
import type Stripe from "stripe";

type JobRow = Pick<Job, "id" | "project_number" | "stripe_invoice_id" | "paid_date" | "payment_reversed_at"> & {
  customers: { name: string | null; company: string | null } | null;
};

// Per Tim, 2026-09-24 — "check my Stripe and see which jobs I've been paid
// for, and which ones are currently in my balance or coming to my
// balance": every Stripe charge sits in a "pending" state for a few
// business days after it succeeds (Stripe's own standard payout hold)
// before it moves to "available" and actually becomes payout-eligible —
// completely separate from the ACH-processing gap findAchPendingJobIds
// already tracks (that one is about whether the CUSTOMER's payment even
// cleared; this one is about whether Commonwealth's OWN money has
// actually landed in the Stripe balance yet). A job already marked "paid"
// in this app can still have its dollars sitting in "pending" for days.
// Read-only — reports live Stripe data per already-paid job, changes
// nothing.
export const GET = withApiErrors(async (req: NextRequest) => {
  const unauthorized = requireOwnerApi(req);
  if (unauthorized) return unauthorized;

  const stripe = getStripe();
  const supabase = getSupabaseAdminFresh();

  const balance = await stripe.balance.retrieve();

  const { data, error } = await supabase
    .from("jobs")
    .select("id, project_number, stripe_invoice_id, paid_date, payment_reversed_at, customers!customer_id(name, company)")
    .not("paid_date", "is", null)
    .not("stripe_invoice_id", "is", null)
    .is("payment_reversed_at", null)
    .order("paid_date", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const jobs = (data ?? []) as unknown as JobRow[];

  const results = await Promise.all(
    jobs.map(async (job) => {
      const label = job.project_number ?? job.id;
      const company = job.customers?.company || job.customers?.name || null;
      try {
        const invoice = await stripe.invoices.retrieve(job.stripe_invoice_id as string);
        const chargeId = typeof invoice.charge === "string" ? invoice.charge : invoice.charge?.id ?? null;
        if (!chargeId) {
          return { project_number: label, company, paid_date: job.paid_date, amount_cents: invoice.amount_paid, status: "no_charge_found" as const };
        }
        const charge = await stripe.charges.retrieve(chargeId, { expand: ["balance_transaction"] });
        const bt = charge.balance_transaction as Stripe.BalanceTransaction | null;
        if (!bt || typeof bt === "string") {
          return { project_number: label, company, paid_date: job.paid_date, amount_cents: invoice.amount_paid, status: "no_balance_transaction" as const };
        }
        return {
          project_number: label,
          company,
          paid_date: job.paid_date,
          amount_cents: bt.amount,
          fee_cents: bt.fee,
          net_cents: bt.net,
          status: bt.status as "available" | "pending",
          available_on: new Date(bt.available_on * 1000).toISOString().slice(0, 10),
        };
      } catch (e) {
        return { project_number: label, company, paid_date: job.paid_date, status: "error" as const, error: e instanceof Error ? e.message : String(e) };
      }
    })
  );

  return NextResponse.json({
    accountBalance: {
      available: balance.available.map((b) => ({ amount_cents: b.amount, currency: b.currency })),
      pending: balance.pending.map((b) => ({ amount_cents: b.amount, currency: b.currency })),
    },
    scanned: jobs.length,
    pending: results.filter((r) => r.status === "pending"),
    available: results.filter((r) => r.status === "available"),
    other: results.filter((r) => r.status !== "pending" && r.status !== "available"),
  });
});
