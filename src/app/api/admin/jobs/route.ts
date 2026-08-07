import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { requireAdminApi } from "@/lib/admin-api";
import { getSettings } from "@/lib/settings";
import { generateProjectNumber } from "@/lib/project-number";
import { resolveZoneBaseFeeCents } from "@/lib/pricing-zones";
import { upsertCompany } from "@/lib/companies";
import { withApiErrors } from "@/lib/api-handler";
import { withCompanyBillingAddress } from "@/lib/customer-billing";
import type { Company, Customer, ServiceType } from "@/lib/types";

export const GET = withApiErrors(async (req: NextRequest) => {
  const unauthorized = requireAdminApi(req);
  if (unauthorized) return unauthorized;

  const url = new URL(req.url);
  const from = url.searchParams.get("from"); // YYYY-MM-DD, inclusive; defaults to today
  const statuses = url.searchParams.get("statuses")?.split(",");

  const supabase = getSupabaseAdmin();
  let query = supabase
    .from("jobs")
    .select("*, customers!customer_id(*, companies!company_id(*, billing_contact:customers!billing_contact_id(id, name, email, phone)))")
    .order("requested_date", { ascending: true })
    .order("created_at", { ascending: true });

  if (from) {
    query = query.gte("requested_date", from);
  }
  if (statuses?.length) {
    query = query.in("status", statuses);
  } else {
    query = query.neq("status", "waitlist_out_of_area");
  }

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  type JobRow = {
    customers: (Customer & { companies: (Company & { billing_contact: { id: string; name: string; email: string; phone: string } | null }) | null }) | null;
  };
  const jobs = (data as unknown as JobRow[]).map((job) => {
    const customer = job.customers;
    const billingContact = customer?.companies?.billing_contact ?? null;
    // Same fallback the invoice draft itself uses (draftInvoiceEmailForJob in
    // lib/lab-email.ts) — shown here so the Email tab can display who a
    // draft will actually reach before/after creating one.
    const reportRecipient = customer ? { name: customer.name, email: customer.email } : null;
    const invoiceRecipient = billingContact ?? reportRecipient;
    return {
      ...job,
      customers: customer ? withCompanyBillingAddress(customer, customer.companies) : customer,
      report_recipient: reportRecipient,
      invoice_recipient: invoiceRecipient,
    };
  });
  return NextResponse.json({ jobs });
});

