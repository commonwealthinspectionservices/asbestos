import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-api";
import { getSupabaseAdmin } from "@/lib/supabase";
import { withApiErrors } from "@/lib/api-handler";
import type { Company, Customer, Job } from "@/lib/types";

type JobRow = Job & { customers: (Customer & { companies: Company | null }) | null };

// Per Tim, 2026-08-28 — "I just wanna make sure that there's one clean
// invoice for every single job already, and also one clean lab invoice
// that goes along with that job." Read-only audit, not a route anything
// else calls (GET, no writes) — same reasoning as audit-lab-invoices and
// backfill-lab-invoice-hashes: this reports what's actually wrong instead
// of guessing at a rebuild. Checks three things per job: the customer
// invoice itself is priced and itemized, its Stripe state is internally
// consistent (a paid job that's since been refunded/disputed —
// payment_reversed_at — is exactly the kind of thing Tim flagged after
// "refunding some jobs after accidentally charging"), and it has exactly
// one real lab invoice on file (via content_hash — see that field's own
// comment — so a job billed under two service-type labels doesn't read as
// "two lab invoices" when it's really one file twice).
export const GET = withApiErrors(async (req: NextRequest) => {
  const unauthorized = requireAdminApi(req);
  if (unauthorized) return unauthorized;

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("jobs")
    .select("*, customers!customer_id(*, companies!company_id(*))")
    .order("project_number", { ascending: true });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const jobs = (data ?? []) as unknown as JobRow[];
  const issues: { project_number: string | null; company: string | null; issue: string; detail?: string }[] = [];

  for (const job of jobs) {
    const label = job.project_number ?? job.id;
    const company = job.customers?.company || job.customers?.name || null;

    // Subcontracted jobs have no invoice of their own (the company that
    // sent the job handles billing on their end) — same exclusion
    // InvoicesView.tsx's own invoicedJobs uses.
    const isInvoiced = job.source !== "subcontractor" && (Boolean(job.invoice_sent_at) || Boolean(job.paid_date));

    if (isInvoiced) {
      if (!job.invoice_total_cents) {
        issues.push({ project_number: label, company, issue: "Invoice sent/paid but has no total", detail: "invoice_total_cents is null or 0" });
      }
      if (!job.invoice_line_items || job.invoice_line_items.length === 0) {
        issues.push({ project_number: label, company, issue: "Invoice sent/paid but has no line items" });
      }
      if (job.paid_date && job.payment_reversed_at) {
        issues.push({
          project_number: label,
          company,
          issue: "Paid, then reversed — needs a human look",
          detail: `paid ${job.paid_date}, reversed ${job.payment_reversed_at}`,
        });
      }
      if (job.paid_date && job.payment_type === "online" && !job.stripe_invoice_id) {
        issues.push({ project_number: label, company, issue: "Marked paid online but has no Stripe invoice on record" });
      }
      if (job.paid_date && job.stripe_invoice_id && !job.stripe_fee_cents && !job.payment_reversed_at) {
        issues.push({ project_number: label, company, issue: "Paid via Stripe but no processing fee was ever recorded" });
      }
      if (!job.paid_date && job.invoice_sent_at && job.payment_type === "online" && !job.stripe_invoice_id) {
        issues.push({ project_number: label, company, issue: "Invoice sent for online payment but no Stripe invoice/pay link was ever created" });
      }
    }

    // Lab invoice check — every job with fieldwork actually done, not just
    // invoiced ones (a job's lab bill can land before our own invoice ever
    // goes out — same reasoning LabInvoicesView's own weekly estimate
    // uses). Dedup by storage_path first (one row per service-type label
    // on the same job, same file — see LabInvoicesView's own comment on
    // this), then by content_hash (the same real invoice filed under a
    // different job too).
    if (job.confirmed_date && job.source !== "subcontractor") {
      const labDocs = (job.documents ?? []).filter((d) => d.kind === "lab_invoice");
      const distinctStoragePaths = new Set(labDocs.map((d) => d.storage_path));
      // Crystal Analytical only bills once a week (Fridays) — a job
      // sampled mid-week is *supposed* to have no lab invoice yet, that's
      // not a problem. Only flag it once the week it was sampled in has
      // actually finished (same Monday–Friday week-completion check
      // LabInvoicesView's pastWeeklyLabInvoices uses), so this only ever
      // surfaces a real miss.
      const weekIsOver = (() => {
        const [y, m, d] = job.confirmed_date.split("-").map(Number);
        const date = new Date(y, m - 1, d);
        const daysSinceMonday = (date.getDay() + 6) % 7;
        const friday = new Date(date);
        friday.setDate(date.getDate() - daysSinceMonday + 4);
        return friday.getTime() < new Date().setHours(0, 0, 0, 0);
      })();
      if (distinctStoragePaths.size === 0 && weekIsOver) {
        issues.push({ project_number: label, company, issue: "No lab invoice on file yet", detail: `fieldwork done ${job.confirmed_date}, that week is over` });
      } else if (distinctStoragePaths.size > 1) {
        issues.push({
          project_number: label,
          company,
          issue: "More than one distinct lab invoice file on this job",
          detail: `${distinctStoragePaths.size} distinct files — verify not double-billed`,
        });
      }
      if (labDocs.some((d) => d.invoice_mismatch)) {
        issues.push({ project_number: label, company, issue: "A lab invoice on file is flagged as not actually looking like an invoice" });
      }
      if (distinctStoragePaths.size >= 1 && !job.lab_cost_cents) {
        issues.push({ project_number: label, company, issue: "Lab invoice on file but no cost was ever recorded from it" });
      }
    }
  }

  return NextResponse.json({ jobsScanned: jobs.length, jobsWithIssues: new Set(issues.map((i) => i.project_number)).size, issues });
});
