import Stripe from "stripe";
import { getSupabaseAdmin } from "@/lib/supabase";
import { expandAddress } from "@/lib/address";
import type { Customer, Job } from "@/lib/types";

let stripeClient: Stripe | null = null;

export function getStripe(): Stripe {
  if (stripeClient) return stripeClient;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("Missing STRIPE_SECRET_KEY env var");
  stripeClient = new Stripe(key);
  return stripeClient;
}

export async function getOrCreateStripeCustomer(customer: Customer): Promise<string> {
  const stripe = getStripe();

  // Verified, not just trusted — confirmed live: Joe Kline's stored
  // stripe_customer_id pointed at a customer no longer in Stripe ("No such
  // customer"), which surfaced as a hard failure on every invoice attempt
  // for his jobs with no way to recover short of an admin manually
  // clearing the column. A stale reference here is exactly the same shape
  // of problem createStripeInvoiceForJob already handles for the invoice
  // itself (void/uncollectible/deleted-out-from-under-us) — same fix:
  // detect it's gone and fall through to creating a fresh one instead of
  // ever hard-failing on it.
  if (customer.stripe_customer_id) {
    try {
      const existing = await stripe.customers.retrieve(customer.stripe_customer_id);
      if (!existing.deleted) return customer.stripe_customer_id;
    } catch (err) {
      console.error(`getOrCreateStripeCustomer: stored stripe_customer_id ${customer.stripe_customer_id} for customer ${customer.id} is invalid, creating a new one:`, err);
    }
  }

  const created = await stripe.customers.create({
    name: customer.company ? `${customer.name} (${customer.company})` : customer.name,
    email: customer.email,
    phone: customer.phone,
    address: customer.billing_address
      ? { line1: expandAddress(customer.billing_address) }
      : undefined,
  });

  const supabase = getSupabaseAdmin();
  await supabase
    .from("customers")
    .update({ stripe_customer_id: created.id })
    .eq("id", customer.id);

  return created.id;
}