// Gives the owner full autonomy to add a project directly — unlike
// /api/book (the public/contractor flow), this skips the service-area
// gate, capacity check, and geocoding entirely: it's his own business
// record, not a customer-facing acceptance decision. No confirmation
// email is sent — by the time he's logging a job here, he's typically
// already coordinated it directly with the contractor. Every field is
// optional — he often logs a project before all the details are in hand
// and fills the rest in later via Edit.
export const POST = withApiErrors(async (req: NextRequest) => {
  const unauthorized = requireAdminApi(req);
  if (unauthorized) return unauthorized;

  const body = await req.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const settings = await getSettings();
  const serviceTypeKeys: string[] = Array.isArray(body.serviceTypeKeys) ? body.serviceTypeKeys : [];
  const matchedTypes = settings.service_types.filter((s: ServiceType) => serviceTypeKeys.includes(s.key));
  const customServiceType: string | undefined = body.customServiceType?.trim() || undefined;
  const serviceTypeLabel =
    [...matchedTypes.map((s: ServiceType) => s.label), customServiceType].filter(Boolean).join(", ") || null;

  const zoneBaseFeeCents = body.serviceAddress
    ? resolveZoneBaseFeeCents(body.serviceAddress, settings.pricing_zones)
    : null;
  const baseFeeCents =
    zoneBaseFeeCents ?? (matchedTypes.length ? matchedTypes.reduce((sum: number, s: ServiceType) => sum + s.base_fee_cents, 0) : null);
  const perSampleCents = matchedTypes[0]?.per_sample_cents ?? null;

  const supabase = getSupabaseAdmin();

  let company = null;
  if (body.companyId) {
    const { data } = await supabase.from("companies").select("*").eq("id", body.companyId).single();
    company = data ?? null;
  } else if (body.company) {
    company = await upsertCompany(body.company, { billingAddress: body.billingAddress });
  }

  const name: string = body.name?.trim() || company?.name || "Unknown contact";
  const email: string = body.email?.trim() ? String(body.email).trim().toLowerCase() : `no-email+${randomUUID()}@placeholder.local`;

  const { data: customer, error: customerError } = await supabase
    .from("customers")
    .upsert(
      {
        name,
        company: company?.name ?? null,
        company_id: company?.id ?? null,
        email,
        phone: body.phone?.trim() || "",
        billing_address: company?.billing_address ?? body.billingAddress ?? null,
      },
      { onConflict: "email" }
    )
    .select("*")
    .single();

  if (customerError || !customer) {
    throw new Error(`Failed to create customer: ${customerError?.message}`);
  }

  const projectNumber = body.projectNumber?.trim() || (await generateProjectNumber());

  // The admin can pick an explicit starting status; otherwise fall back to
  // inferring it from whether a date is already set. This is a deliberate,
  // one-time choice made right here at creation — unlike the jobs PATCH
  // route, which no longer auto-advances status on a bare date edit (see
  // AcceptScheduleControl for that job's real promotion path).
  const startingStatus =
    body.status === "needs_scheduling" || body.status === "scheduled"
      ? body.status
      : body.requestedDate
      ? "scheduled"
      : "needs_scheduling";

  const newJob: Record<string, unknown> = {
    project_number: projectNumber,
    customer_id: customer.id,
    service_address: body.serviceAddress?.trim() || "",
    site_contact_name: body.siteContactName || null,
    site_contact_phone: body.siteContactPhone || null,
    service_type: serviceTypeLabel,
    scope_of_work: body.scopeOfWork || null,
    base_fee_cents: baseFeeCents,
    per_sample_cents: perSampleCents,
    requested_date: body.requestedDate || null,
    requested_time: body.requestedTime || null,
    // Hidden from the portal until the admin explicitly flips the "Visible
    // to customer" toggle (see JobRow) — schedule_visible_to_customer
    // defaults off, so confirmed_date/confirmed_time start null even when a
    // date's already set here.
    confirmed_date: null,
    confirmed_time: null,
    status: startingStatus,
    // Distinguishes a real customer request (AcceptScheduleControl only
    // shows for those) from a project the admin entered directly, which
    // may also start at "needs_scheduling" but has no request to accept.
    source: "admin",
    notes: body.notes || null,
    project_name: body.projectName || null,
    job_classification: body.jobClassification || null,
    payment_method: body.paymentMethod || null,
    po_number: body.poNumber || null,
    invoice_number: body.invoiceNumber || null,
    paid_date: body.paidDate || null,
    payment_due_date: body.paymentDueDate || null,
    report_emails: body.reportEmails || null,
    disclaimer_ack: true,
    // Defaults from the customer's portal-signup account type (see
    // customers.is_individual); the Invoice tab checkbox still lets the
    // admin override per job for customers without an account of their own.
    is_individual: customer.is_individual,
  };

  // These columns predate this route being written — tolerate a migration
  // not having been run yet rather than failing project creation entirely.
  const TOLERATED_MISSING_COLUMNS = ["report_emails", "scope_of_work", "payment_due_date", "confirmed_date", "confirmed_time"];
  let job = null;
  let jobError: { message?: string } | null = null;
  for (let attempt = 0; attempt <= TOLERATED_MISSING_COLUMNS.length; attempt++) {
    ({ data: job, error: jobError } = await supabase
      .from("jobs")
      .insert(newJob)
      .select("*, customers!customer_id(*)")
      .single());
    if (!jobError) break;
    const missingColumn = TOLERATED_MISSING_COLUMNS.find(
      (col) => col in newJob && new RegExp(col, "i").test(jobError?.message ?? "")
    );
    if (!missingColumn) break;
    delete newJob[missingColumn];
  }

  if (jobError || !job) {
    throw new Error(`Failed to create project: ${jobError?.message}`);
  }

  return NextResponse.json({ job });
});
