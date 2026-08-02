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

/**
 * Shows what generateProjectNumber() would return next, without actually
 * consuming that value from the sequence — used by the "GET NEXT #" preview
 * button on Add Project, so cancelling out of that screen (or just looking,
 * without saving) never burns a number nothing ends up using.
 */
export async function peekNextProjectNumber(): Promise<string> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.rpc("peek_next_project_number");
  if (error || typeof data !== "string") {
    throw new Error(`Failed to peek next project number: ${error?.message}`);
  }
  return data;
}
