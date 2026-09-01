import { NextRequest, NextResponse } from "next/server";
import { getSettings } from "@/lib/settings";
import { geocodeAddress, isWithinServiceArea, isWithinServiceStates, GeocodeError, isGoogleApiFailure, logGeocodeFailure } from "@/lib/geocode";
import { isDateFull, findNextAvailableDate } from "@/lib/capacity";
import { serviceRateLabel, perSampleRateLabel } from "@/lib/pricing";
import { resolveZoneBaseFeeCents } from "@/lib/pricing-zones";

// Shared address/capacity checks behind the portal booking flow
// (PortalBookingForm.tsx) and the marketing site's pricing calculator
// (PricingCalculator.tsx) — the standalone anonymous booking form this
// route used to also serve ("submit"/"waitlist" steps) was retired along
// with BookingForm.tsx, since booking now always goes through the portal.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body.step !== "string") {
    return NextResponse.json({ error: "Missing step" }, { status: 400 });
  }

  try {
    switch (body.step) {
      case "address":
        return await handleAddress(body);
      case "date":
        return await handleDate(body);
      default:
        return NextResponse.json({ error: "Unknown step" }, { status: 400 });
    }
  } catch (err) {
    // A GeocodeError's raw message (e.g. "Could not geocode address:
    // OVER_QUERY_LIMIT") used to be shown to the customer verbatim —
    // fine-sounding for a genuine bad address, but a confusing internal
    // API status leak when it's actually a quota/billing failure on our
    // end. Distinguish the two: friendly "check your address" message for
    // a real no-match, generic "try again" (with loud server-side logging,
    // not a leaked status code) for an actual API failure.
    if (err instanceof GeocodeError) {
      logGeocodeFailure(err, `/api/book [${body.step}]`);
      const message = isGoogleApiFailure(err.status)
        ? "Something went wrong looking up that address. Please try again in a few minutes."
        : "We couldn't find that address — please double-check it and try again.";
      return NextResponse.json({ error: message }, { status: isGoogleApiFailure(err.status) ? 503 : 400 });
    }
    console.error(`/api/book [${body.step}] failed:`, err);
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}

async function handleAddress(body: { address?: string }) {
  const address = (body.address ?? "").trim();
  if (!address) {
    return NextResponse.json({ error: "Address is required" }, { status: 400 });
  }

  const settings = await getSettings();
  const geo = await geocodeAddress(address);
  // Licensing is per-state (MA-only for now), not a driving radius — see
  // isWithinServiceStates(). distanceMiles is still computed for the
  // area-health "how spread out are we" metrics, a separate concern.
  const withinArea = isWithinServiceStates(geo.state, settings.service_states);
  const { distanceMiles } = isWithinServiceArea(
    geo.lat,
    geo.lng,
    settings.service_area_center_lat,
    settings.service_area_center_lng,
    settings.service_radius_miles
  );

  // Base fee can vary by region (e.g. Berkshires/Connecticut cost more to
  // reach than the Boston metro core) — resolve it once here so both the
  // quoted rate shown to the customer and the job created at submit time
  // agree on the same number.
  const zoneBaseFeeCents = resolveZoneBaseFeeCents(geo.formattedAddress, settings.pricing_zones);

  return NextResponse.json({
    withinArea,
    distanceMiles: Math.round(distanceMiles * 100) / 100,
    lat: geo.lat,
    lng: geo.lng,
    state: geo.state,
    formattedAddress: geo.formattedAddress,
    serviceTypes: settings.service_types.map((s) => {
      const effective = zoneBaseFeeCents != null ? { ...s, base_fee_cents: zoneBaseFeeCents } : s;
      return { ...effective, rateLabel: serviceRateLabel(effective), perSampleLabel: perSampleRateLabel(effective) };
    }),
  });
}

async function handleDate(body: { date?: string }) {
  const date = body.date;
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "A valid date is required" }, { status: 400 });
  }

  const settings = await getSettings();
  const full = await isDateFull(date, settings.max_jobs_per_day);
  if (!full) {
    return NextResponse.json({ full: false, date });
  }

  const nextAvailable = await findNextAvailableDate(date, settings.max_jobs_per_day);
  return NextResponse.json({ full: true, date, nextAvailableDate: nextAvailable });
}
