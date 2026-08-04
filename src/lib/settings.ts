import { getSupabaseAdmin } from "@/lib/supabase";
import type { Inspector, Settings } from "@/lib/types";

// The first entry in Settings.inspectors is what prints on every report,
// invoice, and Chain of Custody form's signature block. There's no per-job
// inspector assignment yet, so this is the whole business's single signer
// until that's built.
export function primaryInspector(settings: Settings): Inspector {
  return settings.inspectors[0] ?? { name: "", title: "", license_number: "" };
}

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
