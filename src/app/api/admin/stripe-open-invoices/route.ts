import { NextRequest, NextResponse } from "next/server";
import { requireOwnerApi } from "@/lib/admin-api";
import { withApiErrors } from "@/lib/api-handler";
import { getSupabaseAdminFresh } from "@/lib/supabase";
import { getStripe } from "@/lib/stripe";

// Per Tim, 2026-09-23 — Stripe's own Transactions page shows one row per
// PAYMENT ATTEMPT, including every abandoned/superseded one left behind
// whenever this app voids a stale invoice and creates a fresh one (see
// createStripeInvoiceForJob's own comment) — that's why it looks cluttered
// with old "Incomplete"/"Canceled" rows for the same job. This instead
// asks Stripe for invoices whose own status really is "open" (Stripe's
// real invoice.status enum: draft/open/paid/uncollectible/void — a voided
// or superseded invoice is never "open"), so what's returned here is
// exactly the "still active, still owed" list Tim actually wants, cross-
// referenced back to the job it belongs to for a friendlier display than
// a bare customer email.
export const GET = withApiErrors(async (req: NextRequest) => {
  const unauthorized = requireOwnerApi(req);
  if (unauthorized) return unauthorized;

  const stripe = getStripe();
  const supabase = getSupabaseAdminFresh();

  const invoices: { id: string; amountDueCents: number; dueDate: string | null; created: string; customerEmail: string | null; hostedInvoiceUrl: string | null }[] = [];
  let startingAfter: string | undefined;
  // Paginate through every open invoice — Stripe caps a single list() call
  // at 100; this business is nowhere near that volume, but never silently
  // truncate a real financial list.
  for (let page = 0; page < 20; page++) {
    const batch = await stripe.invoices.list({ status: "open", limit: 100, starting_after: startingAfter });
    for (const inv of batch.data) {
      invoices.push({
        id: inv.id!,
        amountDueCents: inv.amount_due,
        dueDate: inv.due_date ? new Date(inv.due_date * 1000).toISOString() : null,
        created: new Date(inv.created * 1000).toISOString(),
        customerEmail: inv.customer_email,
        hostedInvoiceUrl: inv.hosted_invoice_url ?? null,
      });
    }
    if (!batch.has_more) break;
    startingAfter = batch.data[batch.data.length - 1]?.id;
  }

  const { data: jobs } = await supabase
    .from("jobs")
    .select("project_number, service_address, stripe_invoice_id, customers!customer_id(name, company)")
    .in("stripe_invoice_id", invoices.map((i) => i.id));
  const jobByInvoiceId = new Map((jobs ?? []).map((j) => [j.stripe_invoice_id as string, j]));

  const rows = invoices
    .map((inv) => {
      const job = jobByInvoiceId.get(inv.id);
      return {
        ...inv,
        projectNumber: job?.project_number ?? null,
        serviceAddress: job?.service_address ?? null,
        customerName: (job?.customers as { name?: string; company?: string } | null)?.company || (job?.customers as { name?: string } | null)?.name || inv.customerEmail || "",
      };
    })
    .sort((a, b) => (a.dueDate ?? a.created).localeCompare(b.dueDate ?? b.created));

  return NextResponse.json({ invoices: rows });
});
