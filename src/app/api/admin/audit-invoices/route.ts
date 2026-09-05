import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-api";
import { getSupabaseAdminFresh } from "@/lib/supabase";
import { withApiErrors } from "@/lib/api-handler";
import { FLI_ENVIRONMENTAL_COMPANY_ID } from "@/lib/report-findings";
import { formatDateMDY } from "@/lib/date-format";
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

  const supabase = getSupabaseAdminFresh();
  const { data, error } = await supabase
    .from("jobs")
    .select("*, customers!customer_id(*, companies!company_id(*))")
    .order("project_number", { ascending: true });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const jobs = (data ?? []) as unknown as JobRow[];
  // category lets a caller (e.g. BillingView's Lab Invoice Check) show just
  // the lab-invoice subset of this same scan without a second query — this
  // route already reads every job either way, so splitting the check
  // instead of tagging results would just double the DB read for no reason.
  const issues: { project_number: string | null; company: string | null; issue: string; detail?: string; category: "invoice" | "lab_invoice" }[] = [];

  for (const job of jobs) {
    const label = job.project_number ?? job.id;
    const company = job.customers?.company || job.customers?.name || null;

    // Subcontracted jobs have no invoice of their own (the company that
    // sent the job handles billing on their end) — same exclusion
    // InvoicesView.tsx's own invoicedJobs uses.
    const isInvoiced = job.source !== "subcontractor" && (Boolean(job.invoice_sent_at) || Boolean(job.paid_date));

    if (isInvoiced) {
      if (!job.invoice_total_cents) {
        issues.push({ project_number: label, company, issue: "Invoice sent/paid but has no total", detail: "invoice_total_cents is null or 0", category: "invoice" });
      }
      if (!job.invoice_line_items || job.invoice_line_items.length === 0) {
        issues.push({ project_number: label, company, issue: "Invoice sent/paid but has no line items", category: "invoice" });
      }
      if (job.paid_date && job.payment_reversed_at) {
        issues.push({
          project_number: label,
          company,
          issue: "Paid, then reversed — needs a human look",
          detail: `paid ${formatDateMDY(job.paid_date)}, reversed ${formatDateMDY(job.payment_reversed_at)}`,
          category: "invoice",
        });
      }
      if (job.paid_date && job.payment_type === "online" && !job.stripe_invoice_id) {
        issues.push({ project_number: label, company, issue: "Marked paid online but has no Stripe invoice on record", category: "invoice" });
      }
      if (job.paid_date && job.stripe_invoice_id && !job.stripe_fee_cents && !job.payment_reversed_at) {
        issues.push({ project_number: label, company, issue: "Paid via Stripe but no processing fee was ever recorded", category: "invoice" });
      }
      if (!job.paid_date && job.invoice_sent_at && job.payment_type === "online" && !job.stripe_invoice_id) {
        issues.push({ project_number: label, company, issue: "Invoice sent for online payment but no Stripe invoice/pay link was ever created", category: "invoice" });
      }
    }

    // Lab invoice check — every job with fieldwork actually done, not just
    // invoiced ones (a job's lab bill can land before our own invoice ever
    // goes out — same reasoning LabInvoicesView's own weekly estimate
    // uses). Excludes FLI Environmental jobs entirely — FLI submits samples
    // to the lab under their own account and Commonwealth never gets a real
    // lab invoice for one of these (see knownLabCostCentsForJob's own
    // comment); without this exclusion every FLI job falsely read as
    // "missing" its lab invoice, confirmed live 2026-09-05 on job 26-0011.
    if (job.confirmed_date && job.source !== "subcontractor" && job.customers?.company_id !== FLI_ENVIRONMENTAL_COMPANY_ID) {
      const labDocs = (job.documents ?? []).filter((d) => d.kind === "lab_invoice");
      const distinctStoragePaths = new Set(labDocs.map((d) => d.storage_path));
      // Real, non-zero charges only — separate from distinctStoragePaths
      // above. A Sales Receipt copy (amount_cents deliberately null, see
      // processLabSalesReceiptEmail) or an already-corrected duplicate
      // (zeroed out, not deleted, per project_lab_cost_accuracy_fixes) can
      // never itself cause double-billing, so neither should count toward
      // "does this job have more than one real charge on file" — without
      // this exclusion both of those cases falsely tripped the check below,
      // confirmed live 2026-09-05 on jobs 26-0014 and 26-0015.
      //
      // Keyed by lab_invoice_number, not storage_path — confirmed live
      // 2026-09-05 (job 26-0002, same root cause fixed in BillingView's
      // weeklyLabInvoicePdfHrefs) that one uploaded PDF can bundle several
      // distinct real charges for the same job (one weekly/daily summary
      // covering multiple lab order numbers), all sharing one storage_path
      // — this undercounted 4 real charges as 2.
      const distinctRealCharges = new Set(
        labDocs.filter((d) => d.amount_cents != null && d.amount_cents > 0).map((d) => d.lab_invoice_number ?? d.storage_path)
      );
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
        issues.push({ project_number: label, company, issue: "No lab invoice on file yet", detail: `fieldwork done ${formatDateMDY(job.confirmed_date)}, that week is over`, category: "lab_invoice" });
      } else if (distinctRealCharges.size > 1) {
        // Not necessarily wrong — a job spanning multiple lab submission
        // weeks normally has several real charges — worth a glance, not an
        // alarm, hence "separate" rather than "verify not double-billed".
        issues.push({
          project_number: label,
          company,
          issue: "More than one separate lab invoice charge on this job",
          detail: `${distinctRealCharges.size} distinct charges on file`,
          category: "lab_invoice",
        });
      }
      if (labDocs.some((d) => d.invoice_mismatch)) {
        issues.push({ project_number: label, company, issue: "A lab invoice on file is flagged as not actually looking like an invoice", category: "lab_invoice" });
      }
      if (distinctStoragePaths.size >= 1 && !job.lab_cost_cents) {
        issues.push({ project_number: label, company, issue: "Lab invoice on file but no cost was ever recorded from it", category: "lab_invoice" });
      }
    }
  }

  return NextResponse.json({ jobsScanned: jobs.length, jobsWithIssues: new Set(issues.map((i) => i.project_number)).size, issues });
});
