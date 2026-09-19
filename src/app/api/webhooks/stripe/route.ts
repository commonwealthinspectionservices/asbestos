import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { getSupabaseAdmin } from "@/lib/supabase";
import { captureStripeFee } from "@/lib/stripe";

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

// Per Tim, 2026-09-19 (26-0019, Oscar Cruz) — a payment_intent event's own
// `invoice` field is null on this account's Stripe API version, so an ACH
// payment that was genuinely for one of our invoices reported "couldn't be
// matched to a job" (and never got marked paid). Falls back to finding the
// invoice that owns this payment intent among the customer's own invoices.
async function invoiceIdForPaymentIntent(stripe: Stripe, paymentIntent: Stripe.PaymentIntent): Promise<string | null> {
  const direct = typeof paymentIntent.invoice === "string" ? paymentIntent.invoice : paymentIntent.invoice?.id ?? null;
  if (direct) return direct;
  const customerId = typeof paymentIntent.customer === "string" ? paymentIntent.customer : paymentIntent.customer?.id ?? null;
  if (!customerId) return null;
  const invoices = await stripe.invoices.list({ customer: customerId, limit: 100 });
  const match = invoices.data.find((inv) => {
    const pi = inv.payment_intent;
    return (typeof pi === "string" ? pi : pi?.id) === paymentIntent.id;
  });
  return match?.id ?? null;
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
      await markJobPaid(jobId, `webhook:invoice.paid:${event.id}`);
      // markJobPaid independently verifies the underlying charge before
      // ever marking a job paid (see its own comment) — a refunded charge
      // gets flagged payment_reversed_at instead, with paid_date left
      // untouched. Only capture/record a processing fee when the job
      // actually ended up paid; a job that was just correctly flagged as
      // reversed has no standing payment to attach a fee to.
      const { data: after } = await supabase.from("jobs").select("paid_date").eq("id", jobId).maybeSingle();
      if (after?.paid_date) {
        const feeCents = await captureStripeFee(stripe, invoice);
        if (feeCents != null) {
          await supabase.from("jobs").update({ stripe_fee_cents: feeCents }).eq("id", jobId);
        }
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
  } else if (event.type === "payment_intent.processing") {
    // Per Tim, 2026-09-18 (26-0031, Ruben Rodrigues) — "if the customer has
    // already sent the ACH and it's out of his account then we should be
    // marking this job as paid... and all jobs like this": a bank-transfer
    // (ACH) payment sits in "processing" for 3-5 business days before
    // invoice.paid ever fires, but the money has genuinely left the
    // customer's account and Stripe has accepted the debit by this point —
    // explicit decision to treat that as paid immediately rather than wait
    // out the clearing window, same as any other payment. Only bank-account
    // payments reach this at all — a card either succeeds or fails right at
    // checkout and invoice.paid/a decline already covers that instantly.
    const paymentIntent = event.data.object as Stripe.PaymentIntent;
    if (paymentIntent.payment_method_types.includes("us_bank_account")) {
      const invoiceId = await invoiceIdForPaymentIntent(stripe, paymentIntent);
      const jobId = await resolveJobIdFromInvoiceId(supabase, invoiceId, paymentIntent.metadata?.job_id);
      if (jobId) {
        const { markJobPaid } = await import("@/lib/lab-email");
        await markJobPaid(jobId, `webhook:payment_intent.processing:${event.id}`);
      } else {
        await alertUnmatchedEvent(event.type, invoiceId ?? paymentIntent.id);
      }
    }
  } else if (event.type === "payment_intent.payment_failed") {
    // The other half of marking paid early: an ACH payment can still
    // bounce days later (insufficient funds, closed account) after already
    // being marked paid above — same reversal path as a refund/dispute on
    // any other paid job (see markJobPaymentReversed's own comment: an
    // owner alert, status left as-is for a deliberate human decision, not
    // silently reverted). Same us_bank_account-only scope as above.
    const paymentIntent = event.data.object as Stripe.PaymentIntent;
    if (paymentIntent.payment_method_types.includes("us_bank_account")) {
      const invoiceId = await invoiceIdForPaymentIntent(stripe, paymentIntent);
      const jobId = await resolveJobIdFromInvoiceId(supabase, invoiceId, paymentIntent.metadata?.job_id);
      if (jobId) {
        const { markJobPaymentReversed } = await import("@/lib/lab-email");
        const reason = paymentIntent.last_payment_error?.message
          ? `ACH payment failed: ${paymentIntent.last_payment_error.message}`
          : "ACH payment failed after being marked paid";
        await markJobPaymentReversed(jobId, reason);
      } else {
        await alertUnmatchedEvent(event.type, invoiceId ?? paymentIntent.id);
      }
    }
  }

  return NextResponse.json({ received: true });
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
