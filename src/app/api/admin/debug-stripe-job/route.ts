import { NextRequest, NextResponse } from "next/server";
import { requireOwnerApi } from "@/lib/admin-api";
import { getSupabaseAdminFresh } from "@/lib/supabase";
import { getStripe } from "@/lib/stripe";
import { withApiErrors } from "@/lib/api-handler";

// Per Tim, 2026-09-24 — investigating 26-0019 specifically:
// audit-stripe-invoices found this job marked paid in our own database,
// but the Stripe invoice on record for it (job.stripe_invoice_id) shows
// status "open", while stripe-balance-check separately found a real,
// settled $795 charge tied to the same job's invoice lookup — a live
// contradiction worth understanding, not guessing at. Pulls the job's own
// DB fields, the exact invoice job.stripe_invoice_id points to right now,
// and (via the job's stripe_customer_id) every OTHER invoice under that
// same customer, so the real paid one — wherever it actually is — shows
// up even if the job's own stripe_invoice_id has drifted off it.
// Read-only, ?project= query param, owner-only.
export const GET = withApiErrors(async (req: NextRequest) => {
  const unauthorized = requireOwnerApi(req);
  if (unauthorized) return unauthorized;

  const project = req.nextUrl.searchParams.get("project");
  if (!project) return NextResponse.json({ error: "?project=26-XXXX required" }, { status: 400 });

  const stripe = getStripe();
  const supabase = getSupabaseAdminFresh();

  const { data: job, error } = await supabase
    .from("jobs")
    .select("id, project_number, status, paid_date, payment_reversed_at, stripe_invoice_id, invoice_total_cents, stripe_fee_cents, customers!customer_id(id, name, company, stripe_customer_id)")
    .ilike("project_number", project)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!job) return NextResponse.json({ error: `No job found for ${project}` }, { status: 404 });

  const customer = job.customers as unknown as { id: string; name: string | null; company: string | null; stripe_customer_id: string | null } | null;

  let recordedInvoice: unknown = null;
  if (job.stripe_invoice_id) {
    try {
      const invoice = await stripe.invoices.retrieve(job.stripe_invoice_id, { expand: ["charge", "charge.balance_transaction"] });
      recordedInvoice = {
        id: invoice.id,
        number: invoice.number,
        status: invoice.status,
        total: invoice.total,
        amount_paid: invoice.amount_paid,
        amount_due: invoice.amount_due,
        created: new Date(invoice.created * 1000).toISOString(),
        charge: invoice.charge,
      };
    } catch (e) {
      recordedInvoice = { error: e instanceof Error ? e.message : String(e) };
    }
  }

  let otherInvoicesForCustomer: unknown[] = [];
  if (customer?.stripe_customer_id) {
    const list = await stripe.invoices.list({ customer: customer.stripe_customer_id, limit: 20 });
    otherInvoicesForCustomer = list.data.map((inv) => ({
      id: inv.id,
      number: inv.number,
      status: inv.status,
      total: inv.total,
      amount_paid: inv.amount_paid,
      created: new Date(inv.created * 1000).toISOString(),
      is_job_recorded_invoice: inv.id === job.stripe_invoice_id,
    }));
  }

  return NextResponse.json({
    job: {
      project_number: job.project_number,
      status: job.status,
      paid_date: job.paid_date,
      payment_reversed_at: job.payment_reversed_at,
      stripe_invoice_id: job.stripe_invoice_id,
      invoice_total_cents: job.invoice_total_cents,
      stripe_fee_cents: job.stripe_fee_cents,
    },
    customer: customer ? { name: customer.name, company: customer.company, stripe_customer_id: customer.stripe_customer_id } : null,
    recordedInvoice,
    otherInvoicesForCustomer,
  });
});
