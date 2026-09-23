import { getSupabaseAdminFresh } from "@/lib/supabase";
import { getSettingsFresh } from "@/lib/settings";
import { nowInTimeZone } from "@/lib/tz";

import { LAB_ADDRESS, LAB_LABEL, newStopId, normalizeAddress, totalMiles, type MileageDay, type MileageLeg, type MileageStop } from "@/lib/mileage-shared";

export * from "@/lib/mileage-shared";

const pairCache = new Map<string, number>();

/** Driving miles between two addresses, via Google's Routes API. */
async function driveMiles(from: string, to: string): Promise<number> {
  if (normalizeAddress(from) === normalizeAddress(to)) return 0;
  const key = `${normalizeAddress(from)}>${normalizeAddress(to)}`;
  const cached = pairCache.get(key);
  if (cached != null) return cached;

  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) throw new Error("Missing GOOGLE_MAPS_API_KEY env var");
  const res = await fetch("https://routes.googleapis.com/directions/v2:computeRoutes", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": "routes.distanceMeters",
    },
    body: JSON.stringify({ origin: { address: from }, destination: { address: to }, travelMode: "DRIVE" }),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Routes API failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
  const data = (await res.json()) as { routes?: { distanceMeters?: number }[] };
  const meters = data.routes?.[0]?.distanceMeters;
  if (meters == null) throw new Error(`No driving route found from "${from}" to "${to}"`);
  const miles = Math.round((meters / 1609.344) * 10) / 10;
  pairCache.set(key, miles);
  return miles;
}

/** Builds the legs for a stop list, keeping any hand-entered leg the caller passes in `manual` (keyed "fromId>toId"). */
export async function buildLegs(stops: MileageStop[], manual: Map<string, number>): Promise<MileageLeg[]> {
  const legs = await Promise.all(
    stops.slice(0, -1).map(async (from, i): Promise<MileageLeg> => {
      const to = stops[i + 1];
      const override = manual.get(`${from.id}>${to.id}`);
      if (override != null) return { miles: override, manual: true };
      return { miles: await driveMiles(from.address, to.address) };
    })
  );
  return legs;
}

export function manualMapOf(day: MileageDay | null): Map<string, number> {
  const map = new Map<string, number>();
  if (!day) return map;
  day.legs.forEach((leg, i) => {
    if (leg.manual && day.stops[i] && day.stops[i + 1]) map.set(`${day.stops[i].id}>${day.stops[i + 1].id}`, leg.miles);
  });
  return map;
}

interface JobRowForRoute {
  id: string;
  project_number: string | null;
  service_address: string | null;
  requested_time: string | null;
  requested_date: string | null;
  confirmed_date?: string | null;
  confirmed_time?: string | null;
  created_at: string;
}

/** The day a job was actually scheduled/done — confirmed_date when set (Boston Harbor-style jobs never have requested_date), else requested_date. */
export function effectiveJobDate(j: Pick<JobRowForRoute, "confirmed_date" | "requested_date">): string | null {
  return j.confirmed_date ?? j.requested_date ?? null;
}
function effectiveJobTime(j: JobRowForRoute): string {
  return j.confirmed_time ?? j.requested_time ?? "99:99";
}

/** home → each job that day (by scheduled time) → lab → home. */
export async function autoStopsForDay(homeAddress: string, jobs: JobRowForRoute[]): Promise<MileageStop[]> {
  const ordered = [...jobs].sort((a, b) => effectiveJobTime(a).localeCompare(effectiveJobTime(b)) || a.created_at.localeCompare(b.created_at));
  const stops: MileageStop[] = [{ id: newStopId(), kind: "home", label: "Home", address: homeAddress }];
  for (const j of ordered) {
    if (!j.service_address) continue;
    const prev = stops[stops.length - 1];
    if (prev.kind === "job" && normalizeAddress(prev.address) === normalizeAddress(j.service_address)) continue;
    stops.push({ id: newStopId(), kind: "job", label: j.project_number ? `${j.project_number} — ${j.service_address}` : j.service_address, address: j.service_address, job_id: j.id });
  }
  stops.push({ id: newStopId(), kind: "lab", label: LAB_LABEL, address: LAB_ADDRESS });
  stops.push({ id: newStopId(), kind: "home", label: "Home", address: homeAddress });
  return stops;
}

const SKIP_STATUSES = ["cancelled", "waitlist_out_of_area", "needs_scheduling"];

/**
 * Loads saved days in [from, to] and auto-creates (and saves) a route for
 * any past-or-today date that has scheduled jobs but no saved row yet.
 */
