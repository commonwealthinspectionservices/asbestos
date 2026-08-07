import { NextRequest, NextResponse } from "next/server";
import { requireContractorApi, getCompanyCustomerIds } from "@/lib/contractor-api";
import { getSupabaseAdmin } from "@/lib/supabase";
import { getSettings } from "@/lib/settings";
import { isWithinServiceStates } from "@/lib/geocode";
import { resolveServiceSelection } from "@/lib/portal-booking";
import { withApiErrors } from "@/lib/api-handler";

// Two independent things this route can do to an existing job:
// 1. Always-allowed fields (report_emails, billing_contact_id) — who this
//    specific job's results/invoice go to, editable regardless of status.
// 2. The "request" itself (address, service types, scope, requested date/
//    time, notes, site contact) — editable only while job.status is still
//    "needs_scheduling" (see PendingRequestEditor.tsx). Once the owner
//    accepts it via AcceptScheduleControl, this locks — see the 409 below.
export const PATCH = withApiErrors(async (
  req: NextRequest,
  { params }: { params: { id: string } }
) => {
  const auth = await requireContractorApi();
  if (auth.error) return auth.error;

  const companyCustomerIds = await getCompanyCustomerIds(auth.customer);

  const supabase = getSupabaseAdmin();
  const { data: job } = await supabase
    .from("jobs")
    .select("*")
    .eq("id", params.id)
    .in("customer_id", companyCustomerIds)
    .maybeSingle();
  if (!job) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  const body = await req.json().catch(() => null);
  const patch: Record<string, unknown> = {};

  // Self is always included via the existing customer.email fallback (see
  // draftInvoiceEmailForJob in lib/lab-email.ts) — report_emails only ever
  // needs to carry the *additional* selected contacts.
  if (Array.isArray(body?.resultRecipientEmails)) {
    const selfEmail = auth.customer.email.toLowerCase();
    const emails = Array.from(
      new Set(
        body.resultRecipientEmails
          .map((e: unknown) => String(e).trim().toLowerCase())
          .filter((e: string) => e && e !== selfEmail)
      )
    );
    patch.report_emails = emails.length ? emails.join(",") : null;
  }

  if ("billingContactId" in (body ?? {})) {
    const billingContactId = body.billingContactId;
    if (billingContactId) {
      const { data: contact } = await supabase
        .from("customers")
        .select("id, company_id")
        .eq("id", billingContactId)
        .maybeSingle();
      if (!contact || !auth.customer.company_id || contact.company_id !== auth.customer.company_id) {
        return NextResponse.json({ error: "Invalid billing contact" }, { status: 400 });
      }
    }
    patch.billing_contact_id = billingContactId || null;
  }

  if (body?.request) {
    // Not malformed input — the target's state just changed underneath this
    // request (the owner accepted it) — so this is a 409, not a 400.
    if (job.status !== "needs_scheduling") {
      return NextResponse.json(
        { error: "This request has already been accepted and can no longer be edited." },
        { status: 409 }
      );
    }

    const {
      address, lat, lng, distanceMiles, state, serviceTypeKeys, date: requestedDate, requestedTime,
      scheduleViaContact, siteContactName, siteContactPhone, notes, scopeOfWork,
    } = body.request ?? {};

    // Same fallback as creation (api/portal/book/route.ts) — an individual
    // booking on their own behalf IS the job site contact.
    const resolvedSiteContactName = siteContactName?.trim() || (auth.customer.is_individual ? auth.customer.name : "");
    const resolvedSiteContactPhone = siteContactPhone?.trim() || (auth.customer.is_individual ? auth.customer.phone : "");

    if (
      !address || lat == null || lng == null ||
      !Array.isArray(serviceTypeKeys) || serviceTypeKeys.length === 0 ||
      (!scheduleViaContact && !requestedDate) ||
      !resolvedSiteContactName?.trim() || !resolvedSiteContactPhone?.trim()
    ) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const settings = await getSettings();

    if (!isWithinServiceStates(state, settings.service_states)) {
      return NextResponse.json({ error: "Address is outside the service area" }, { status: 400 });
    }

    const resolved = resolveServiceSelection(serviceTypeKeys, address, settings);
    if ("error" in resolved) {
      return NextResponse.json({ error: resolved.error }, { status: 400 });
    }

    const time: string | null = scheduleViaContact ? null : requestedTime || null;
    const derivedWindow = scheduleViaContact ? "ANY" : time ? (Number(time.slice(0, 2)) < 12 ? "AM" : "PM") : "ANY";

    Object.assign(patch, {
      service_address: address,
      lat, lng,
      distance_miles: distanceMiles ?? null,
      site_contact_name: resolvedSiteContactName || null,
      site_contact_phone: resolvedSiteContactPhone || null,
      service_type: resolved.serviceTypeLabel,
      base_fee_cents: resolved.baseFeeCents,
      per_sample_cents: resolved.perSampleCents,
      requested_date: scheduleViaContact ? null : requestedDate,
      requested_time: time,
      window: derivedWindow,
      notes: notes || null,
      scope_of_work: scopeOfWork || null,
    });
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "No editable fields provided" }, { status: 400 });
  }

  const { error } = await supabase.from("jobs").update(patch).eq("id", params.id);
  if (error) throw new Error(error.message);
  return NextResponse.json({ ok: true });
});
