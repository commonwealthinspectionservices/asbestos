import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-api";
import { getSupabaseAdminFresh } from "@/lib/supabase";
import { getStripe, captureStripeFee } from "@/lib/stripe";
import { withApiErrors } from "@/lib/api-handler";
import type { Job } from "@/lib/types";

// One-off, per Tim, 2026-09-12 — audit-invoices flagged 26-0014 and
// 26-0026 as paid via Stripe with no processing fee ever recorded.
// reconcile-stripe-paid-invoices doesn't cover this case — it only scans
// jobs with paid_date still null (a job the webhook never marked paid at
// all), not an already-paid job that's just missing this one field. Reuses
// the exact same captureStripeFee helper that route and the webhook both
// call, so the result is identical to what would have been recorded at
// payment time. Delete after running once.
type JobRow = Pick<Job, "id" | "project_number" | "stripe_invoice_id" | "paid_date" | "stripe_fee_cents" | "payment_reversed_at">;

export const GET = withApiErrors(async (req: NextRequest) => {
  const unauthorized = requireAdminApi(req);
  if (unauthorized) return unauthorized;

  const stripe = getStripe();
  const supabase = getSupabaseAdminFresh();
  // select("*") with no filter naming stripe_fee_cents — same PostgREST
  // schema-cache quirk audit-invoices' own select("*") + JS-side filtering
  // already works around: any query that explicitly names this column
  // (select list or a .is()/.eq() filter) 500s with "column
  // jobs.stripe_fee_cents does not exist", even though it's a real column
  // with real values on other rows — its schema-cache entry seems to be the
  // one stale/missing, not the column itself. Filtered in JS below instead.
  const { data, error } = await supabase
    .from("jobs")
    .select("*")
    .not("stripe_invoice_id", "is", null)
    .not("paid_date", "is", null)
    .is("payment_reversed_at", null);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  const jobs = ((data ?? []) as unknown as JobRow[]).filter((job) => !job.stripe_fee_cents);

  const fixed: { project_number: string | null; fee_cents: number }[] = [];
  const noFee: { project_number: string | null }[] = [];
  const errors: { project_number: string | null; error: string }[] = [];

  for (const job of jobs) {
    const label = job.project_number ?? job.id;
    try {
      const invoice = await stripe.invoices.retrieve(job.stripe_invoice_id as string);
      const feeCents = await captureStripeFee(stripe, invoice);
      if (feeCents == null) {
        noFee.push({ project_number: label });
        continue;
      }
      await supabase.from("jobs").update({ stripe_fee_cents: feeCents }).eq("id", job.id);
      fixed.push({ project_number: label, fee_cents: feeCents });
    } catch (e) {
      errors.push({ project_number: label, error: e instanceof Error ? e.message : String(e) });
    }
  }

  return NextResponse.json({ scanned: jobs.length, fixed, noFee, errors });
});
