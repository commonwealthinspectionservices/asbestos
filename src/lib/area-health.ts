import { getSupabaseAdmin } from "@/lib/supabase";
import { getSettings } from "@/lib/settings";
import { haversineMiles, compassBearing } from "@/lib/geocode";
import { sendEmail, emailShell } from "@/lib/email";
import type { Settings } from "@/lib/types";

const WINDOW_DAYS = 28;

export interface ThresholdCrossing {
  key: string;
  message: string;
}

export interface AreaHealthMetrics {
  windowStart: string;
  windowEnd: string;
  avgInterStopDriveMinutes: number | null;
  medianInterStopDriveMinutes: number | null;
  avgTotalDriveMinutesPerJob: number | null;
  avgJobDistanceMiles: number | null;
  centroidDistanceMiles: number | null;
  centroidBearing: string | null;
  jobCount: number;
  nearMissCount: number;
  totalWaitlistCount: number;
  crossings: ThresholdCrossing[];
}

function median(nums: number[]): number | null {
  if (nums.length === 0) return null;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function average(nums: number[]): number | null {
  if (nums.length === 0) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

export async function computeAreaHealthMetrics(): Promise<AreaHealthMetrics> {
  const settings = await getSettings();
  const supabase = getSupabaseAdmin();

  const windowEnd = new Date();
  const windowStart = new Date(windowEnd.getTime() - WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const windowStartIso = windowStart.toISOString();
  const windowEndIso = windowEnd.toISOString();

  // Route density: inter-stop drive legs from completed daily routes,
  // excluding leg 0 (base -> first stop) which is the inbound commute.
  const { data: routes } = await supabase
    .from("daily_routes")
    .select("leg_seconds, total_drive_seconds, ordered_job_ids")
    .gte("route_date", windowStart.toISOString().slice(0, 10))
    .lte("route_date", windowEnd.toISOString().slice(0, 10));

  const interStopMinutes: number[] = [];
  const totalDriveMinutesPerJob: number[] = [];
  for (const route of routes ?? []) {
    const legs = (route.leg_seconds as number[]) ?? [];
    const stopCount = (route.ordered_job_ids as string[])?.length ?? 0;
    if (legs.length > 1) {
      for (const seconds of legs.slice(1)) interStopMinutes.push(seconds / 60);
    }
    if (stopCount > 0) {
      totalDriveMinutesPerJob.push((route.total_drive_seconds as number) / 60 / stopCount);
    }
  }

  // Spatial drift: distance/bearing of booked jobs from the configured center.
  const { data: jobs } = await supabase
    .from("jobs")
    .select("lat, lng, distance_miles")
    .gte("created_at", windowStartIso)
    .lte("created_at", windowEndIso)
    .not("status", "eq", "waitlist_out_of_area")
    .not("status", "eq", "cancelled")
    .not("lat", "is", null)
    .not("lng", "is", null);

  const jobPoints = (jobs ?? []) as { lat: number; lng: number; distance_miles: number | null }[];
  const avgJobDistanceMiles = average(
    jobPoints.map((j) => j.distance_miles).filter((d): d is number => d != null)
  );

  let centroidDistanceMiles: number | null = null;
  let centroidBearing: string | null = null;
  if (jobPoints.length > 0) {
    const centroidLat = average(jobPoints.map((j) => j.lat))!;
    const centroidLng = average(jobPoints.map((j) => j.lng))!;
    centroidDistanceMiles = haversineMiles(
      settings.service_area_center_lat, settings.service_area_center_lng,
      centroidLat, centroidLng
    );
    centroidBearing = compassBearing(
      settings.service_area_center_lat, settings.service_area_center_lng,
      centroidLat, centroidLng
    );
  }

  // Turned-away demand: waitlist entries, and the near-miss subset just outside the line.
  const { data: waitlist } = await supabase
    .from("jobs")
    .select("distance_miles")
    .eq("status", "waitlist_out_of_area")
    .gte("created_at", windowStartIso)
    .lte("created_at", windowEndIso);

  const waitlistJobs = (waitlist ?? []) as { distance_miles: number | null }[];
  const nearMissCount = waitlistJobs.filter(
    (j) =>
      j.distance_miles != null &&
      j.distance_miles > settings.service_radius_miles &&
      j.distance_miles <= settings.service_radius_miles + 2
  ).length;

  const avgInterStopDriveMinutes = average(interStopMinutes);
  const medianInterStopDriveMinutes = median(interStopMinutes);
  const avgTotalDriveMinutesPerJob = average(totalDriveMinutesPerJob);

  const crossings = evaluateThresholds(settings, {
    medianInterStopDriveMinutes,
    avgJobDistanceMiles,
    nearMissCount,
    centroidDistanceMiles,
  });

  return {
    windowStart: windowStartIso,
    windowEnd: windowEndIso,
    avgInterStopDriveMinutes,
    medianInterStopDriveMinutes,
    avgTotalDriveMinutesPerJob,
    avgJobDistanceMiles,
    centroidDistanceMiles,
    centroidBearing,
    jobCount: jobPoints.length,
    nearMissCount,
    totalWaitlistCount: waitlistJobs.length,
    crossings,
  };
}

export function evaluateThresholds(
  settings: Settings,
  m: {
    medianInterStopDriveMinutes: number | null;
    avgJobDistanceMiles: number | null;
    nearMissCount: number;
    centroidDistanceMiles: number | null;
  }
): ThresholdCrossing[] {
  const crossings: ThresholdCrossing[] = [];

  if (m.medianInterStopDriveMinutes != null && m.medianInterStopDriveMinutes > settings.alert_interstop_minutes) {
    crossings.push({
      key: "interstop",
      message: `Median drive time between stops is ${m.medianInterStopDriveMinutes.toFixed(1)} min, above your ${settings.alert_interstop_minutes} min threshold.`,
    });
  }
  if (m.avgJobDistanceMiles != null && m.avgJobDistanceMiles > settings.alert_avg_distance_miles) {
    crossings.push({
      key: "avg_distance",
      message: `Average project distance from center is ${m.avgJobDistanceMiles.toFixed(2)} mi, above your ${settings.alert_avg_distance_miles} mi threshold.`,
    });
  }
  if (m.nearMissCount > settings.alert_nearmiss_count) {
    crossings.push({
      key: "nearmiss",
      message: `${m.nearMissCount} near-miss out-of-area requests in the trailing 4 weeks, above your threshold of ${settings.alert_nearmiss_count}.`,
    });
  }
  if (m.centroidDistanceMiles != null && m.centroidDistanceMiles > settings.alert_centroid_offset_miles) {
    crossings.push({
      key: "centroid",
      message: `Demand centroid has drifted ${m.centroidDistanceMiles.toFixed(2)} mi from your configured center, above your ${settings.alert_centroid_offset_miles} mi threshold.`,
    });
  }

  return crossings;
}

function buildDigestEmailHtml(metrics: AreaHealthMetrics): string {
  const verdict =
    metrics.crossings.length === 0
      ? `<p style="font-size:15px;">✅ <strong>Your concentration assumption is holding</strong> — projects are tightly clustered near your center.</p>`
      : `<p style="font-size:15px;">⚠️ <strong>Heads up:</strong> ${metrics.crossings.map((c) => c.message).join(" ")} You may want to adjust your service area.</p>`;

  const fmt = (n: number | null, digits = 1) => (n == null ? "—" : n.toFixed(digits));

  return emailShell(`
    <p style="margin:0 0 12px; color:#475569;">Trailing 4-week service-area health check.</p>
    <table style="width:100%; font-size:14px; border-collapse:collapse;">
      <tr><td style="padding:6px 0; color:#64748b;">Median inter-stop drive time</td><td>${fmt(metrics.medianInterStopDriveMinutes)} min</td></tr>
      <tr><td style="padding:6px 0; color:#64748b;">Avg inter-stop drive time</td><td>${fmt(metrics.avgInterStopDriveMinutes)} min</td></tr>
      <tr><td style="padding:6px 0; color:#64748b;">Avg total drive per project</td><td>${fmt(metrics.avgTotalDriveMinutesPerJob)} min</td></tr>
      <tr><td style="padding:6px 0; color:#64748b;">Avg project distance from center</td><td>${fmt(metrics.avgJobDistanceMiles, 2)} mi</td></tr>
      <tr><td style="padding:6px 0; color:#64748b;">Demand centroid drift</td><td>${fmt(metrics.centroidDistanceMiles, 2)} mi ${metrics.centroidBearing ?? ""}</td></tr>
      <tr><td style="padding:6px 0; color:#64748b;">Booked projects in window</td><td>${metrics.jobCount}</td></tr>
      <tr><td style="padding:6px 0; color:#64748b;">Out-of-area near-misses (4–6 mi)</td><td>${metrics.nearMissCount}</td></tr>
      <tr><td style="padding:6px 0; color:#64748b;">Total waitlist requests</td><td>${metrics.totalWaitlistCount}</td></tr>
    </table>
    <div style="margin-top:20px; padding:12px 16px; background:#f8fafc; border-radius:8px;">${verdict}</div>
  `);
}

export async function sendWeeklyAreaHealthDigest(): Promise<AreaHealthMetrics> {
  const metrics = await computeAreaHealthMetrics();
  await sendEmail({
    to: process.env.OWNER_EMAIL!,
    subject: metrics.crossings.length === 0
      ? "Service-area health: ✅ looking good"
      : "Service-area health: ⚠️ heads up",
    html: buildDigestEmailHtml(metrics),
  });
  return metrics;
}

const ALERT_DEBOUNCE_MS = 24 * 60 * 60 * 1000;

// Disabled per owner request (2026-08-15) — service-area drift monitoring
// isn't something he wants surfaced via email (route optimization isn't a
// priority). Both call sites (booking route, route-runner) and the weekly
// digest cron (see vercel.json) are left in place; this one flag is the
// single place to turn it back on.
const AREA_HEALTH_ALERTS_ENABLED = false;

/** Fires an immediate alert (independent of the weekly digest) the first time a threshold trips, debounced to at most once/24h. */
export async function maybeSendImmediateAreaAlert(): Promise<void> {
  if (!AREA_HEALTH_ALERTS_ENABLED) return;
  const settings = await getSettings();
  const metrics = await computeAreaHealthMetrics();
  if (metrics.crossings.length === 0) return;

  if (settings.last_area_alert_sent_at) {
    const elapsed = Date.now() - new Date(settings.last_area_alert_sent_at).getTime();
    if (elapsed < ALERT_DEBOUNCE_MS) return;
  }

  await sendEmail({
    to: process.env.OWNER_EMAIL!,
    subject: "Service-area health: ⚠️ immediate alert",
    html: emailShell(`
      <p style="font-size:15px;">⚠️ <strong>A service-area threshold was just crossed:</strong></p>
      <ul>${metrics.crossings.map((c) => `<li>${c.message}</li>`).join("")}</ul>
      <p style="color:#64748b; font-size:13px;">You'll also see this in the next weekly digest. This immediate alert won't repeat for 24 hours.</p>
    `),
  });

  const supabase = getSupabaseAdmin();
  await supabase
    .from("settings")
    .update({ last_area_alert_sent_at: new Date().toISOString() })
    .eq("id", 1);
}
