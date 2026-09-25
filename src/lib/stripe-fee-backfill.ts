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
    .select("id, project_number, stripe_invoice_id, paid_date, payment_reversed_at")
    .not("paid_date", "is", null)
    .not("stripe_invoice_id", "is", null)
    .is("stripe_fee_cents", null)
    .is("payment_reversed_at", null);
  if (sinceDays != null) {
    query = query.gte("paid_date", new Date(Date.now() - sinceDays * 86400000).toISOString().slice(0, 10));
  }
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  const jobs = (data ?? []) as { id: string; project_number: string | null; stripe_invoice_id: string }[];

  const fixed: { project_number: string | null; fee_cents: number }[] = [];
  const stillProcessing: { project_number: string | null }[] = [];
  const errors: { project_number: string | null; error: string }[] = [];

  for (const job of jobs) {
    const label = job.project_number ?? job.id;
    try {
      const invoice = await stripe.invoices.retrieve(job.stripe_invoice_id);
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

  return { scanned: jobs.length, fixed, stillProcessing, errors };
}
