import { getSupabaseAdmin, getSupabaseAdminFresh } from "@/lib/supabase";
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

// Per Tim, 2026-09-16 — found via 26-0025: getSettings()'s plain client
// (getSupabaseAdmin(), Next.js's cache-eligible one — see its own comment
// in lib/supabase.ts) held a stale $650 base fee for "Limited Asbestos
// Inspection" well after Settings actually held $450, and the automated
// lab-results pipeline (lab-email.ts) — which prices every invoice it
// auto-drafts straight from getSettings() — baked that stale rate
// straight into real invoice line items with nothing to catch it. Can't
// just make getSettings() itself always-fresh — its own comment history
// (and getSupabaseAdminFresh's) already covers why: marketing pages call
// it during static prerendering, and forcing no-store there broke the
// production build outright. This is the "opposite case" sibling instead,
// same split as getSupabaseAdmin/getSupabaseAdminFresh — for any caller
// that needs Settings' actual current values, not whatever Next.js has
// cached, most importantly anything computing a real dollar figure.
export async function getSettingsFresh(): Promise<Settings> {
  const supabase = getSupabaseAdminFresh();
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
