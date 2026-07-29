import { getSupabaseAdmin } from "@/lib/supabase";
import type { Settings } from "@/lib/types";

export async function getSettings(): Promise<Settings> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("settings")
    .select("*")
    .eq("id", 1)
    .single();

  if (error || !data) {
    throw new Error(`Failed to load settings: ${error?.message ?? "no row"}`);
  }
  return data as unknown as Settings;
}

export async function updateSettings(
  patch: Partial<Omit<Settings, "id" | "updated_at">>
): Promise<Settings> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("settings")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", 1)
    .select("*")
    .single();

  if (error || !data) {
    throw new Error(`Failed to update settings: ${error?.message ?? "no row"}`);
  }
  return data as unknown as Settings;
}