// Stripe requires an invoice's custom `number` to be unique across the
// whole account FOREVER — confirmed live: voiding an invoice does not
// release its number, a second create() with the same number fails with
// "Invoice number is already set on another invoice" even though the
// first one is dead. That collides directly with createStripeInvoiceForJob's
// own void-and-recreate-when-stale behavior below: a job whose invoice
// gets regenerated (a corrected sample count, a missing field backfilled,
// etc. — not rare) can't just reuse its own project number a second time.
// Retries with an incrementing suffix (26-0002-2, 26-0002-3, ...) so a
// regenerated invoice still reads as "this job's invoice" instead of
// falling back to Stripe's own unrelated auto-numbering. Gives up after a
// handful of attempts and lets Stripe auto-number rather than ever
// blocking invoice creation over what's ultimately a cosmetic field.
async function createInvoiceWithProjectNumber(
  stripe: Stripe,
  params: Stripe.InvoiceCreateParams,
  projectNumber: string | null
): Promise<Stripe.Invoice> {
  if (!projectNumber) return stripe.invoices.create(params);
  for (let attempt = 0; attempt < 5; attempt++) {
    const number = attempt === 0 ? projectNumber : `${projectNumber}-${attempt + 1}`;
    try {
      return await stripe.invoices.create({ ...params, number });
    } catch (err) {
      const isNumberCollision = err instanceof Stripe.errors.StripeInvalidRequestError
        && err.message.includes("Invoice number is already set");
      if (!isNumberCollision) throw err;
    }
  }
  return stripe.invoices.create(params);
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
  //  - still open, but missing the project-number custom_field, its
  //    description no longer matches job.service_address, or its own
  //    `number` doesn't start with the job's project number: an invoice
  //    created before any of these fields existed would otherwise sit
  //    there forever without them, since nothing else about it — status
  //    or total — ever goes stale. The `number` check uses startsWith
  //    rather than equality since a job whose invoice gets regenerated
  //    more than once picks up a "-2", "-3", ... suffix (see
  //    createInvoiceWithProjectNumber below) to satisfy Stripe's
  //    account-wide-unique, never-released-by-voiding constraint on
  //    custom numbers — confirmed live.
  // Resolved up front (not after the staleness check below) so a stale
  // invoice's own `customer` can be compared against it — see that check's
  // own comment for why this matters.
  const stripeCustomerId = await getOrCreateStripeCustomer(customer);

  if (job.stripe_invoice_id) {
    // Confirmed live 2026-08-27 (26-0007/26-0008): a stripe_invoice_id can
    // point at an invoice that's gone entirely from Stripe (test-mode data
    // reset, manually deleted rather than voided) — retrieve() 404s with no
    // fallback, throwing out of this whole function. The caller treats
    // Stripe failures as best-effort and swallows it (a Gmail draft must
    // never be blocked by a Stripe hiccup), so the practical effect was a
    // real draft going out with no "Link to Pay" at all. Treated the same
    // as "no stripe_invoice_id on record" — clear the dead reference and
    // fall through to create a fresh one.
    let existing: Stripe.Invoice | null = null;
    try {
      existing = await stripe.invoices.retrieve(job.stripe_invoice_id);
    } catch (e) {
      if (!(e instanceof Stripe.errors.StripeInvalidRequestError && e.code === "resource_missing")) throw e;
      await supabase.from("jobs").update({ stripe_invoice_id: null }).eq("id", job.id);
    }
    if (existing) {
      if (existing.status === "paid") {
        return { stripeInvoiceId: existing.id, hostedInvoiceUrl: existing.hosted_invoice_url ?? null };
      }
      const hasCurrentProjectNumber = !job.project_number
        || existing.custom_fields?.some((f) => f.name === "Project #" && f.value === job.project_number);
      const hasCurrentAddress = !job.service_address || existing.description === expandAddress(job.service_address);
      const hasCurrentNumber = !job.project_number
        || (existing.number != null && existing.number.startsWith(job.project_number));
      // Confirmed live 2026-08-27 (26-0002): the admin deleted a duplicate
      // Stripe customer directly in the Dashboard while cleaning up real
      // dupes — the survivor got a new stripe_customer_id on `customers`,
      // but this job's own already-created invoice stayed permanently
      // attached to the now-deleted one (Stripe invoices don't move
      // between customers). None of the checks above catch that — status
      // stays "open", the total/number/address all still match — so this
      // invoice would otherwise sit there forever looking perfectly fine
      // while being unpayable (no valid customer, no payment method to
      // charge automatically) and invisible from the surviving customer's
      // own Stripe page.
      const existingCustomerId = typeof existing.customer === "string" ? existing.customer : existing.customer?.id;
      const belongsToCurrentCustomer = existingCustomerId === stripeCustomerId;
      const isStale = existing.status === "void" || existing.status === "uncollectible"
        || existing.total !== job.invoice_total_cents
        || !hasCurrentProjectNumber || !hasCurrentAddress || !hasCurrentNumber || !belongsToCurrentCustomer;
      if (!isStale) {
        return { stripeInvoiceId: existing.id, hostedInvoiceUrl: existing.hosted_invoice_url ?? null };
      }
      // A void attempt against an invoice on a deleted customer 400s
      // ("customer deleted") — best-effort, same as every other void call
      // in this function; the DB reference gets cleared regardless.
      if (existing.status === "open") {
        await stripe.invoices.voidInvoice(existing.id).catch((err) => {
          console.error(`createStripeInvoiceForJob: failed to void stale invoice ${existing.id} for job ${job.id}:`, err);
        });
      }
      await supabase.from("jobs").update({ stripe_invoice_id: null }).eq("id", job.id);
    }
  }

  if (!job.invoice_line_items.length) {
    throw new Error("Job has no invoice line items — cannot create a Stripe invoice");
  }

  const invoice = await createInvoiceWithProjectNumber(stripe, {
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
    ...(job.service_address ? { description: expandAddress(job.service_address) } : {}),
  }, job.project_number);

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

  // Belt-and-suspenders against ending up with more than one open invoice
  // for the same job — confirmed live 2026-08-27: several jobs had two
  // simultaneously-open Stripe invoices even though this function only
  // ever *tries* to void the one it knows about (job.stripe_invoice_id)
  // before creating a new one. Any path that loses that single pointer —
  // a stale/corrupted id that 404s on retrieve() above (nothing to void,
  // since we never learn what the old invoice even was), or a
  // voidInvoice() call that itself fails and got swallowed by its own
  // .catch() — leaves the real old invoice open and orphaned forever,
  // silently. Searching Stripe directly by the job_id metadata every
  // invoice already carries (set below at creation) finds any such stray
  // regardless of why the DB's own pointer went bad, so "at most one open
  // invoice per job" holds even when the single-pointer dance above
  // doesn't. Best-effort — must never block handing back the invoice that
  // *did* just get created successfully.
  try {
    const strays = await stripe.invoices.search({
      query: `metadata['job_id']:'${job.id}' AND status:'open'`,
    });
    for (const stray of strays.data) {
      if (stray.id === finalized.id) continue;
      await stripe.invoices.voidInvoice(stray.id).catch((err) => {
        console.error(`createStripeInvoiceForJob: failed to void stray duplicate invoice ${stray.id} for job ${job.id}:`, err);
      });
    }
  } catch (err) {
    console.error(`createStripeInvoiceForJob: failed to search for stray duplicate invoices for job ${job.id}:`, err);
  }

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

// Stripe has no idea an invoice was ever actually emailed — this app
// deliberately never calls stripe.invoices.sendInvoice() (see this
// file's own module comment), so from Stripe's side a drafted-but-never-
// sent invoice and a genuinely-emailed one look identical. Per Tim,
// 2026-08-27: called from checkDraftSentStatus the moment it confirms
// (via Gmail, not Stripe) that the draft carrying this invoice actually
// went out, so at least the invoice's own Stripe page carries that fact
// for anyone troubleshooting from the Stripe side alone. Metadata
// updates merge by key rather than replacing the object wholesale, so
// this can't clobber the job_id key set at creation. Best-effort by
// design — the caller must never let a Stripe hiccup block recording the
// send in this app's own database, which is the real source of truth.
//
// Per Tim, 2026-08-28 — also pushes the invoice's own due_date out to
// exactly 30 days from this real send date. Left alone, due_date sits at
// whatever finalizeInvoice's days_until_due:30 computed back at
// draft-creation time (createStripeInvoiceForJob, above) — often well
// before the report/invoice actually went out, since a draft can sit
// unsent for a while. net30-autocharge.ts charges off this exact field,
// and it's also what Stripe's own hosted invoice page shows the customer,
// so both the real charge timing and what Newton sees need to agree with
// "30 days after the report was sent," not 30 days after the draft was
// made.
export async function tagInvoiceEmailed(stripeInvoiceId: string, emailedAt: string): Promise<void> {
  const stripe = getStripe();
  const sentAtMs = new Date(emailedAt).getTime();
  const dueDate = Math.floor(sentAtMs / 1000) + 30 * 24 * 60 * 60;
  await stripe.invoices.update(stripeInvoiceId, { metadata: { emailed_at: emailedAt }, due_date: dueDate });
}

// Per Tim, 2026-08-27 — Newton Fire & Flood (only, for now) wants a card
// left on file that gets charged automatically instead of him waiting on
// a manual "Pay" click. A hosted Checkout Session in `setup` mode is the
// only correct way to collect that card: the customer types it into
// Stripe's own page, we never see or handle the number ourselves — same
// boundary this app already respects everywhere else real payment
// credentials are involved. The webhook (checkout.session.completed)
// picks up the resulting payment method and sets it as the customer's
// default once they finish.
export async function createPaymentMethodSetupLink(stripeCustomerId: string, returnUrl: string): Promise<string> {
  const stripe = getStripe();
  const session = await stripe.checkout.sessions.create({
    mode: "setup",
    customer: stripeCustomerId,
    payment_method_types: ["card"],
    success_url: returnUrl,
    cancel_url: returnUrl,
  });
  if (!session.url) throw new Error("Stripe did not return a Checkout Session URL");
  return session.url;
}

// Attempts to charge an already-finalized, still-open invoice against
// whatever payment method Stripe has on file for its customer — off_session
// tells Stripe this isn't happening in front of the customer (no 3DS
// challenge redirect possible), which is exactly the case for an automated
// net-30 charge attempt run from a cron with nobody watching. Declines
// (expired card, insufficient funds, no card on file at all) throw the same
// as any other failed charge; the caller (the net-30 cron) is what decides
// what to do about that, not this function.
export async function chargeInvoiceOffSession(stripeInvoiceId: string): Promise<Stripe.Invoice> {
  const stripe = getStripe();
  return stripe.invoices.pay(stripeInvoiceId, { off_session: true });
}
