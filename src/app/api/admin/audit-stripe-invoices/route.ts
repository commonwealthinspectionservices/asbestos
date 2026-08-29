import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { requireAdminApi } from "@/lib/admin-api";
import { getSupabaseAdminFresh } from "@/lib/supabase";
import { getStripe } from "@/lib/stripe";
import { withApiErrors } from "@/lib/api-handler";
import type { Job } from "@/lib/types";

type JobRow = Pick<Job, "id" | "project_number" | "stripe_invoice_id" | "paid_date" | "payment_reversed_at" | "payment_type" | "invoice_sent_at" | "source">;

// Per Tim, 2026-08-28 — "is this all though in stripe??": the earlier
// audit-invoices endpoint only ever checked our OWN database's idea of
// consistency (does the job have a stripe_invoice_id, a fee, etc.) — it
// never actually asked Stripe whether that matches reality. This does:
// pulls every currently-open Stripe invoice and checks it against a job
// (an open invoice nothing points at is a stray/orphan sitting there
// uncollected), and pulls every job's own recorded stripe_invoice_id and
// checks it against Stripe (a job marked paid whose Stripe invoice isn't
// actually paid, or vice versa — the exact class of drift a missed/failed
// webhook would cause). Read-only — GET, no writes, no voids — same
// pattern as audit-invoices/audit-lab-invoices.
export const GET = withApiErrors(async (req: NextRequest) => {
  const unauthorized = requireAdminApi(req);
  if (unauthorized) return unauthorized;

  const stripe = getStripe();
  const supabase = getSupabaseAdminFresh();
  const { data, error } = await supabase
    .from("jobs")
    .select("id, project_number, stripe_invoice_id, paid_date, payment_reversed_at, payment_type, invoice_sent_at, source")
    .order("project_number", { ascending: true });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  const jobs = (data ?? []) as unknown as JobRow[];

  const issues: { project_number: string | null; issue: string; detail?: string }[] = [];
  const stripeInvoiceIdsOnRecord = new Set<string>();

  for (const job of jobs) {
    const label = job.project_number ?? job.id;

    if (!job.stripe_invoice_id) {
      if (job.source !== "subcontractor" && job.payment_type === "online") {
        if (job.paid_date) {
          issues.push({ project_number: label, issue: "Marked paid online but has no stripe_invoice_id on record" });
        } else if (job.invoice_sent_at) {
          issues.push({ project_number: label, issue: "Invoice sent for online payment but no Stripe invoice was ever created" });
        }
      }
      continue;
    }

    stripeInvoiceIdsOnRecord.add(job.stripe_invoice_id);

    let invoice: Stripe.Invoice;
    try {
      invoice = await stripe.invoices.retrieve(job.stripe_invoice_id);
    } catch (e) {
      issues.push({ project_number: label, issue: "stripe_invoice_id on record no longer exists in Stripe", detail: e instanceof Error ? e.message : String(e) });
      continue;
    }

    if (job.paid_date && !job.payment_reversed_at && invoice.status !== "paid") {
      issues.push({ project_number: label, issue: "Job marked paid but its Stripe invoice isn't", detail: `Stripe status: ${invoice.status}` });
    }
    if (!job.paid_date && invoice.status === "paid") {
      issues.push({ project_number: label, issue: "Stripe invoice is paid but the job was never marked paid — a webhook may have been missed" });
    }
    if (!job.paid_date && (invoice.status === "void" || invoice.status === "uncollectible")) {
      issues.push({ project_number: label, issue: "Job's own Stripe invoice is void/uncollectible in Stripe but a newer one was never created", detail: `Stripe status: ${invoice.status}` });
    }
  }

  // Every invoice Stripe itself currently considers open, cross-checked
  // against every job's own stripe_invoice_id gathered above — anything
  // open in Stripe that no job on file points to is sitting there
  // uncollected and forgotten (e.g. a job whose stripe_invoice_id got
  // reset/cleared without the old invoice ever being voided).
  const strayOpenInvoices: { id: string; number: string | null; amount: string; created: string }[] = [];
  for await (const invoice of stripe.invoices.list({ status: "open", limit: 100 })) {
    if (stripeInvoiceIdsOnRecord.has(invoice.id ?? "")) continue;
    strayOpenInvoices.push({
      id: invoice.id ?? "",
      number: invoice.number,
      amount: `$${(invoice.amount_due / 100).toFixed(2)}`,
      created: new Date(invoice.created * 1000).toISOString(),
    });
  }
  if (strayOpenInvoices.length > 0) {
    issues.push({
      project_number: null,
      issue: `${strayOpenInvoices.length} open Stripe invoice(s) with no job pointing at them`,
      detail: JSON.stringify(strayOpenInvoices),
    });
  }

  return NextResponse.json({ jobsScanned: jobs.length, issues, strayOpenInvoices });
});
