import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { getSettings } from "@/lib/settings";
import { isWithinServiceStates } from "@/lib/geocode";
import { withApiErrors } from "@/lib/api-handler";
import { sendNewBookingRequestEmail, sendCustomerBookingReceivedEmail } from "@/lib/booking-notify";
import { generateProjectNumber } from "@/lib/project-number";
import { resolveServiceSelection } from "@/lib/portal-booking";
import { maybeSendImmediateAreaAlert } from "@/lib/area-health";

// Anonymous sibling of /api/portal/book — same acceptance rules
// (service-area + capacity) and same job shape, but identity comes from
// the form itself (name/email/phone) instead of a session, since a
// brand-new homeowner books the entire project before ever creating an
// account (see GuestBookingForm.tsx). Individuals only — a Company
// booking still requires signing in first (see /portal/page.tsx), so
// there's no "coordinate with job site contact" branch or company billing
// address to resolve here, unlike /api/portal/book.
export const POST = withApiErrors(async (req: NextRequest) => {
  const body = await req.json().catch(() => null);
  const {
    address, lat, lng, distanceMiles, state, serviceTypeKeys, date: requestedDate, requestedTime,
    notes, scopeOfWork, disclaimerAck,
    name, email, phone,
  } = body ?? {};

  const trimmedName = name?.trim();
  const trimmedEmail = email?.trim().toLowerCase();
  const trimmedPhone = phone?.trim();

  if (
    !address || lat == null || lng == null ||
    !Array.isArray(serviceTypeKeys) || serviceTypeKeys.length === 0 ||
    !requestedDate ||
    !trimmedName || !trimmedEmail || !trimmedPhone
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

  const supabase = getSupabaseAdmin();

  // Upsert-by-email, same pattern (and same reasoning) as the admin's own
  // Add Project route (src/app/api/admin/jobs/route.ts) — this email may
  // already have a customers row (a prior anonymous booking, or an
  // admin-entered project), so link that one rather than creating a
  // duplicate. auth_user_id is deliberately omitted from this payload: on
  // conflict, Postgres only touches the columns listed here, so an
  // already-linked account's auth_user_id survives untouched.
  const { data: customer, error: customerError } = await supabase
    .from("customers")
    .upsert(
      { name: trimmedName, email: trimmedEmail, phone: trimmedPhone, is_individual: true },
      { onConflict: "email" }
    )
    .select("*")
    .single();

  if (customerError || !customer) {
    throw new Error(`Failed to create customer: ${customerError?.message}`);
  }

  const projectNumber = await generateProjectNumber();

  const time: string | null = requestedTime || null;
  const derivedWindow = time ? (Number(time.slice(0, 2)) < 12 ? "AM" : "PM") : "ANY";

  const { data: job, error: jobError } = await supabase
    .from("jobs")
    .insert({
      project_number: projectNumber,
      customer_id: customer.id,
      service_address: address,
      lat, lng,
      // An individual booking on their own behalf IS the job site contact —
      // same reasoning as /api/portal/book.
      site_contact_name: trimmedName,
      site_contact_phone: trimmedPhone,
      service_type: serviceTypeLabel,
      base_fee_cents: baseFeeCents,
      per_sample_cents: matchedServiceTypes[0].per_sample_cents,
      requested_date: requestedDate,
      requested_time: time,
      window: derivedWindow,
      status: "needs_scheduling",
      // Marks this as a real customer request, same as an authenticated
      // portal booking — AcceptScheduleControl (JobRow/JobCard) keys off
      // this, not off whether the customer has finished creating a login.
      source: "portal_booking",
      notes: notes || null,
      scope_of_work: scopeOfWork || null,
      disclaimer_ack: true,
      distance_miles: distanceMiles ?? null,
      is_individual: true,
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
      customerName: trimmedName,
      company: null,
      address,
      serviceLabel: serviceTypeLabel,
      requestedDate,
      requestedTime: time,
      scopeOfWork,
      notes,
      siteContactName: trimmedName,
      siteContactPhone: trimmedPhone,
    });
  } catch (err) {
    console.error("New-booking-request owner alert failed:", err);
  }

  try {
    await sendCustomerBookingReceivedEmail({
      jobId: job.id,
      customerEmail: trimmedEmail,
      customerName: trimmedName,
      businessPhone: settings.business_phone,
      projectNumber,
      serviceLabel: serviceTypeLabel,
      address,
      requestedDate,
      requestedTime: time,
      scopeOfWork,
      notes,
    });
  } catch (err) {
    console.error("Customer booking-received confirmation failed:", err);
  }

  try {
    await maybeSendImmediateAreaAlert();
  } catch (err) {
    console.error("Area-health immediate check failed:", err);
  }

  return NextResponse.json({ ok: true, jobId: job.id, date: requestedDate });
});
