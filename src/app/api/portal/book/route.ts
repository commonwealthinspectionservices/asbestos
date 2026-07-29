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
    siteContactName, siteContactPhone, notes, disclaimerAck,
  } = body ?? {};

  if (!address || lat == null || lng == null || !serviceTypeKey || !requestedDate || !window) {
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

  let date = requestedDate;
  if (await isDateFull(date, settings.max_jobs_per_day)) {
    date = await findNextAvailableDate(date, settings.max_jobs_per_day);
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
      service_type: serviceType.key,
      base_fee_cents: baseFeeCents,
      per_sample_cents: serviceType.per_sample_cents,
      duration_minutes: serviceType.duration_minutes,
      requested_date: date,
      window,
      status: "scheduled",
      notes: notes || null,
      disclaimer_ack: true,
      distance_miles: distanceMiles ?? null,
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

  return NextResponse.json({ ok: true, jobId: job.id, date, dateChanged: date !== requestedDate });
});