export async function ensureMileageDays(from: string, to: string): Promise<MileageDay[]> {
  const supabase = getSupabaseAdminFresh();
  const settings = await getSettingsFresh();
  const today = nowInTimeZone(settings.timezone).dateIso;
  const upper = to < today ? to : today;

  const { data: saved, error } = await supabase.from("mileage_days").select("day, stops, legs").gte("day", from).lte("day", to);
  if (error) throw new Error(error.message);
  const byDay = new Map<string, MileageDay>((saved ?? []).map((r) => [r.day as string, r as unknown as MileageDay]));

  // Every scheduled job in range (future days included), so saved days can be kept in step with the schedule.
  const { data: jobs, error: jobsError } = await supabase
    .from("jobs")
    .select("id, project_number, service_address, requested_time, requested_date, confirmed_date, confirmed_time, created_at, status")
    .or(`and(confirmed_date.gte.${from},confirmed_date.lte.${to}),and(confirmed_date.is.null,requested_date.gte.${from},requested_date.lte.${to})`)
    .not("status", "in", `(${SKIP_STATUSES.join(",")})`);
  if (jobsError) throw new Error(jobsError.message);
  const jobsByDay = new Map<string, JobRowForRoute[]>();
  const jobDate = new Map<string, string>();
  for (const j of (jobs ?? []) as JobRowForRoute[]) {
    const date = effectiveJobDate(j);
    if (!date) continue;
    jobDate.set(j.id, date);
    const list = jobsByDay.get(date) ?? [];
    list.push(j);
    jobsByDay.set(date, list);
  }

  // Past-or-today days with jobs but no saved route yet: build one.
  for (const [day, dayJobs] of jobsByDay) {
    if (byDay.has(day) || day > upper) continue;
    const stops = await autoStopsForDay(settings.base_address, dayJobs);
    const legs = await buildLegs(stops, new Map());
    const row: MileageDay = { day, stops, legs };
    const { error: upsertError } = await supabase.from("mileage_days").upsert({ day, stops, legs, updated_at: new Date().toISOString() });
    if (upsertError) throw new Error(upsertError.message);
    byDay.set(day, row);
  }

  // Saved route days (not past total-only days): add jobs scheduled onto the day since it was saved, drop jobs moved off it.
  for (const [day, row] of byDay) {
    if (row.legs[0]?.total) continue;
    const dismissed = new Set(row.legs[0]?.dismissedJobs ?? []);
    let stops = row.stops.filter((s) => s.kind !== "job" || !s.job_id || !jobDate.has(s.job_id) || jobDate.get(s.job_id) === day);
    const have = new Set(stops.map((s) => s.job_id).filter(Boolean));
    const missing = (jobsByDay.get(day) ?? []).filter((j) => j.service_address && !have.has(j.id) && !dismissed.has(j.id));
    if (!missing.length && stops.length === row.stops.length) continue;
    const ordered = [...missing].sort((a, b) => effectiveJobTime(a).localeCompare(effectiveJobTime(b)));
    for (const j of ordered) {
      const lab = stops.findIndex((s) => s.kind === "lab");
      const at = lab >= 0 ? lab : Math.max(1, stops.length - 1);
      stops = [...stops.slice(0, at), { id: newStopId(), kind: "job" as const, label: `${j.project_number} — ${j.service_address}`, address: j.service_address!, job_id: j.id }, ...stops.slice(at)];
    }
    byDay.set(day, await saveMileageDay(day, stops));
  }
  return [...byDay.values()].sort((a, b) => b.day.localeCompare(a.day));
}

/**
 * Read-only per-day totals — the Mileage page's own "Miles by month" table
 * and, per Tim, 2026-09-23, the Revenue & Margin Summary's now-weekly-and-
 * monthly earnings section both roll this up client-side (per month, or
 * bucketed into the same Sun–Sat weeks the rest of that page already uses
 * — a month-level total can't be re-sliced that finely, which is exactly
 * why this returns per-day rather than pre-aggregated). Reads whatever's
 * already saved and creates a route for any past-or-today day that has
 * jobs but no saved row yet (a plain upsert of a brand-new row, safe to
 * race). Deliberately does NOT run the job-diff/rewrite step
 * ensureMileageDays does for the visible month — running that over this
 * wide a range on every page load raced against the month view's own sync
 * and corrupted a real day's stops (see MileageView.tsx's own comment,
 * 2026-09-22). Only the month actually being viewed gets its stops
 * rewritten.
 */
