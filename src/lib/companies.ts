import { getSupabaseAdmin } from "@/lib/supabase";
import type { Company, Customer } from "@/lib/types";

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

// Per Tim, 2026-09-16 — "these names should save in my system too as
// company contacts": a subcontractor's own end client (e.g. FLI
// Environmental's "Mukhooy Industries, LLC" / "Elvis Plokhooy") used to
// live only as freeform strings on the job row, invisible everywhere else
// in the Directory. Called best-effort alongside those freeform fields
// (never blocks the job save if it fails) so the same name shows up as a
// real, searchable Directory contact next time — same dedup-by-name
// reasoning as upsertCompany above, needed here specifically because
// these contacts frequently have no email at all, so the customers table's
// own email-unique-constraint upsert (see /api/admin/customers) can't
// dedupe them the way it dedupes everyone else.
export async function upsertCompanyContact(
  name: string,
  companyId: string,
  fields: { phone?: string | null; email?: string | null } = {}
): Promise<Customer> {
  const supabase = getSupabaseAdmin();
  const trimmedName = name.trim();
  if (!trimmedName) throw new Error("Contact name is required");

  const { data: existing } = await supabase
    .from("customers")
    .select("*")
    .eq("company_id", companyId)
    .ilike("name", trimmedName)
    .maybeSingle();

  if (existing) {
    const updates: Record<string, string> = {};
    if (fields.phone && !existing.phone) updates.phone = fields.phone;
    if (fields.email && !existing.email) updates.email = fields.email;
    if (Object.keys(updates).length === 0) return existing;

    const { data: updated, error } = await supabase
      .from("customers")
      .update(updates)
      .eq("id", existing.id)
      .select("*")
      .single();
    if (error || !updated) throw new Error(`Failed to update contact: ${error?.message}`);
    return updated;
  }

  const { data: company } = await supabase.from("companies").select("name, billing_address").eq("id", companyId).single();

  const { data: created, error } = await supabase
    .from("customers")
    .insert({
      name: trimmedName,
      company: company?.name ?? null,
      company_id: companyId,
      email: fields.email || null,
      phone: fields.phone || "",
      billing_address: company?.billing_address ?? null,
      is_individual: false,
    })
    .select("*")
    .single();
  if (error) {
    // No DB-level unique constraint on (company_id, name) — unlike
    // upsertCompany's companies_name_lower_idx — so a genuine race here
    // (rare: two near-simultaneous saves naming the same brand-new
    // contact) would create two rows rather than hit a 23505 to recover
    // from. Acceptable for how infrequently this actually runs; not worth
    // a migration to close.
    throw new Error(`Failed to create contact: ${error.message}`);
  }
  if (!created) throw new Error("Failed to create contact: no row returned");
  return created;
}
