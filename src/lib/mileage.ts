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
  created_at: string;
}

/** home → each job that day (by scheduled time) → lab → home. */
export async function autoStopsForDay(homeAddress: string, jobs: JobRowForRoute[]): Promise<MileageStop[]> {
  const ordered = [...jobs].sort((a, b) => (a.requested_time ?? "99:99").localeCompare(b.requested_time ?? "99:99") || a.created_at.localeCompare(b.created_at));
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

  if (from <= upper) {
    const { data: jobs, error: jobsError } = await supabase
      .from("jobs")
      .select("id, project_number, service_address, requested_time, requested_date, created_at, status")
      .gte("requested_date", from)
      .lte("requested_date", upper)
      .not("status", "in", `(${SKIP_STATUSES.join(",")})`);
    if (jobsError) throw new Error(jobsError.message);
    const jobsByDay = new Map<string, JobRowForRoute[]>();
    for (const j of (jobs ?? []) as JobRowForRoute[]) {
      if (!j.requested_date) continue;
      const list = jobsByDay.get(j.requested_date) ?? [];
      list.push(j);
      jobsByDay.set(j.requested_date, list);
    }
    for (const [day, dayJobs] of jobsByDay) {
      if (byDay.has(day)) continue;
      const stops = await autoStopsForDay(settings.base_address, dayJobs);
      const legs = await buildLegs(stops, new Map());
      const row: MileageDay = { day, stops, legs };
      const { error: upsertError } = await supabase.from("mileage_days").upsert({ day, stops, legs, updated_at: new Date().toISOString() });
      if (upsertError) throw new Error(upsertError.message);
      byDay.set(day, row);
    }
  }
  return [...byDay.values()].sort((a, b) => b.day.localeCompare(a.day));
}

export async function saveMileageDay(day: string, stops: MileageStop[], legOverride?: { index: number; miles: number | null }): Promise<MileageDay> {
  const supabase = getSupabaseAdminFresh();
  const { data: existing } = await supabase.from("mileage_days").select("day, stops, legs").eq("day", day).maybeSingle();
  const manual = manualMapOf((existing as unknown as MileageDay | null) ?? null);
  if (legOverride && stops[legOverride.index] && stops[legOverride.index + 1]) {
    const key = `${stops[legOverride.index].id}>${stops[legOverride.index + 1].id}`;
    if (legOverride.miles == null) manual.delete(key);
    else manual.set(key, legOverride.miles);
  }
  const legs = await buildLegs(stops, manual);
  const { error } = await supabase.from("mileage_days").upsert({ day, stops, legs, updated_at: new Date().toISOString() });
  if (error) throw new Error(error.message);
  return { day, stops, legs };
}

export async function resetMileageDay(day: string): Promise<void> {
  const supabase = getSupabaseAdminFresh();
  const { error } = await supabase.from("mileage_days").delete().eq("day", day);
  if (error) throw new Error(error.message);
}
