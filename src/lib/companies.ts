import { getSupabaseAdmin } from "@/lib/supabase";
import type { Company } from "@/lib/types";

/**
 * Finds a company by case-insensitive name match, or creates one. Matches
 * on lower(name) rather than exact text so "Newton Fire & Flood" and
 * "newton fire & flood" resolve to the same row — the whole point is to
 * stop near-duplicate company spellings from piling up.
 */
export async function upsertCompany(
  name: string,
  fields: { billingAddress?: string | null; phone?: string | null; email?: string | null } = {}
): Promise<Company> {
  const supabase = getSupabaseAdmin();
  const trimmedName = name.trim();

  const { data: existing } = await supabase
    .from("companies")
    .select("*")
    .ilike("name", trimmedName)
    .maybeSingle();

  if (existing) {
    const updates: Record<string, string> = {};
    if (fields.billingAddress && !existing.billing_address) updates.billing_address = fields.billingAddress;
    if (fields.phone && !existing.phone) updates.phone = fields.phone;
    if (fields.email && !existing.email) updates.email = fields.email;
    if (Object.keys(updates).length === 0) return existing;

    const { data: updated, error } = await supabase
      .from("companies")
      .update(updates)
      .eq("id", existing.id)
      .select("*")
      .single();
    if (error || !updated) throw new Error(`Failed to update company: ${error?.message}`);
    return updated;
  }

  const { data: created, error } = await supabase
    .from("companies")
    .insert({
      name: trimmedName,
      billing_address: fields.billingAddress || null,
      phone: fields.phone || null,
      email: fields.email || null,
    })
    .select("*")
    .single();
  if (error) {
    // Two concurrent callers (e.g. two teammates at a brand-new company
    // both finishing onboarding within moments of each other) can both
    // see no `existing` row above and both attempt this insert — the
    // loser hits companies_name_lower_idx's unique constraint. Re-fetch
    // and return the winner's row instead of surfacing a raw 500 for
    // what's really just an ordinary race, not a real failure.
    if (error.code === "23505") {
      const { data: winner } = await supabase.from("companies").select("*").ilike("name", trimmedName).maybeSingle();
      if (winner) return winner;
    }
    throw new Error(`Failed to create company: ${error.message}`);
  }
  if (!created) throw new Error("Failed to create company: no row returned");
  return created;
}
