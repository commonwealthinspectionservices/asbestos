import { NextRequest, NextResponse } from "next/server";
import { requireContractorApi } from "@/lib/contractor-api";
import { getSupabaseAdmin } from "@/lib/supabase";
import { getSettings } from "@/lib/settings";
import { isWithinServiceStates } from "@/lib/geocode";
import { withApiErrors } from "@/lib/api-handler";
import { maybeSendImmediateAreaAlert } from "@/lib/area-health";
import { sendNewBookingRequestEmail, sendCustomerBookingReceivedEmail } from "@/lib/booking-notify";
import { generateProjectNumber } from "@/lib/project-number";
import { resolveServiceSelection } from "@/lib/portal-booking";
import { FLI_ENVIRONMENTAL_COMPANY_ID } from "@/lib/report-findings";

// Thinner sibling of /api/book's "submit" step: same acceptance rules
// (service-area + capacity), but identity comes from the session instead of
// a name/email/phone/billing form, since a returning contractor's info is
// already on file.
export const POST = withApiErrors(async (req: NextRequest) => {
  const auth = await requireContractorApi();
  if (auth.error) return auth.error;

  const body = await req.json().catch(() => null);
  const {
    address, lat, lng, distanceMiles, state, serviceTypeKeys, date: requestedDate, requestedTime,
    scheduleViaContact, siteContactName, siteContactPhone, notes, scopeOfWork, disclaimerAck,
    rush,
    fliProjectNumber, subcontractorClientCompany, subcontractorClientAddress,
    subcontractorClientContactName, subcontractorClientContactPhone, subcontractorClientContactEmail,
  } = body ?? {};

  // Server-side gate, not just PortalBookingForm.tsx only sending these
  // fields when it thinks it should — a raw request from a non-FLI
  // account can't plant subcontractor_client_* data on someone else's
  // job type just because the client happened to send it.
  const isFliEnvironmental = auth.customer.company_id === FLI_ENVIRONMENTAL_COMPANY_ID;

  // An individual booking on their own behalf IS the job site contact —
  // no separate "coordinate with job site contact" step exists for them
  // (see PortalBookingForm.tsx), so fall back to their own name/phone
  // instead of requiring it twice.
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
  if (!disclaimerAck) {
    return NextResponse.json({ error: "Disclaimer acknowledgement is required" }, { status: 400 });
  }

  const settings = await getSettings();

  const withinArea = isWithinServiceStates(state, settings.service_states);
  if (!withinArea) {
    return NextResponse.json({ error: "Address is outside the service area" }, { status: 400 });
  }

  const resolved = resolveServiceSelection(serviceTypeKeys, address, settings);
  if ("error" in resolved) {
    return NextResponse.json({ error: resolved.error }, { status: 400 });
  }
  const { matchedServiceTypes, serviceTypeLabel, baseFeeCents } = resolved;

  // Every booking is a request now, not a confirmed slot — whether they
  // picked a date or asked us to coordinate with the job site contact,
  // nothing becomes "scheduled" until the owner reviews it (see
  // sendNewBookingRequestEmail below) and sets a real confirmed_date/time
  // from the admin dashboard. Recording exactly what they asked for rather
  // than silently bumping a full date, same reasoning as /api/book.
  const date: string | null = requestedDate ?? null;

  const supabase = getSupabaseAdmin();
  const projectNumber = await generateProjectNumber();

  const time: string | null = scheduleViaContact ? null : requestedTime || null;
  // window (AM/PM/no-preference) predates requested_time (a real clock
  // time) — see requested_time's comment in schema.sql. Still derived and
  // stored since route-runner.ts's optimizer reads it as a coarse
  // constraint; requested_time itself is the more precise value shown
  // everywhere else.
  const derivedWindow = scheduleViaContact ? "ANY" : time ? (Number(time.slice(0, 2)) < 12 ? "AM" : "PM") : "ANY";

  const { data: job, error: jobError } = await supabase
    .from("jobs")
    .insert({
      project_number: projectNumber,
      customer_id: auth.customer.id,
      service_address: address,
      lat, lng,
      site_contact_name: resolvedSiteContactName || null,
      site_contact_phone: resolvedSiteContactPhone || null,
      service_type: serviceTypeLabel,
      base_fee_cents: baseFeeCents,
      per_sample_cents: matchedServiceTypes[0].per_sample_cents,
      // Per Tim, 2026-09-12 — same as the guest/individual booking flow
      // (api/portal/book-guest/route.ts's own comment): this is what makes
      // the form's Standard/Rush toggle preview match what actually gets
      // invoiced later (invoice-defaults.ts reads this same job.lab_turnaround).
      lab_turnaround: rush ? "Rush" : null,
      requested_date: scheduleViaContact ? null : date,
      requested_time: time,
      // No confirmed_date/time and no schedule_visible_to_customer here —
      // this is a request, not an agreed slot. Both stay unset until the
      // owner reviews it (see sendNewBookingRequestEmail below) and
      // confirms a real date/time from the admin dashboard.
      window: derivedWindow,
      status: "needs_scheduling",
      // Marks this as a real customer request — AcceptScheduleControl
      // (JobRow/JobCard) only shows for jobs with this source, not ones
      // the admin entered directly (see api/admin/jobs/route.ts).
      source: "portal_booking",
      notes: notes || null,
      scope_of_work: scopeOfWork || null,
      disclaimer_ack: true,
      distance_miles: distanceMiles ?? null,
      is_individual: auth.customer.is_individual,
      fli_project_number: isFliEnvironmental ? (fliProjectNumber || null) : null,
      subcontractor_client_company: isFliEnvironmental ? (subcontractorClientCompany || null) : null,
      subcontractor_client_address: isFliEnvironmental ? (subcontractorClientAddress || null) : null,
      subcontractor_client_contact_name: isFliEnvironmental ? (subcontractorClientContactName || null) : null,
      subcontractor_client_contact_phone: isFliEnvironmental ? (subcontractorClientContactPhone || null) : null,
      subcontractor_client_contact_email: isFliEnvironmental ? (subcontractorClientContactEmail || null) : null,
    })
    .select("*")
    .single();

  if (jobError || !job) {
    throw new Error(`Failed to create project: ${jobError?.message}`);
  }

  try {
    await sendNewBookingRequestEmail({
      jobId: job.id,
      projectNumber,
      customerName: auth.customer.name,
      company: auth.customer.company,
      address,
      serviceLabel: serviceTypeLabel,
      requestedDate: scheduleViaContact ? null : date,
      requestedTime: time,
      scheduleViaContact,
      scopeOfWork,
      notes,
      siteContactName: resolvedSiteContactName,
      siteContactPhone: resolvedSiteContactPhone,
    });
  } catch (err) {
    console.error("New-booking-request owner alert failed:", err);
  }

  if (auth.customer.email) {
    try {
      await sendCustomerBookingReceivedEmail({
        jobId: job.id,
        customerEmail: auth.customer.email,
        customerName: auth.customer.name,
        businessPhone: settings.business_phone,
        projectNumber,
        serviceLabel: serviceTypeLabel,
        address,
        requestedDate: scheduleViaContact ? null : date,
        requestedTime: time,
        scheduleViaContact,
        scopeOfWork,
        siteContactName: resolvedSiteContactName,
        siteContactPhone: resolvedSiteContactPhone,
        notes,
      });
    } catch (err) {
      console.error("Customer booking-received confirmation failed:", err);
    }
  }

  try {
    await maybeSendImmediateAreaAlert();
  } catch (err) {
    console.error("Area-health immediate check failed:", err);
  }

  return NextResponse.json({
    ok: true,
    jobId: job.id,
    date: scheduleViaContact ? null : date,
  });
});
