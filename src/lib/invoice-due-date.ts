import type { JobWithCustomer } from "@/lib/types";

// Per Tim, 2026-08-28 — invoice_sent_at is a full UTC timestamp, not a
// plain date. Naively slicing its first 10 characters grabs the UTC
// calendar date, which disagrees with local (Eastern) time once a send
// happens late evening — a report actually sent Tuesday night showed as
// Wednesday here. new Date(iso)'s local getters (same approach
// formatDateTime elsewhere already uses) give the calendar date this
// browser's timezone actually saw it sent on.
export function localDateOnly(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Every repeat customer/contractor invoice is due 30 days after the project
// date, no exceptions.
export function paymentDueDate(projectDate: string): string | null {
  if (!projectDate) return null;
  const d = new Date(`${projectDate}T00:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  d.setDate(d.getDate() + 30);
  return d.toISOString().slice(0, 10);
}

// Per Tim, 2026-08-28 — defaults to exactly 30 days after the invoice was
// actually emailed (not requested_date, which can differ from when the
// report really went out) — this is what Stripe's own auto-charge
// (lib/net30-autocharge.ts) goes by too, see stripe.ts's tagInvoiceEmailed.
// requested_date+30 stays only as a rough pre-send estimate, before
// invoice_sent_at exists yet. Shared by BillingView.tsx and
// JobsDashboard.tsx — was two byte-identical copies until 2026-08-29's
// organization pass; unlike the margin formula (lib/pricing.ts's
// computeMarginCents), these hadn't actually drifted, but the codebase's
// usual small-per-view-helper convention (see lib/phone.ts) doesn't extend
// to real billing logic like this.
//
// Per Tim, 2026-09-10 — a manually-set payment_due_date now wins over the
// computed default again (briefly removed 2026-08-28, over the exact same
// "silently disagrees with the real Stripe due date" worry this override
// used to cause) — the PATCH route now pushes a manual edit here straight
// to the live Stripe invoice's own due_date (see route.ts), so this and
// Stripe's real auto-charge date can no longer drift apart the way they
// used to.
export function dueDateFor(job: JobWithCustomer): string | null {
  if (job.payment_due_date) return job.payment_due_date;
  if (job.invoice_sent_at) return paymentDueDate(localDateOnly(job.invoice_sent_at));
  return paymentDueDate(job.confirmed_date ?? job.requested_date ?? "");
}
