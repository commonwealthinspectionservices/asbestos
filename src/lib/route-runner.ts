import { getSupabaseAdmin } from "@/lib/supabase";
import { getSettings } from "@/lib/settings";
import { geocodeAddress } from "@/lib/geocode";
import { computeTravelTimeMatrixSeconds } from "@/lib/routes-api";
import { solveRoute, minutesToClock, parseHHMMToMinutes, type RouteStop } from "@/lib/routing";
import { zonedTimeToUtc } from "@/lib/tz";
import { buildMapsWaypointsUrl } from "@/lib/maps-link";
import { sendEmail, emailShell } from "@/lib/email";
import { maybeSendImmediateAreaAlert } from "@/lib/area-health";
import { escapeHtml } from "@/lib/html";
import { getAppUrl } from "@/lib/app-url";
import { estimateDurationMinutes } from "@/lib/pricing";
import type { JobWithCustomer } from "@/lib/types";

export interface RunMorningRouteResult {
  stopCount: number;
  totalDriveSeconds: number;
}

export async function runMorningRoute(dateIso: string): Promise<RunMorningRouteResult> {
  const settings = await getSettings();
  const supabase = getSupabaseAdmin();
  const ownerEmail = process.env.OWNER_EMAIL || settings.base_address; // OWNER_EMAIL is required; see .env.example

  const { data: jobs, error } = await supabase
    .from("jobs")
    .select("*, customers!customer_id(*)")
    .eq("requested_date", dateIso)
    .eq("status", "scheduled")
    .order("created_at", { ascending: true });

  if (error) throw new Error(`Failed to load projects: ${error.message}`);

  const weekdayLabel = new Date(`${dateIso}T12:00:00Z`).toLocaleDateString("en-US", {
    weekday: "long", month: "short", day: "numeric", timeZone: settings.timezone,
  });

  if (!jobs || jobs.length === 0) {
    await sendEmail({
      to: process.env.OWNER_EMAIL!,
      subject: `Route for ${weekdayLabel} — no projects today`,
      html: emailShell(`<p>No projects are scheduled for ${weekdayLabel}. Nothing to route.</p>`),
    });
    return { stopCount: 0, totalDriveSeconds: 0 };
  }

  const jobList = jobs as unknown as JobWithCustomer[];

  const base = await geocodeAddress(settings.base_address);
  const locations = [
    { lat: base.lat, lng: base.lng },
    ...jobList.map((j) => ({ lat: j.lat as number, lng: j.lng as number })),
  ];

  // The Routes API rejects a departureTime that isn't in the future. That's
  // normally workday_start, but "recompute today's route" can be triggered
  // any time during the day (e.g. after a job is added/cancelled), by which
  // point workday_start has already passed — fall back to "now" so the
  // traffic-aware matrix is always requestable.
  const workdayStartUtc = zonedTimeToUtc(dateIso, settings.workday_start, settings.timezone);
  const departureTime = new Date(Math.max(workdayStartUtc.getTime(), Date.now() + 60_000));
  const matrix = await computeTravelTimeMatrixSeconds(locations, departureTime);

  const stops: RouteStop[] = jobList.map((j) => {
    const totalSamples = Object.values(j.sample_counts ?? {}).reduce((sum, n) => sum + (n || 0), 0) || j.sample_count || 0;
    return {
      id: j.id,
      window: j.window,
      durationMinutes: j.duration_minutes ?? estimateDurationMinutes(totalSamples, settings.default_service_minutes),
    };
  });

  const workdayStartMinutes = parseHHMMToMinutes(settings.workday_start);
  const workdayEndMinutes = parseHHMMToMinutes(settings.workday_end);

  const result = solveRoute({
    matrixSeconds: matrix,
    stops,
    workdayStartMinutes,
    workdayEndMinutes,
  });

  const orderedJobs = result.order.map((stopIdx) => jobList[stopIdx]);
  const orderedJobIds = orderedJobs.map((j) => j.id);

  // Per-leg drive seconds in visiting order (leg 0 = base -> first stop),
  // read straight from the matrix so the area-health monitor can compute
  // inter-stop drive time without re-deriving it from schedule timestamps.
  const legSeconds: number[] = [];
  let prevMatrixIdx = 0;
  for (const stopIdx of result.order) {
    const matrixIdx = stopIdx + 1;
    legSeconds.push(matrix[prevMatrixIdx][matrixIdx]);
    prevMatrixIdx = matrixIdx;
  }

  // Re-running the route for a date (e.g. via "recompute today's route")
  // should replace, not accumulate — otherwise a date recomputed several
  // times would be over-weighted in the area-health trailing averages.
  await supabase.from("daily_routes").delete().eq("route_date", dateIso);

  const { data: routeRecord } = await supabase
    .from("daily_routes")
    .insert({
      route_date: dateIso,
      ordered_job_ids: orderedJobIds,
      leg_seconds: legSeconds,
      total_drive_seconds: result.totalDriveSeconds,
    })
    .select("*")
    .single();

  const totalHours = (result.totalDriveSeconds / 3600).toFixed(1);
  const lastSchedule = result.schedule[result.schedule.length - 1];
  const finishTime = lastSchedule ? minutesToClock(lastSchedule.departMinutes) : "—";

  const mapsUrl = buildMapsWaypointsUrl(
    settings.base_address,
    orderedJobs.map((j) => j.service_address)
  );

  const appUrl = getAppUrl();

  const stopRows = result.schedule
    .map((s, i) => {
      const job = orderedJobs[i];
      const customer = job.customers;
      const eta = minutesToClock(s.arrivalMinutes);
      const companyLabel = customer?.company ? ` (${escapeHtml(customer.company)})` : "";
      return `
        <tr>
          <td style="padding:10px 0; border-top:1px solid #e2e8f0; vertical-align:top; font-size:14px;">
            <div style="font-weight:600;">#${i + 1} · ${eta} · ${escapeHtml(customer?.name ?? "")}${companyLabel} · ${escapeHtml(job.service_type ?? "")}</div>
            <div style="color:#475569;">${escapeHtml(job.service_address)}</div>
            <div style="color:#475569;">
              ${customer?.phone ? `<a href="tel:${escapeHtml(customer.phone)}" style="color:#1f3f80;">${escapeHtml(customer.phone)}</a>` : ""}
              ${job.notes ? ` · ${escapeHtml(job.notes)}` : ""}
            </div>
          </td>
        </tr>`;
    })
    .join("");

  await sendEmail({
    to: process.env.OWNER_EMAIL!,
    subject: `Route for ${weekdayLabel} — ${orderedJobs.length} stops, ~${totalHours}h drive`,
    html: emailShell(`
      <p style="margin:0 0 4px; font-size:15px; color:#16213a;"><strong>${weekdayLabel}</strong></p>
      <p style="margin:0 0 16px; color:#475569;">${orderedJobs.length} stops · ~${totalHours}h total drive · finish ~${finishTime}</p>
      <table style="width:100%; border-collapse:collapse;">${stopRows}</table>
      <p style="margin-top:20px;">
        <a href="${mapsUrl}" style="display:inline-block; background:#193466; color:#fff; padding:10px 16px; border-radius:8px; text-decoration:none; font-size:14px;">Open route in Google Maps</a>
      </p>
      ${appUrl ? `<p style="margin-top:12px; font-size:13px;"><a href="${appUrl}/admin/dashboard" style="color:#1f3f80;">Open admin dashboard</a></p>` : ""}
    `),
  });

  if (routeRecord) {
    await supabase
      .from("daily_routes")
      .update({ sent_at: new Date().toISOString() })
      .eq("id", routeRecord.id);
  }

  // A freshly computed route can push the inter-stop drive-time metric over
  // its threshold; check now rather than waiting for Monday's digest.
  try {
    await maybeSendImmediateAreaAlert();
  } catch (err) {
    console.error("Area-health immediate check failed:", err);
  }

  return { stopCount: orderedJobs.length, totalDriveSeconds: result.totalDriveSeconds };
}
