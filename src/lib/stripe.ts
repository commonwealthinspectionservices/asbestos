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

  // Reuse an existing invoice rather than creating a duplicate on every
  // redraft — line items are frozen at whatever they were when the invoice
  // was first created, matching how the Gmail invoice draft itself behaves
  // (see invoice_auto on Job).
  if (job.stripe_invoice_id) {
    const existing = await stripe.invoices.retrieve(job.stripe_invoice_id);
    return { stripeInvoiceId: existing.id, hostedInvoiceUrl: existing.hosted_invoice_url ?? null };
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

  const supabase = getSupabaseAdmin();
  await supabase.from("jobs").update({ stripe_invoice_id: finalized.id }).eq("id", job.id);

  return { stripeInvoiceId: finalized.id, hostedInvoiceUrl: finalized.hosted_invoice_url ?? null };
}