export async function sumSavedMileageByDay(from: string, to: string): Promise<Record<string, number>> {
  const supabase = getSupabaseAdminFresh();
  const settings = await getSettingsFresh();
  const today = nowInTimeZone(settings.timezone).dateIso;
  const upper = to < today ? to : today;

  const { data: saved, error } = await supabase.from("mileage_days").select("day, stops, legs").gte("day", from).lte("day", to);
  if (error) throw new Error(error.message);
  const savedDays = new Set((saved ?? []).map((r) => r.day as string));

  if (from <= upper) {
    const { data: jobs, error: jobsError } = await supabase
      .from("jobs")
      .select("id, project_number, service_address, requested_time, requested_date, confirmed_date, confirmed_time, created_at, status")
      .or(`and(confirmed_date.gte.${from},confirmed_date.lte.${upper}),and(confirmed_date.is.null,requested_date.gte.${from},requested_date.lte.${upper})`)
      .not("status", "in", `(${SKIP_STATUSES.join(",")})`);
    if (jobsError) throw new Error(jobsError.message);
    const jobsByDay = new Map<string, JobRowForRoute[]>();
    for (const j of (jobs ?? []) as JobRowForRoute[]) {
      const date = effectiveJobDate(j);
      if (!date || savedDays.has(date)) continue;
      const list = jobsByDay.get(date) ?? [];
      list.push(j);
      jobsByDay.set(date, list);
    }
    for (const [day, dayJobs] of jobsByDay) {
      const stops = await autoStopsForDay(settings.base_address, dayJobs);
      const legs = await buildLegs(stops, new Map());
      // upsert, not insert — if another request created this day first, this just overwrites with an equivalent fresh build, never a partial/racy merge.
      const { error: upsertError } = await supabase.from("mileage_days").upsert({ day, stops, legs, updated_at: new Date().toISOString() });
      if (upsertError) throw new Error(upsertError.message);
      saved!.push({ day, stops, legs } as never);
    }
  }

  const dailyMiles: Record<string, number> = {};
  for (const row of saved ?? []) {
    dailyMiles[row.day as string] = totalMiles(row as unknown as MileageDay);
  }
  return dailyMiles;
}

export async function saveMileageDay(day: string, stops: MileageStop[], legOverride?: { index: number; miles: number | null }, dayTotal?: number): Promise<MileageDay> {
  const supabase = getSupabaseAdminFresh();
  const { data: existing } = await supabase.from("mileage_days").select("day, stops, legs").eq("day", day).maybeSingle();
  const manual = manualMapOf((existing as unknown as MileageDay | null) ?? null);
  if (legOverride && stops[legOverride.index] && stops[legOverride.index + 1]) {
    const key = `${stops[legOverride.index].id}>${stops[legOverride.index + 1].id}`;
    if (legOverride.miles == null) manual.delete(key);
    else manual.set(key, legOverride.miles);
  }
  // A day recorded only as a total (no trip-by-trip detail): one summary stop, one leg holding the miles.
  const existingDay = (existing as unknown as MileageDay | null) ?? null;
  const isSummary = !!existingDay?.legs?.[0]?.total;
  const legs: MileageLeg[] = isSummary
    ? [{ miles: legOverride?.miles ?? existingDay!.legs[0].miles, manual: true, total: true }]
    : await buildLegs(stops, manual);
  if (!isSummary && legs[0]) {
    // Remember jobs whose stop was removed by hand so the schedule sync doesn't put them back.
    const before = new Set((existingDay?.stops ?? []).map((st) => st.job_id).filter(Boolean) as string[]);
    const after = new Set(stops.map((st) => st.job_id).filter(Boolean) as string[]);
    const dismissed = new Set(existingDay?.legs?.[0]?.dismissedJobs ?? []);
    for (const id of before) if (!after.has(id)) dismissed.add(id);
    for (const id of after) dismissed.delete(id);
    legs[0] = { ...legs[0], ...(dismissed.size ? { dismissedJobs: [...dismissed] } : {}), ...(dayTotal != null ? { dayTotal } : {}) };
  }
  const { error } = await supabase.from("mileage_days").upsert({ day, stops, legs, updated_at: new Date().toISOString() });
  if (error) throw new Error(error.message);
  return { day, stops, legs };
}

export async function resetMileageDay(day: string): Promise<void> {
  const supabase = getSupabaseAdminFresh();
  const { error } = await supabase.from("mileage_days").delete().eq("day", day);
  if (error) throw new Error(error.message);
}

/** Starts a day on demand (any date, including future ones): built from that day's scheduled jobs when there are any, otherwise just home → home. */
export async function createEmptyMileageDay(day: string): Promise<MileageDay> {
  const settings = await getSettingsFresh();
  const supabase = getSupabaseAdminFresh();
  const { data: existing } = await supabase.from("mileage_days").select("day, stops, legs").eq("day", day).maybeSingle();
  if (existing) return existing as unknown as MileageDay;

  const { data: jobs } = await supabase
    .from("jobs")
    .select("id, project_number, service_address, requested_time, requested_date, confirmed_date, confirmed_time, created_at, status")
    .or(`confirmed_date.eq.${day},and(confirmed_date.is.null,requested_date.eq.${day})`)
    .not("status", "in", `(${SKIP_STATUSES.join(",")})`);
  const stops: MileageStop[] = (jobs ?? []).length
    ? await autoStopsForDay(settings.base_address, jobs as JobRowForRoute[])
    : [
        { id: newStopId(), kind: "home", label: "Home", address: settings.base_address },
        { id: newStopId(), kind: "home", label: "Home", address: settings.base_address },
      ];
  const legs = await buildLegs(stops, new Map());
  const { error } = await supabase.from("mileage_days").insert({ day, stops, legs, updated_at: new Date().toISOString() });
  if (error) throw new Error(error.message);
  return { day, stops, legs };
}
