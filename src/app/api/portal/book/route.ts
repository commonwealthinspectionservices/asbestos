import { NextRequest, NextResponse } from "next/server";
import { requireContractorApi } from "@/lib/contractor-api";
import { getSupabaseAdmin } from "@/lib/supabase";
import { getSettings } from "@/lib/settings";
import { isWithinServiceStates } from "@/lib/geocode";
import { isDateFull, findNextAvailableDate } from "@/lib/capacity";
import { withApiErrors } from "@/lib/api-handler";
import { maybeSendImmediateAreaAlert } from "@/lib/area-health";
import { generateProjectNumber } from "@/lib/project-number";
import { resolveZoneBaseFeeCents } from "@/lib/pricing-zones";
import type { ServiceType } from "@/lib/types";

// Thinner sibling of /api/book's "submit" step: same acceptance rules
// (service-area + capacity), but identity comes from the session instead of
// a name/email/phone/billing form, since a returning contractor's info is
// already on file.
export const POST = withApiErrors(async (req: NextRequest) => {
  const auth = await requireContractorApi();
  if (auth.error) return auth.error;

  const body = await req.json().catch(() => null);
  const {
    address, lat, lng, distanceMiles, state, serviceTypeKey, date: requestedDate, window,
    scheduleViaContact, siteContactName, siteContactPhone, notes, scopeOfWork, disclaimerAck,
  } = body ?? {};

  if (
    !address || lat == null || lng == null || !serviceTypeKey ||
    (!scheduleViaContact && (!requestedDate || !window)) ||
    !siteContactName?.trim() || !siteContactPhone?.trim()
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

  const serviceType = settings.service_types.find((s: ServiceType) => s.key === serviceTypeKey);
  if (!serviceType) {
    return NextResponse.json({ error: "Unknown service type" }, { status: 400 });
  }
  const zoneBaseFeeCents = resolveZoneBaseFeeCents(address, settings.pricing_zones);
  const baseFeeCents = zoneBaseFeeCents ?? serviceType.base_fee_cents;

  // A contractor who'd rather have us coordinate directly with the on-site
  // contact skips picking a date/capacity slot entirely — the job lands in
  // "needs_scheduling" (same status/queue as an admin-added job with no
  // date yet) instead of "scheduled".
  let date: string | null = requestedDate ?? null;
  if (!scheduleViaContact) {
    let confirmedDate: string = requestedDate;
    if (await isDateFull(confirmedDate, settings.max_jobs_per_day)) {
      confirmedDate = await findNextAvailableDate(confirmedDate, settings.max_jobs_per_day);
    }
    date = confirmedDate;
  }

  const supabase = getSupabaseAdmin();
  const projectNumber = await generateProjectNumber();

  const { data: job, error: jobError } = await supabase
    .from("jobs")
    .insert({
      project_number: projectNumber,
      customer_id: auth.customer.id,
      service_address: address,
      lat, lng,
      site_contact_name: siteContactName || null,
      site_contact_phone: siteContactPhone || null,
      service_type: serviceType.label,
      base_fee_cents: baseFeeCents,
      per_sample_cents: serviceType.per_sample_cents,
      duration_minutes: serviceType.duration_minutes,
      requested_date: scheduleViaContact ? null : date,
      // The client just picked this themselves, so it's already "agreed" —
      // auto-confirmed rather than waiting on the admin to click "Confirm &
      // send to client" (that flow is for the admin's own later reschedules).
      confirmed_date: scheduleViaContact ? null : date,
      window: scheduleViaContact ? "ANY" : window,
      status: scheduleViaContact ? "needs_scheduling" : "scheduled",
      notes: notes || null,
      scope_of_work: scopeOfWork || null,
      disclaimer_ack: true,
      distance_miles: distanceMiles ?? null,
      is_homeowner: auth.customer.is_homeowner,
    })
    .select("*")
    .single();

  if (jobError || !job) {
    throw new Error(`Failed to create project: ${jobError?.message}`);
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
    dateChanged: !scheduleViaContact && date !== requestedDate,
  });
});
