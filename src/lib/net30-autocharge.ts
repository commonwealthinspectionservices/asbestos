import { getSupabaseAdmin } from "@/lib/supabase";
import { sendEmail, emailShell } from "@/lib/email";
import { escapeHtml } from "@/lib/html";
import { getStripe, chargeInvoiceOffSession } from "@/lib/stripe";
import { NEWTON_FIRE_FLOOD_COMPANY_ID } from "@/lib/report-findings";
import Stripe from "stripe";

// Per Tim, 2026-08-27 — Newton Fire & Flood (only, for now) leaves a card
// on file (see customers/[id]/payment-method-link/route.ts) instead of
// clicking "Pay" on each invoice. This is the other half: once an
// invoice's own due date (already 30 days from creation — see
// createStripeInvoiceForJob's days_until_due) actually arrives, attempt to
// charge it automatically against that card, off-session, rather than
// leaving it sitting there waiting on a manual payment that was never
// going to come. Deliberately doesn't touch collection_method or the
// invoice creation flow at all — every customer still gets the exact same
// invoice, with the exact same working "Pay now" link as a fallback if the
// auto-charge ever fails.
//
// Attempted once per invoice, not retried daily forever — a declined card
// stays declined; hammering it on a schedule just racks up failed-charge
// noise on the Stripe side for no benefit. Marked via the invoice's own
// Stripe metadata (net30_charge_attempted) so this cron's own bookkeeping
// doesn't need a new column on `jobs` — Tim would otherwise need to run a
// migration by hand for something this app can already track natively on
// the object it's about to touch anyway.
export async function runNet30AutoCharges(): Promise<{ attempted: number; charged: number; failed: number }> {
  const supabase = getSupabaseAdmin();
  const stripe = getStripe();

  const { data: jobs, error } = await supabase
    .from("jobs")
    .select("id, project_number, stripe_invoice_id, status, customers!customer_id(company_id)")
    .not("stripe_invoice_id", "is", null)
    .neq("status", "paid")
    .neq("status", "cancelled");
  if (error) throw new Error(`runNet30AutoCharges: failed to load jobs: ${error.message}`);

  const candidates = (jobs ?? []).filter(
    (j) => (j as unknown as { customers: { company_id: string | null } }).customers?.company_id === NEWTON_FIRE_FLOOD_COMPANY_ID
  );

  let attempted = 0;
  let charged = 0;
  let failed = 0;

  for (const job of candidates) {
    const invoiceId = (job as { stripe_invoice_id: string }).stripe_invoice_id;
    let invoice: Stripe.Invoice;
    try {
      invoice = await stripe.invoices.retrieve(invoiceId);
    } catch (err) {
      console.error(`runNet30AutoCharges: couldn't retrieve invoice ${invoiceId} for job ${job.id}:`, err);
      continue;
    }

    // Already paid/void/uncollectible, still in draft (shouldn't happen —
    // createStripeInvoiceForJob always finalizes), not due yet, or already
    // tried once — nothing to do.
    if (invoice.status !== "open") continue;
    if (!invoice.due_date || invoice.due_date * 1000 > Date.now()) continue;
    if (invoice.metadata?.net30_charge_attempted === "true") continue;

    attempted++;
    try {
      await chargeInvoiceOffSession(invoiceId);
      charged++;
      // No explicit "mark paid" here — the invoice.paid webhook event this
      // triggers is what actually marks the job paid, same single source
      // of truth every other payment path (portal, hosted invoice link)
      // already goes through.
    } catch (err) {
      failed++;
      const message = err instanceof Error ? err.message : String(err);
      await stripe.invoices.update(invoiceId, {
        metadata: { net30_charge_attempted: "true", net30_charge_failed_reason: message.slice(0, 480) },
      }).catch(() => {});
      await sendEmail({
        to: process.env.OWNER_EMAIL!,
        subject: `Net-30 auto-charge failed — ${(job as { project_number: string | null }).project_number ?? job.id}`,
        html: emailShell(`
          <p style="font-size:15px;">This job's invoice came due and the automatic charge to Newton Fire & Flood's card on file failed.</p>
          <p style="font-size:13px; color:#64748b; font-family:monospace;">${escapeHtml(message)}</p>
          <p>This won't retry automatically — the invoice's own "Pay now" link still works as a fallback, or update the card on file and re-run this from the job.</p>
        `),
      }).catch(() => {});
    }
  }

  return { attempted, charged, failed };
}
