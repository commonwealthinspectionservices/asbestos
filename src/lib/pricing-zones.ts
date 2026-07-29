import type { PricingZone } from "@/lib/types";

/**
 * Resolves a region-specific base fee override for a geocoded address, or
 * null if no configured zone matches (caller should fall back to the
 * service type's own base_fee_cents). Zones are checked in array order —
 * first match wins — so more specific zones (e.g. islands) should be
 * listed before broader ones in Settings.
 */
export function resolveZoneBaseFeeCents(
  formattedAddress: string,
  zones: PricingZone[]
): number | null {
  const lower = formattedAddress.toLowerCase();
  for (const zone of zones) {
    if (zone.towns.some((town) => town.trim() && lower.includes(town.trim().toLowerCase()))) {
      return zone.base_fee_cents;
    }
  }
  return null;
}
