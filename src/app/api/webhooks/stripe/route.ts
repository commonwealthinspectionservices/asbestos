import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { getSupabaseAdmin } from "@/lib/supabase";

// Resolves a job by Stripe invoice id, preferring metadata.job_id (set at
// creation time in lib/stripe.ts) and falling back to matching the stored
// jobs.stripe_invoice_id — same fallback createStripeInvoiceForJob's
// callers already rely on.
async function resolveJobIdFromInvoiceId(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  invoiceId: string | null,
  metadataJobId: string | null | undefined
): Promise<string | null> {
  if (metadataJobId) return metadataJobId;
  if (!invoiceId) return null;
  const { data } = await supabase.from("jobs").select("id").eq("stripe_invoice_id", invoiceId).maybeSingle();
  return data?.id ?? null;
}

export async function POST(req: NextRequest) {
  const signature = req.headers.get("stripe-signature");
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!signature || !webhookSecret || !stripeKey) {
    return NextResponse.json({ error: "Webhook not configured" }, { status: 500 });
  }

  const stripe = new Stripe(stripeKey);
  const rawBody = await req.text();

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch (err) {
    console.error("Stripe webhook signature verification failed:", err);
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();

  // Dynamic imports (not static) — see the comment at the top of
  // lab-email.ts: it statically imports pdf-parse, which corrupts state
  // @react-pdf/renderer depends on if the two ever load in the same module
  // graph before pdf-parse is used.
  // Per Tim, 2026-08-27 — the other half of the card-on-file setup flow
  // (see customers/[id]/payment-method-link/route.ts, which creates the
  // Checkout Session this event fires for once the contact finishes it).
  // Only ever a "setup" mode session — this app never sells anything
  // through Checkout itself, so no other mode reaches this branch.
  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    if (session.mode === "setup" && session.setup_intent && session.customer) {
      const stripe = new Stripe(stripeKey);
      const setupIntentId = typeof session.setup_intent === "string" ? session.setup_intent : session.setup_intent.id;
      const setupIntent = await stripe.setupIntents.retrieve(setupIntentId);
      const paymentMethodId = typeof setupIntent.payment_method === "string" ? setupIntent.payment_method : setupIntent.payment_method?.id;
      const customerId = typeof session.customer === "string" ? session.customer : session.customer.id;
      if (paymentMethodId) {
        await stripe.customers.update(customerId, {
          invoice_settings: { default_payment_method: paymentMethodId },
        });
      }
    }
  } else if (event.type === "invoice.paid") {
    const invoice = event.data.object as Stripe.Invoice;
    const jobId = await resolveJobIdFromInvoiceId(supabase, invoice.id, invoice.metadata?.job_id);
    if (jobId) {
      const { markJobPaid } = await import("@/lib/lab-email");
      await markJobPaid(jobId);
      const feeCents = await captureStripeFee(stripe, invoice);
      if (feeCents != null) {
        await supabase.from("jobs").update({ stripe_fee_cents: feeCents }).eq("id", jobId);
      }
    } else {
      await alertUnmatchedEvent(event.type, invoice.id);
    }
  } else if (event.type === "invoice.voided" || event.type === "invoice.marked_uncollectible") {
    const invoice = event.data.object as Stripe.Invoice;
    const jobId = await resolveJobIdFromInvoiceId(supabase, invoice.id, invoice.metadata?.job_id);
    if (jobId) {
      const { data: job } = await supabase.from("jobs").select("status").eq("id", jobId).maybeSingle();
      // Only a job we'd already marked paid needs the reversal flag —
      // voiding/uncollectible on an invoice nobody paid yet is completely
      // normal (see createStripeInvoiceForJob's own void-and-recreate path)
      // and shouldn't page the owner.
      if (job?.status === "paid") {
        const { markJobPaymentReversed } = await import("@/lib/lab-email");
        await markJobPaymentReversed(jobId, event.type === "invoice.voided" ? "invoice voided after payment" : "invoice marked uncollectible");
      }
    } else {
      await alertUnmatchedEvent(event.type, invoice.id);
    }
  } else if (event.type === "charge.refunded" || event.type === "charge.dispute.created") {
    const charge = event.data.object as Stripe.Charge;
    const invoiceId = typeof charge.invoice === "string" ? charge.invoice : charge.invoice?.id ?? null;
    const jobId = await resolveJobIdFromInvoiceId(supabase, invoiceId, null);
    if (jobId) {
      const { markJobPaymentReversed } = await import("@/lib/lab-email");
      await markJobPaymentReversed(jobId, event.type === "charge.refunded" ? "payment refunded" : "payment disputed/charged back");
    } else {
      await alertUnmatchedEvent(event.type, invoiceId ?? charge.id);
    }
  }

  return NextResponse.json({ received: true });
}

// Pulls the actual processing fee Stripe took for a paid invoice, straight
// from the underlying charge's balance transaction — not an estimate. Used
// so the admin dashboard's Profit line only ever deducts a real, known fee
// (near-zero for a bank-debit invoice, ~2.9%+30¢ for a card) rather than a
// flat guess, and stays untouched for jobs marked paid by hand outside
// Stripe entirely. Best-effort: any failure here shouldn't block markJobPaid
// or fail the webhook, since the fee is a nice-to-have on top of the
// already-recorded payment, not something Stripe will retry for us.
async function captureStripeFee(stripe: Stripe, invoice: Stripe.Invoice): Promise<number | null> {
  try {
    const chargeId = typeof invoice.charge === "string" ? invoice.charge : invoice.charge?.id ?? null;
    if (!chargeId) return null;
    const charge = await stripe.charges.retrieve(chargeId, { expand: ["balance_transaction"] });
    const balanceTransaction = charge.balance_transaction;
    if (!balanceTransaction || typeof balanceTransaction === "string") return null;
    return balanceTransaction.fee;
  } catch (e) {
    console.error("Failed to capture Stripe fee for invoice", invoice.id, e);
    return null;
  }
}

// An event this route is meant to handle but can't match to any job — e.g.
// an invoice created directly in the Stripe Dashboard, or metadata that got
// stripped — used to just silently no-op with a 200, telling Stripe
// delivery succeeded (so it never retries) while the app had zero trace a
// real payment/reversal event ever happened. Alert instead of going quiet.
async function alertUnmatchedEvent(eventType: string, stripeObjectId: string | null): Promise<void> {
  console.error(`Stripe webhook: could not match ${eventType} (${stripeObjectId ?? "unknown"}) to any job.`);
  const { sendEmail, emailShell } = await import("@/lib/email");
  const { escapeHtml } = await import("@/lib/html");
  await sendEmail({
    to: process.env.OWNER_EMAIL!,
    subject: `Stripe event couldn't be matched to a job: ${eventType}`,
    html: emailShell(`
      <p style="font-size:15px;">A Stripe <strong>${escapeHtml(eventType)}</strong> event came in for ${escapeHtml(stripeObjectId ?? "an unknown object")}, but it didn't match any job's stripe_invoice_id and had no job_id in its metadata.</p>
      <p>This usually means an invoice was created directly in the Stripe Dashboard rather than through the app — worth checking Stripe directly to see what it was.</p>
    `),
  });
}
