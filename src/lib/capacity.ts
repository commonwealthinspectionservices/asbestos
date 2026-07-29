import { getSupabaseAdmin } from "@/lib/supabase";

/** Number of `scheduled` jobs already booked on a given date (YYYY-MM-DD). */
export async function countScheduledJobs(date: string): Promise<number> {
  const supabase = getSupabaseAdmin();
  const { count, error } = await supabase
    .from("jobs")
    .select("id", { count: "exact", head: true })
    .eq("requested_date", date)
    .eq("status", "scheduled");

  if (error) throw new Error(`Failed to check capacity: ${error.message}`);
  return count ?? 0;
}

export async function isDateFull(
  date: string,
  maxJobsPerDay: number
): Promise<boolean> {
  const count = await countScheduledJobs(date);
  return count >= maxJobsPerDay;
}

/** Soonest date >= fromDate (inclusive) with remaining capacity. Never fails — walks forward. */
export async function findNextAvailableDate(
  fromDate: string,
  maxJobsPerDay: number
): Promise<string> {
  let cursor = new Date(`${fromDate}T00:00:00Z`);
  // Bounded search so a data/config problem can't loop forever.
  for (let i = 0; i < 365; i++) {
    const iso = cursor.toISOString().slice(0, 10);
    const full = await isDateFull(iso, maxJobsPerDay);
    if (!full) return iso;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  throw new Error("No available date found within a year");
}
