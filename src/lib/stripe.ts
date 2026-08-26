import Stripe from "stripe";
import { getSupabaseAdmin } from "@/lib/supabase";
import type { Customer, Job } from "@/lib/types";

let stripeClient: Stripe | null = null;

function getStripe(): Stripe {
  if (stripeClient) return stripeClient;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("Missing STRIPE_SECRET_KEY env var");
  stripeClient = new Stripe(key);
  return stripeClient;
}

async function getOrCreateStripeCustomer(customer: Customer): Promise<string> {
  if (customer.stripe_customer_id) return customer.stripe_customer_id;

  const stripe = getStripe();
  const created = await stripe.customers.create({
    name: customer.company ? `${customer.name} (${customer.company})` : customer.name,
    email: customer.email,
    phone: customer.phone,
    address: customer.billing_address
      ? { line1: customer.billing_address }
      : undefined,
  });

  const supabase = getSupabaseAdmin();
  await supabase
    .from("customers")
    .update({ stripe_customer_id: created.id })
    .eq("id", customer.id);

  return created.id;
}

/**
 * Creates (or reuses) a Stripe invoice for a job's already-computed
 * `invoice_line_items` — the same line items shown on our own generated
 * invoice PDF — and finalizes it to produce a payable hosted page. Deliberately
 * never calls `stripe.invoices.sendInvoice()`: this app only ever drafts
 * emails for manual review (see lab-email.ts), so Stripe must not email the
 * customer on its own. The webhook at /api/webhooks/stripe marks the job
 * paid once the hosted invoice is actually paid.
 */
export async function createStripeInvoiceForJob(
  job: Job,
  customer: Customer
): Promise<{ stripeInvoiceId: string; hostedInvoiceUrl: string | null }> {
  const stripe = getStripe();
  const supabase = getSupabaseAdmin();

  // Reuse an existing invoice rather than creating a duplicate on every
  // redraft — matching how the Gmail invoice draft itself behaves (see
  // invoice_auto on Job) — UNLESS it's gone stale:
  //  - void/uncollectible (e.g. the admin voided a mistaken one directly in
  //    Stripe): can never be paid again and Stripe won't un-void it, so
  //    reusing its dead hosted_invoice_url would permanently break this
  //    job's payment link.
  //  - already paid: never touch it, regardless of total — a real payment
  //    happened, and replacing it after the fact would be wrong.
  //  - still open, but its total no longer matches job.invoice_total_cents:
  //    confirmed live wrong on 26-0001 and 26-0002 — a sample count (or
  //    other line item) corrected locally after the Stripe invoice was
  //    first created left the customer's actual payment link showing the
  //    old, wrong amount, with nothing to ever refresh it short of the
  //    admin manually voiding it in the Stripe dashboard. Void it and fall
  //    through to create a fresh one instead, so "Link to pay" always
  //    reflects what the job is actually billed for right now.
  //  - still open, but missing the project-number custom_field or its
  //    description no longer matches job.service_address: an invoice
  //    created before those fields existed (or before the address
  //    changed) would otherwise sit there forever without them, since
  //    nothing else about it — status or total — ever goes stale.
  if (job.stripe_invoice_id) {
    const existing = await stripe.invoices.retrieve(job.stripe_invoice_id);
    if (existing.status === "paid") {
      return { stripeInvoiceId: existing.id, hostedInvoiceUrl: existing.hosted_invoice_url ?? null };
    }
    const hasCurrentProjectNumber = !job.project_number
      || existing.custom_fields?.some((f) => f.name === "Project #" && f.value === job.project_number);
    const hasCurrentAddress = !job.service_address || existing.description === job.service_address;
    const isStale = existing.status === "void" || existing.status === "uncollectible"
      || existing.total !== job.invoice_total_cents
      || !hasCurrentProjectNumber || !hasCurrentAddress;
    if (!isStale) {
      return { stripeInvoiceId: existing.id, hostedInvoiceUrl: existing.hosted_invoice_url ?? null };
    }
    if (existing.status === "open") {
      await stripe.invoices.voidInvoice(existing.id).catch((err) => {
        console.error(`createStripeInvoiceForJob: failed to void stale invoice ${existing.id} for job ${job.id}:`, err);
      });
    }
    await supabase.from("jobs").update({ stripe_invoice_id: null }).eq("id", job.id);
  }

  if (!job.invoice_line_items.length) {
    throw new Error("Job has no invoice line items — cannot create a Stripe invoice");
  }

  const stripeCustomerId = await getOrCreateStripeCustomer(customer);

  const invoice = await stripe.invoices.create({
    customer: stripeCustomerId,
    collection_method: "send_invoice",
    days_until_due: 30,
    metadata: { job_id: job.id },
    // metadata above is Stripe-dashboard-only — the customer's own hosted
    // invoice page needs the project number and job site address visibly
    // shown, per Tim. custom_fields values are capped at 30 chars by
    // Stripe, too short for most real addresses ("690 Blue Hill Ave,
    // Dorchester, MA 02121" alone is 37), so the address goes in
    // `description` (shown right under the invoice header, no length
    // limit that would realistically bite) while the short project number
    // still gets its own custom_field.
    ...(job.project_number ? { custom_fields: [{ name: "Project #", value: job.project_number }] } : {}),
    ...(job.service_address ? { description: job.service_address } : {}),
  });

  for (const item of job.invoice_line_items) {
    await stripe.invoiceItems.create({
      customer: stripeCustomerId,
      invoice: invoice.id,
      amount: Math.round(item.quantity * item.unit_cost_cents),
      currency: "usd",
      description: `${item.description} (${item.billing_unit} × ${item.quantity})`,
    });
  }

  const finalized = await stripe.invoices.finalizeInvoice(invoice.id);

  // Optimistic-concurrency guard against two concurrent callers (e.g. the
  // lab-results auto-invoice pipeline and an admin/portal "pay now" click
  // landing at the same moment) each finalizing their own live, payable
  // Stripe invoice for the same job. Only the caller whose write actually
  // lands (stripe_invoice_id was still null) keeps its invoice; the loser
  // voids the one it just created rather than leaving a second payable
  // invoice for the same job floating around unreferenced by the DB.
  const { data: updated } = await supabase
    .from("jobs")
    .update({ stripe_invoice_id: finalized.id })
    .eq("id", job.id)
    .is("stripe_invoice_id", null)
    .select("id")
    .maybeSingle();

  if (!updated) {
    await stripe.invoices.voidInvoice(finalized.id).catch((err) => {
      console.error(`createStripeInvoiceForJob: failed to void losing duplicate invoice ${finalized.id}:`, err);
    });
    const { data: winner } = await supabase.from("jobs").select("stripe_invoice_id").eq("id", job.id).single();
    if (winner?.stripe_invoice_id) {
      const winningInvoice = await stripe.invoices.retrieve(winner.stripe_invoice_id);
      return { stripeInvoiceId: winningInvoice.id, hostedInvoiceUrl: winningInvoice.hosted_invoice_url ?? null };
    }
  }

  return { stripeInvoiceId: finalized.id, hostedInvoiceUrl: finalized.hosted_invoice_url ?? null };
}
