import { resolveZoneBaseFeeCents } from "@/lib/pricing-zones";
import type { ServiceType, Settings } from "@/lib/types";

export interface ResolvedServiceSelection {
  matchedServiceTypes: ServiceType[];
  serviceTypeLabel: string;
  baseFeeCents: number;
  perSampleCents: number;
}

// Shared by /api/portal/book (creation) and /api/portal/projects/[id]
// (editing a still-pending request) — matching service types against
// Settings and pricing them is real business logic (a wrong answer here is
// a wrong invoice), not the kind of small formatter this codebase usually
// duplicates per-file, so it's centralized here instead of copied twice.
export function resolveServiceSelection(
  serviceTypeKeys: string[],
  address: string,
  settings: Settings
): ResolvedServiceSelection | { error: string } {
  // Kept in settings.service_types order (not client selection order) so
  // the stored comma-joined label list is deterministic — matches how
  // EditProjectDialog (JobsDashboard.tsx) builds job.service_type, and how
  // resolveBaseFeeCents/defaultInvoiceLineItems (invoice-defaults.ts) treat
  // the first label in that list as "the" base-fee-driving type.
  const matchedServiceTypes = settings.service_types.filter((s) => serviceTypeKeys.includes(s.key));
  if (matchedServiceTypes.length !== serviceTypeKeys.length) {
    return { error: "Unknown service type" };
  }
  const serviceTypeLabel = matchedServiceTypes.map((s) => s.label).join(", ");

  // Only one visit happens per job regardless of how many service types are
  // picked, so the base fee is charged once — the zone override if one
  // applies, else the first (settings-order) matched type's own fee. Mirrors
  // resolveBaseFeeCents in invoice-defaults.ts and PricingCalculator.tsx's
  // own baseFeeCents rule.
  const zoneBaseFeeCents = resolveZoneBaseFeeCents(address, settings.pricing_zones);
  const baseFeeCents = zoneBaseFeeCents ?? matchedServiceTypes[0].base_fee_cents;

  return {
    matchedServiceTypes,
    serviceTypeLabel,
    baseFeeCents,
    perSampleCents: matchedServiceTypes[0].per_sample_cents,
  };
}
