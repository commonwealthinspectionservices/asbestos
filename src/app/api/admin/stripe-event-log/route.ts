import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-api";
import { getSupabaseAdminFresh } from "@/lib/supabase";
import { getStripe } from "@/lib/stripe";
import { withApiErrors } from "@/lib/api-handler";

// Per Tim, 2026-08-28 — 26-0007/26-0008 have flipped back to "paid" three
// times now despite every write path (webhook, manual status change,
// reconcile) independently verifying the underlying charge isn't refunded
// before marking a job paid — and each of those has reliably found the
// charge IS refunded every time it's been checked directly. That mismatch
// means something is still writing status: "paid" through a path this
// codebase's own source doesn't show, or Stripe is redelivering invoice.paid
// far more aggressively than expected. Rather than keep guessing from code
// alone, this pulls Stripe's own event history for a job's invoice
// directly — real evidence of what Stripe has actually sent, when, and
// (from the API response) whether each delivery attempt to our webhook
// succeeded or failed. Read-only. Pass ?project=26-0007 (repeatable, or
// comma-separated) or defaults to 26-0007 and 26-0008.
export const GET = withApiErrors(async (req: NextRequest) => {
  const unauthorized = requireAdminApi(req);
  if (unauthorized) return unauthorized;

  const stripe = getStripe();
  const supabase = getSupabaseAdminFresh();

  const projectParam = req.nextUrl.searchParams.get("project");
  const projectNumbers = projectParam ? projectParam.split(",").map((s) => s.trim()) : ["26-0007", "26-0008"];

  const { data: jobs, error } = await supabase
    .from("jobs")
    .select("id, project_number, stripe_invoice_id, status, paid_date, payment_reversed_at")
    .in("project_number", projectNumbers);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const results: unknown[] = [];
  for (const job of jobs ?? []) {
    if (!job.stripe_invoice_id) {
      results.push({ project_number: job.project_number, error: "no stripe_invoice_id on record" });
      continue;
    }
    try {
      // Every event Stripe has on file mentioning this invoice, most
      // recent first — invoice.paid, invoice.payment_succeeded, refunds,
      // voids, whatever actually happened, with real timestamps.
      const events = await stripe.events.list({ limit: 100 });
      const related = events.data
        .filter((e) => {
          const obj = e.data.object as { id?: string; invoice?: string | { id: string } };
          if (obj?.id === job.stripe_invoice_id) return true;
          const invoiceRef = obj?.invoice;
          const invoiceId = typeof invoiceRef === "string" ? invoiceRef : invoiceRef?.id;
          return invoiceId === job.stripe_invoice_id;
        })
        .map((e) => ({
          type: e.type,
          created: new Date(e.created * 1000).toISOString(),
          id: e.id,
          pending_webhooks: e.pending_webhooks,
        }));
      results.push({
        project_number: job.project_number,
        current_db_state: { status: job.status, paid_date: job.paid_date, payment_reversed_at: job.payment_reversed_at },
        stripe_invoice_id: job.stripe_invoice_id,
        events: related,
      });
    } catch (e) {
      results.push({ project_number: job.project_number, error: e instanceof Error ? e.message : String(e) });
    }
  }

  return NextResponse.json({ results });
});
