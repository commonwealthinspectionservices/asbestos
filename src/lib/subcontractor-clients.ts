import { randomUUID } from "crypto";
import type { getSupabaseAdmin } from "@/lib/supabase";
import type { SubcontractorSavedClient } from "@/lib/types";

/**
 * Upserts one client into a subcontracting company's own saved roster —
 * see companies.subcontractor_saved_clients's own comment in schema.sql.
 * Matches by company name (case-insensitive, trimmed); an existing match
 * gets its address/contact fields overwritten with the latest values
 * rather than growing a second near-duplicate entry. Shared by
 * POST /api/portal/subcontractor-clients (the explicit "Save this
 * client" action) and /api/portal/book's own post-booking auto-save, so
 * a client always reflects however it was most recently typed.
 */
export async function upsertSubcontractorSavedClient(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  companyId: string,
  entry: Omit<SubcontractorSavedClient, "id">
): Promise<SubcontractorSavedClient[]> {
  const { data: companyRow, error: fetchError } = await supabase
    .from("companies")
    .select("subcontractor_saved_clients")
    .eq("id", companyId)
    .single();
  if (fetchError) throw new Error(fetchError.message);

  const existing = ((companyRow?.subcontractor_saved_clients as SubcontractorSavedClient[]) ?? []).slice();
  const matchIndex = existing.findIndex((c) => c.company.trim().toLowerCase() === entry.company.trim().toLowerCase());

  const updated: SubcontractorSavedClient[] = matchIndex >= 0
    ? existing.map((c, i) => (i === matchIndex ? { ...entry, id: c.id } : c))
    : [...existing, { ...entry, id: randomUUID() }];

  const { error: updateError } = await supabase
    .from("companies")
    .update({ subcontractor_saved_clients: updated })
    .eq("id", companyId);
  if (updateError) throw new Error(updateError.message);

  return updated;
}
