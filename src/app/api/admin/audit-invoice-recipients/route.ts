import { NextRequest, NextResponse } from "next/server";
import { requireOwnerApi } from "@/lib/admin-api";
import { getSupabaseAdminFresh } from "@/lib/supabase";
import { withApiErrors } from "@/lib/api-handler";
import type { Company, Customer, Job } from "@/lib/types";

type JobRow = Job & { customers: (Customer & { companies: Company | null }) | null };

function parseEmailList(s: string | null): string[] {
  return (s ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
}

// Per Tim, 2026-09-23 (Clean Joe/Donna) — found via the exact bug this
// audits for: new-job creation defaulted "Email invoice to" to the job's
// own contact (e.g. Donaldo) even when the company had a designated
// billing_contact_id (Donna) set, because the old fallback checked the job
// contact's email first and only ever fell back to billing_contact_id when
// that was empty (see jobs/route.ts's own fix comment, same date). That's
// fixed for new jobs going forward, but every job created before the fix —
// for any company that has a billing contact on file — could still have
// the wrong person in its invoice recipient list. Read-only (GET, no
// writes), same pattern as audit-invoices/audit-stripe-invoices: only
// scans jobs under a company that actually has billing_contact_id set,
// since that's the only case where "job contact" and "billing contact" can
// even disagree.
export const GET = withApiErrors(async (req: NextRequest) => {
  const unauthorized = requireOwnerApi(req);
  if (unauthorized) return unauthorized;

  const supabase = getSupabaseAdminFresh();
  const [{ data: jobsData, error: jobsError }, { data: allContacts, error: contactsError }] = await Promise.all([
    supabase
      .from("jobs")
      .select("*, customers!customer_id(*, companies!company_id(*))")
      .order("project_number", { ascending: true }),
    supabase.from("customers").select("id, name, email, company_id"),
  ]);
  if (jobsError) return NextResponse.json({ error: jobsError.message }, { status: 500 });
  if (contactsError) return NextResponse.json({ error: contactsError.message }, { status: 500 });

  const contactsById = new Map((allContacts ?? []).map((c) => [c.id, c]));
  const jobs = (jobsData ?? []) as unknown as JobRow[];

  const issues: {
    project_number: string | null;
    company: string | null;
    issue: string;
    detail?: string;
    severity: "warning" | "info";
  }[] = [];

  // Per Tim, 2026-09-23 — "it doesn't work" turned out to mean "it didn't
  // flag the company I expected," not a real error: the audit only ever
  // looks at a company that already HAS billing_contact_id set, so if that
  // was never actually saved (e.g. the dropdown pick didn't take, or the
  // new contact was added but never selected), the company's jobs are
  // silently skipped rather than flagged — which looks identical to "no
  // problem found" from the response alone. This makes that visible: every
  // company currently on file with a billing contact set, so a missing
  // one shows up immediately instead of by absence.
  const companiesWithBillingContact = new Map<string, { company: string; billing_contact: string; billing_contact_email: string | null; jobs: number }>();

  let jobsUnderBilledCompanies = 0;

  for (const job of jobs) {
    const company = job.customers?.companies ?? null;
    if (!company?.billing_contact_id) continue;
    jobsUnderBilledCompanies++;

    const billingContact = contactsById.get(company.billing_contact_id);
    const existing = companiesWithBillingContact.get(company.id);
    if (existing) existing.jobs++;
    else companiesWithBillingContact.set(company.id, { company: company.name, billing_contact: billingContact?.name ?? "(contact not found)", billing_contact_email: billingContact?.email ?? null, jobs: 1 });

    const billingEmail = billingContact?.email?.trim().toLowerCase() || null;
    if (!billingEmail) continue; // billing contact on file but has no email of their own — nothing to check against

    const label = job.project_number ?? job.id;
    const jobContactEmail = job.customers?.email?.trim().toLowerCase() || null;
    const invoiceEmails = parseEmailList(job.invoice_emails);

    if (invoiceEmails.length === 0) continue; // not set at all yet — a different, lower-stakes gap, not this bug

    const includesBilling = invoiceEmails.includes(billingEmail);

    if (jobContactEmail && jobContactEmail !== billingEmail && invoiceEmails.includes(jobContactEmail) && !includesBilling) {
      issues.push({
        project_number: label,
        company: company.name,
        issue: `Email invoice to still points at the job contact (${job.customers?.name ?? jobContactEmail}), not the billing contact (${billingContact?.name ?? billingEmail})`,
        detail: `invoice_emails: ${invoiceEmails.join(", ")}`,
        severity: "warning",
      });
    } else if (!includesBilling) {
      issues.push({
        project_number: label,
        company: company.name,
        issue: `Email invoice to doesn't include this company's billing contact (${billingContact?.name ?? billingEmail})`,
        detail: `invoice_emails: ${invoiceEmails.join(", ")}`,
        severity: "info",
      });
    }
  }

  return NextResponse.json({
    jobsScanned: jobs.length,
    jobsUnderCompaniesWithBillingContact: jobsUnderBilledCompanies,
    companiesWithBillingContact: Array.from(companiesWithBillingContact.values()),
    issues,
  });
});
