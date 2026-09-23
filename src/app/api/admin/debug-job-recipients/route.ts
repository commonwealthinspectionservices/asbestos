import { NextRequest, NextResponse } from "next/server";
import { requireOwnerApi } from "@/lib/admin-api";
import { getSupabaseAdminFresh } from "@/lib/supabase";
import { withApiErrors } from "@/lib/api-handler";
import type { Company, Customer, Job } from "@/lib/types";

type JobRow = Job & { customers: (Customer & { companies: Company | null }) | null };

// Per Tim, 2026-09-23 — "check 26-0044": a quick one-off read to see why a
// specific job wasn't touched by fix-invoice-recipients, without guessing.
// ?project=26-0044 (or any project number). Read-only, no writes.
export const GET = withApiErrors(async (req: NextRequest) => {
  const unauthorized = requireOwnerApi(req);
  if (unauthorized) return unauthorized;

  const projectNumber = req.nextUrl.searchParams.get("project");
  if (!projectNumber) return NextResponse.json({ error: "?project=26-XXXX required" }, { status: 400 });

  const supabase = getSupabaseAdminFresh();
  const { data, error } = await supabase
    .from("jobs")
    .select("*, customers!customer_id(*, companies!company_id(*))")
    .eq("project_number", projectNumber)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: `No job found with project_number ${projectNumber}` }, { status: 404 });

  const job = data as unknown as JobRow;
  const company = job.customers?.companies ?? null;

  let billingContact: { id: string; name: string; email: string } | null = null;
  if (company?.billing_contact_id) {
    const { data: bc } = await supabase.from("customers").select("id, name, email").eq("id", company.billing_contact_id).maybeSingle();
    billingContact = bc ?? null;
  }

  return NextResponse.json({
    project_number: job.project_number,
    status: job.status,
    job_contact: { id: job.customers?.id, name: job.customers?.name, email: job.customers?.email },
    company: company ? { id: company.id, name: company.name } : null,
    company_billing_contact: billingContact,
    report_emails: job.report_emails,
    invoice_emails: job.invoice_emails,
    report_notes: job.report_notes,
  });
});
