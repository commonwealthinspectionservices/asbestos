import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { getSettings } from "@/lib/settings";
import { geocodeAddress, isWithinServiceArea, isWithinServiceStates, GeocodeError } from "@/lib/geocode";
import { countScheduledJobs, isDateFull, findNextAvailableDate } from "@/lib/capacity";
import { sendEmail, emailShell } from "@/lib/email";
import { sendNewBookingRequestEmail } from "@/lib/booking-notify";
import { serviceRateLabel } from "@/lib/pricing";
import { maybeSendImmediateAreaAlert } from "@/lib/area-health";
import { escapeHtml } from "@/lib/html";
import { generateProjectNumber } from "@/lib/project-number";
import { resolveZoneBaseFeeCents } from "@/lib/pricing-zones";
import type { ServiceType } from "@/lib/types";

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
      case "submit":
        return await handleSubmit(body);
      case "waitlist":
        return await handleWaitlist(body);
      default:
        return NextResponse.json({ error: "Unknown step" }, { status: 400 });
    }
  } catch (err) {
    console.error(`/api/book [${body.step}] failed:`, err);
    const message = err instanceof GeocodeError ? err.message : "Something went wrong. Please try again.";
    return NextResponse.json({ error: message }, { status: 500 });
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
      return { ...effective, rateLabel: serviceRateLabel(effective) };
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

interface SubmitBody {
  address: string;
  lat: number;
  lng: number;
  state: string | null;
  serviceTypeKey: string;
  date: string;
  window: "AM" | "PM" | "ANY";
  name: string;
  company?: string;
  email: string;
  phone: string;
  billingAddress: string;
  siteContactName?: string;
  siteContactPhone?: string;
  notes?: string;
  disclaimerAck: boolean;
  distanceMiles: number;
}

async function handleSubmit(body: SubmitBody) {
  const required: (keyof SubmitBody)[] = [
    "address", "lat", "lng", "serviceTypeKey", "date", "window",
    "name", "email", "phone", "billingAddress",
  ];
  for (const field of required) {
    if (body[field] === undefined || body[field] === null || body[field] === "") {
      return NextResponse.json({ error: `Missing field: ${field}` }, { status: 400 });
    }
  }
  if (!body.disclaimerAck) {
    return NextResponse.json({ error: "Disclaimer acknowledgement is required" }, { status: 400 });
  }

  const settings = await getSettings();

  // Re-validate service area and capacity server-side — never trust the
  // client for acceptance decisions. The state came from the address-check
  // step's geocode result (same trust level as the lat/lng also re-checked
  // here, not a fresh source of truth, but consistent with how this route
  // already handles those).
  const withinArea = isWithinServiceStates(body.state, settings.service_states);
  if (!withinArea) {
    return NextResponse.json({ error: "Address is outside the service area" }, { status: 400 });
  }

  const serviceType = settings.service_types.find((s: ServiceType) => s.key === body.serviceTypeKey);
  if (!serviceType) {
    return NextResponse.json({ error: "Unknown service type" }, { status: 400 });
  }
  const zoneBaseFeeCents = resolveZoneBaseFeeCents(body.address, settings.pricing_zones);
  const baseFeeCents = zoneBaseFeeCents ?? serviceType.base_fee_cents;

  // This is a request, not a firm booking anymore — record whatever date
  // they actually asked for rather than silently swapping it out here; the
  // owner sees the real ask and decides, same as the capacity check the
  // interactive form already surfaces before they ever hit submit.
  const date = body.date;

  const supabase = getSupabaseAdmin();

  const { data: customer, error: customerError } = await supabase
    .from("customers")
    .upsert(
      {
        name: body.name,
        company: body.company || null,
        email: body.email.toLowerCase(),
        phone: body.phone,
        billing_address: body.billingAddress,
      },
      { onConflict: "email" }
    )
    .select("*")
    .single();

  if (customerError || !customer) {
    throw new Error(`Failed to create customer: ${customerError?.message}`);
  }

  const projectNumber = await generateProjectNumber();

  const { data: job, error: jobError } = await supabase
    .from("jobs")
    .insert({
      project_number: projectNumber,
      customer_id: customer.id,
      service_address: body.address,
      lat: body.lat,
      lng: body.lng,
      site_contact_name: body.siteContactName || null,
      site_contact_phone: body.siteContactPhone || null,
      service_type: serviceType.key,
      base_fee_cents: baseFeeCents,
      per_sample_cents: serviceType.per_sample_cents,
      requested_date: date,
      window: body.window,
      // A request, not a confirmed booking — see requested_date's own
      // comment in schema.sql for the confirmed_date/time split this
      // relies on. Nothing becomes "scheduled" until the owner reviews the
      // request (see sendNewBookingRequestEmail below) and sets a real
      // confirmed_date/time from the admin dashboard.
      status: "needs_scheduling",
      notes: body.notes || null,
      disclaimer_ack: true,
      distance_miles: body.distanceMiles,
    })
    .select("*")
    .single();

  if (jobError || !job) {
    throw new Error(`Failed to create job: ${jobError?.message}`);
  }

  const receiptRows: [string, string][] = [
    ["Project #", projectNumber],
    ["Service", serviceType.label],
    ["Requested date", date],
    ["Window", body.window === "ANY" ? "No preference" : body.window],
    ["Address", body.address],
  ];
  if (body.company) receiptRows.push(["Company", body.company]);
  receiptRows.push(["Phone", body.phone]);
  receiptRows.push(["Billing address", body.billingAddress]);
  if (body.siteContactName || body.siteContactPhone) {
    receiptRows.push(["Site contact", [body.siteContactName, body.siteContactPhone].filter(Boolean).join(" — ")]);
  }
  if (body.notes) receiptRows.push(["Notes", body.notes]);

  const receiptTableRows = receiptRows
    .map(
      ([label, value]) =>
        `<tr><td style="padding:4px 8px 4px 0; color:#64748b; white-space:nowrap; vertical-align:top;">${escapeHtml(label)}</td><td>${escapeHtml(value)}</td></tr>`
    )
    .join("");

  await sendEmail({
    to: customer.email,
    subject: `Request received — ${date}`,
    html: emailShell(`
      <p>Hi ${escapeHtml(body.name)},</p>
      <p>We've received your inspection request. Here's what you sent:</p>
      <table style="width:100%; font-size:14px; color:#16213a;">${receiptTableRows}</table>
      <p style="margin-top:16px;">${escapeHtml(serviceRateLabel({ ...serviceType, base_fee_cents: baseFeeCents }))}</p>
      <p><strong>No payment is due today.</strong> We'll invoice you after the inspection, with 30 days to pay.</p>
      <p>We'll follow up shortly to confirm your date and time.</p>
    `),
  });

  try {
    await sendNewBookingRequestEmail({
      jobId: job.id,
      projectNumber,
      customerName: body.name,
      company: body.company,
      address: body.address,
      serviceLabel: serviceType.label,
      requestedDate: date,
      notes: body.notes,
      siteContactName: body.siteContactName,
      siteContactPhone: body.siteContactPhone,
    });
  } catch (err) {
    console.error("New-booking-request owner alert failed:", err);
  }

  // A new booking can shift the avg-distance/centroid metrics enough to
  // cross a threshold, so check right away rather than waiting for
  // Monday's digest. Awaited (serverless functions can be frozen right
  // after the response is sent, so fire-and-forget isn't reliable here);
  // failures are swallowed so they never fail the booking itself.
  try {
    await maybeSendImmediateAreaAlert();
  } catch (err) {
    console.error("Area-health immediate check failed:", err);
  }

  const dateChanged = date !== body.date;
  return NextResponse.json({ ok: true, jobId: job.id, date, dateChanged });
}

async function handleWaitlist(body: {
  address: string; lat: number; lng: number; distanceMiles: number;
  name: string; email: string; phone: string;
}) {
  const required = ["address", "lat", "lng", "name", "email", "phone"] as const;
  for (const field of required) {
    if (!body[field]) {
      return NextResponse.json({ error: `Missing field: ${field}` }, { status: 400 });
    }
  }

  const supabase = getSupabaseAdmin();

  const { data: customer, error: customerError } = await supabase
    .from("customers")
    .upsert(
      { name: body.name, email: body.email.toLowerCase(), phone: body.phone },
      { onConflict: "email" }
    )
    .select("*")
    .single();

  if (customerError || !customer) {
    throw new Error(`Failed to create customer: ${customerError?.message}`);
  }

  const { error: jobError } = await supabase.from("jobs").insert({
    customer_id: customer.id,
    service_address: body.address,
    lat: body.lat,
    lng: body.lng,
    status: "waitlist_out_of_area",
    distance_miles: body.distanceMiles,
  });

  if (jobError) {
    throw new Error(`Failed to create waitlist entry: ${jobError.message}`);
  }

  try {
    await maybeSendImmediateAreaAlert();
  } catch (err) {
    console.error("Area-health immediate check failed:", err);
  }

  return NextResponse.json({ ok: true });
}
