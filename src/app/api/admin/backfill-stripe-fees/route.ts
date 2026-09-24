import { NextRequest, NextResponse } from "next/server";
import { requireOwnerApi } from "@/lib/admin-api";
import { getSupabaseAdminFresh } from "@/lib/supabase";
import { getStripe, captureStripeFee } from "@/lib/stripe";
import { withApiErrors } from "@/lib/api-handler";
import type { Job } from "@/lib/types";

type JobRow = Pick<Job, "id" | "project_number" | "stripe_invoice_id" | "paid_date" | "payment_reversed_at">;

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

  const stripe = getStripe();
  const supabase = getSupabaseAdminFresh();
  const { data, error } = await supabase
    .from("jobs")
    .select("id, project_number, stripe_invoice_id, paid_date, payment_reversed_at")
    .not("paid_date", "is", null)
    .not("stripe_invoice_id", "is", null)
    .is("stripe_fee_cents", null)
    .is("payment_reversed_at", null);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const jobs = (data ?? []) as unknown as JobRow[];

  const fixed: { project_number: string | null; fee_cents: number }[] = [];
  const stillProcessing: { project_number: string | null }[] = [];
  const errors: { project_number: string | null; error: string }[] = [];

  for (const job of jobs) {
    const label = job.project_number ?? job.id;
    try {
      const invoice = await stripe.invoices.retrieve(job.stripe_invoice_id as string);
      const feeCents = await captureStripeFee(stripe, invoice);
      if (feeCents == null) {
        stillProcessing.push({ project_number: label });
        continue;
      }
      await supabase.from("jobs").update({ stripe_fee_cents: feeCents }).eq("id", job.id);
      fixed.push({ project_number: label, fee_cents: feeCents });
    } catch (e) {
      errors.push({ project_number: label, error: e instanceof Error ? e.message : String(e) });
    }
  }

  return NextResponse.json({ scanned: jobs.length, fixed, stillProcessing, errors });
});
