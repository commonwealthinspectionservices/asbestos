import { getSupabaseAdminFresh } from "@/lib/supabase";
import { getStripe, captureStripeFee } from "@/lib/stripe";

// Per Tim, 2026-09-25 (26-0002) — "yes add the automatic retry": the webhook
// looks up Stripe's processing fee the instant a payment lands, and that
// lookup can come back empty (Stripe hadn't attached the fee yet) — the job
// then sat paid with no fee until someone ran the backfill by hand. This is
// that backfill, shared by the manual route and the 15-minute cron, so a
// missed fee fills itself in on the next run. Safe to repeat: captureStripeFee
// already returns null for a charge still processing (ACH), which is just
// left alone until Stripe has it. `sinceDays` limits which paid jobs the
// cron bothers re-checking each run; the manual route passes none.
export async function backfillMissingStripeFees(sinceDays?: number): Promise<{
  scanned: number;
  fixed: { project_number: string | null; fee_cents: number }[];
  stillProcessing: { project_number: string | null }[];
  errors: { project_number: string | null; error: string }[];
}> {
  const stripe = getStripe();
  const supabase = getSupabaseAdminFresh();
  let query = supabase
    .from("jobs")
    .select("id, project_number, stripe_invoice_id, paid_date, payment_reversed_at, customers!customer_id(stripe_customer_id)")
    .not("paid_date", "is", null)
    .not("stripe_invoice_id", "is", null)
    .is("stripe_fee_cents", null)
    .is("payment_reversed_at", null);
  if (sinceDays != null) {
    query = query.gte("paid_date", new Date(Date.now() - sinceDays * 86400000).toISOString().slice(0, 10));
  }
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  const jobs = (data ?? []) as unknown as {
    id: string;
    project_number: string | null;
    stripe_invoice_id: string;
    customers: { stripe_customer_id: string | null } | null;
  }[];

  const fixed: { project_number: string | null; fee_cents: number }[] = [];
  const stillProcessing: { project_number: string | null }[] = [];
  const errors: { project_number: string | null; error: string }[] = [];

  for (const job of jobs) {
    const label = job.project_number ?? job.id;
    try {
      const invoice = await stripe.invoices.retrieve(job.stripe_invoice_id);
      const feeCents = await captureStripeFee(stripe, invoice);
      if (feeCents != null) {
        await supabase.from("jobs").update({ stripe_fee_cents: feeCents }).eq("id", job.id);
        fixed.push({ project_number: label, fee_cents: feeCents });
        continue;
      }

      // Per Tim, 2026-09-28 (26-0042, Sarah Willson) — job.stripe_invoice_id
      // can point at a dead invoice (void/uncollectible) while the payment
      // that actually got the job marked paid landed on a *different*
      // invoice — confirmed live: createInvoiceWithProjectNumber's own
      // numbering loop falls through to a bare Stripe-auto-numbered invoice
      // after 25 collisions, and the webhook matches that invoice to the
      // job via its metadata.job_id rather than the stored pointer. Once
      // that happens, retrying the same dead stripe_invoice_id forever
      // (the un-fixed behavior) can never produce a fee — it has no charge
      // and never will. Only worth the extra customer-wide search in that
      // exact dead-end case; a merely-still-open or still-processing
      // invoice is left alone below, same as before.
      const isDeadEnd = invoice.status === "void" || invoice.status === "uncollectible";
      const stripeCustomerId = job.customers?.stripe_customer_id ?? null;
      if (isDeadEnd && stripeCustomerId) {
        const candidates = await stripe.invoices.list({ customer: stripeCustomerId, limit: 100 });
        const realInvoice = candidates.data.find(
          (inv) => inv.id !== job.stripe_invoice_id && inv.status === "paid" && inv.metadata?.job_id === job.id
        );
        if (realInvoice) {
          const realFeeCents = await captureStripeFee(stripe, realInvoice);
          // Re-point the job at the invoice that actually got paid, whether
          // or not the fee is available yet — a dead void invoice is never
          // going to become correct on a later run, so this stops it from
          // failing the exact same way forever even if the fee itself is
          // still processing this time.
          await supabase.from("jobs").update({ stripe_invoice_id: realInvoice.id }).eq("id", job.id);
          if (realFeeCents != null) {
            await supabase.from("jobs").update({ stripe_fee_cents: realFeeCents }).eq("id", job.id);
            fixed.push({ project_number: label, fee_cents: realFeeCents });
            continue;
          }
        }
      }

      stillProcessing.push({ project_number: label });
    } catch (e) {
      errors.push({ project_number: label, error: e instanceof Error ? e.message : String(e) });
    }
  }

  return { scanned: jobs.length, fixed, stillProcessing, errors };
}
