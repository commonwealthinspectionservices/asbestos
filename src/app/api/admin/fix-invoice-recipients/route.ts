import { NextRequest, NextResponse } from "next/server";
import { requireOwnerApi } from "@/lib/admin-api";
import { getSupabaseAdminFresh } from "@/lib/supabase";
import { withApiErrors } from "@/lib/api-handler";
import type { Company, Customer, Job } from "@/lib/types";

type JobRow = Job & { customers: (Customer & { companies: Company | null }) | null };

function parseEmailList(s: string | null): string[] {
  return (s ?? "").split(",").map((e) => e.trim()).filter(Boolean);
}

// Per Tim, 2026-09-23 — the fix half of audit-invoice-recipients (see that
// route's own comment for the underlying bug). GET, not POST, and safe to
// run repeatedly — same "idempotent, re-runnable" shape as
// reconcile-stripe-paid-invoices: re-derives the correct state fresh each
// call rather than trusting a client-held snapshot of prior audit results.
//
// Two things, run every time this is hit:
// 1. Clean Joe/Donna — a one-off, hardcoded setup (per Tim: "the billing
//    contact for clean joe should always be dconte@cleanjoe.com Donna
//    Conte"), not a general "make up a billing contact" feature. Only
//    acts if Clean Joe doesn't already have this exact contact as its
//    billing_contact_id — reuses an existing contact with this email
//    under Clean Joe if one exists, otherwise creates it.
// 2. Every job under ANY company that has a billing_contact_id set (now
//    including Clean Joe, freshly set by step 1) whose invoice_emails
//    still contains the job's own contact instead of the billing
//    contact — swaps the job contact's email out for the billing
//    contact's, keeping any other manually-added recipients untouched.
//    Same swap semantics as JobsDashboard's own selectContact fix
//    (e474a10) — never touches report_emails, which is supposed to keep
//    going to the job's own contact.
export const GET = withApiErrors(async (req: NextRequest) => {
  const unauthorized = requireOwnerApi(req);
  if (unauthorized) return unauthorized;

  const supabase = getSupabaseAdminFresh();
  const cleanJoeFix: { action: string; detail?: string } = { action: "none" };

  const { data: cleanJoe } = await supabase.from("companies").select("*").ilike("name", "clean joe").maybeSingle();
  if (cleanJoe) {
    const { data: existingBillingContact } = cleanJoe.billing_contact_id
      ? await supabase.from("customers").select("id, email").eq("id", cleanJoe.billing_contact_id).maybeSingle()
      : { data: null };

    if (existingBillingContact?.email?.trim().toLowerCase() === "dconte@cleanjoe.com") {
      cleanJoeFix.action = "already_set";
    } else {
      const { data: donna } = await supabase
        .from("customers")
        .select("id")
        .eq("company_id", cleanJoe.id)
        .ilike("email", "dconte@cleanjoe.com")
        .maybeSingle();

      let donnaId = donna?.id ?? null;
      if (!donnaId) {
        const { data: created, error: createError } = await supabase
          .from("customers")
          .insert({ name: "Donna Conte", email: "dconte@cleanjoe.com", phone: "", company: cleanJoe.name, company_id: cleanJoe.id, is_individual: false })
          .select("id")
          .single();
        if (createError) {
          cleanJoeFix.action = "error";
          cleanJoeFix.detail = createError.message;
        } else {
          donnaId = created.id;
          cleanJoeFix.action = "created_contact_and_set_billing";
        }
      } else {
        cleanJoeFix.action = "set_billing_from_existing_contact";
      }

      if (donnaId) {
        const { error: updateError } = await supabase.from("companies").update({ billing_contact_id: donnaId }).eq("id", cleanJoe.id);
        if (updateError) {
          cleanJoeFix.action = "error";
          cleanJoeFix.detail = updateError.message;
        }
      }
    }
  } else {
    cleanJoeFix.action = "clean_joe_company_not_found";
  }

  // Re-fetch fresh — Clean Joe's billing_contact_id may have just changed
  // above, and this needs to see that.
  const [{ data: jobsData, error: jobsError }, { data: allContacts, error: contactsError }] = await Promise.all([
    supabase.from("jobs").select("*, customers!customer_id(*, companies!company_id(*))").order("project_number", { ascending: true }),
    supabase.from("customers").select("id, name, email, company_id"),
  ]);
  if (jobsError) return NextResponse.json({ error: jobsError.message }, { status: 500 });
  if (contactsError) return NextResponse.json({ error: contactsError.message }, { status: 500 });

  const contactsById = new Map((allContacts ?? []).map((c) => [c.id, c]));
  const jobs = (jobsData ?? []) as unknown as JobRow[];

  const fixed: { project_number: string | null; company: string | null; from: string; to: string }[] = [];
  const errors: { project_number: string | null; error: string }[] = [];

  for (const job of jobs) {
    const company = job.customers?.companies ?? null;
    if (!company?.billing_contact_id) continue;

    const billingContact = contactsById.get(company.billing_contact_id);
    const billingEmail = billingContact?.email?.trim().toLowerCase() || null;
    if (!billingEmail) continue;

    const jobContactEmail = job.customers?.email?.trim().toLowerCase() || null;
    const invoiceEmails = parseEmailList(job.invoice_emails);
    if (invoiceEmails.length === 0) continue;

    const lower = invoiceEmails.map((e) => e.toLowerCase());
    if (!jobContactEmail || jobContactEmail === billingEmail) continue;
    if (!lower.includes(jobContactEmail) || lower.includes(billingEmail)) continue;

    const newList = invoiceEmails.filter((e) => e.trim().toLowerCase() !== jobContactEmail);
    newList.push(billingContact!.email);
    const newValue = newList.join(", ");

    const { error: updateError } = await supabase.from("jobs").update({ invoice_emails: newValue }).eq("id", job.id);
    if (updateError) {
      errors.push({ project_number: job.project_number ?? job.id, error: updateError.message });
      continue;
    }
    fixed.push({ project_number: job.project_number ?? job.id, company: company.name, from: job.invoice_emails ?? "", to: newValue });
  }

  return NextResponse.json({ cleanJoeFix, jobsScanned: jobs.length, fixed, errors });
});
