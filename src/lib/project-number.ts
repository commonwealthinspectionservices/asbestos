import { getSupabaseAdmin } from "@/lib/supabase";

/**
 * Generates the next human-readable project number (e.g. "26-1301"), via
 * a Postgres sequence wrapped in the `next_project_number()` SQL function
 * (see supabase/schema.sql) — atomic under concurrent bookings, unlike a
 * `select max(...) + 1` read-then-write.
 */
export async function generateProjectNumber(): Promise<string> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.rpc("next_project_number");
  if (error || typeof data !== "string") {
    throw new Error(`Failed to generate project number: ${error?.message}`);
  }
  return data;
}
