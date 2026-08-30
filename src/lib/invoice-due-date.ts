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

// Per Tim, 2026-08-28 — always exactly 30 days after the invoice was
// actually emailed (not requested_date, which can differ from when the
// report really went out, and no longer a manually-set payment_due_date
// override either — Tim wants this unconditional) — this is what Stripe's
// own auto-charge (lib/net30-autocharge.ts) goes by too, see stripe.ts's
// tagInvoiceEmailed. requested_date+30 stays only as a rough pre-send
// estimate, before invoice_sent_at exists yet. Shared by BillingView.tsx
// and JobsDashboard.tsx — was two byte-identical copies until 2026-08-29's
// organization pass; unlike the margin formula (lib/pricing.ts's
// computeMarginCents), these hadn't actually drifted, but the codebase's
// usual small-per-view-helper convention (see lib/phone.ts) doesn't extend
// to real billing logic like this.
export function dueDateFor(job: JobWithCustomer): string | null {
  if (job.invoice_sent_at) return paymentDueDate(localDateOnly(job.invoice_sent_at));
  return paymentDueDate(job.confirmed_date ?? job.requested_date ?? "");
}
