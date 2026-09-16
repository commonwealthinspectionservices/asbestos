import type { PricingZone } from "@/lib/types";

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Per Tim, 2026-09-16 — found via 26-0025 ($650 base fee instead of $450):
// plain substring inclusion let a real configured town falsely match
// inside an unrelated word that happens to contain it as letters — "14
// Heather Street, Beverly" matched Pioneer Valley's "Heath" (Heath-er),
// and two Dorchester jobs (26-0004, 26-0005) matched its "Chester"
// (Dor-chester) — three real invoices with the wrong base fee baked in,
// confirmed live by testing every zone/town against all three addresses.
// A plain place name now has to match on a real word boundary so it can't
// match as a fragment of a longer, unrelated word. A non-name entry like
// Connecticut/Rhode Island's own ", CT"/", RI" catch-all sentinels (not a
// town at all — deliberately matches "...Hartford, CT" by the trailing
// state abbreviation) keeps the old plain substring behavior instead —
// word-boundary matching wouldn't make sense around leading punctuation,
// and none of the "not a plain name" entries in Settings today are at
// real risk of this same false-positive-fragment problem.
function matchesTown(lowerAddress: string, town: string): boolean {
  const trimmed = town.trim();
  if (!trimmed) return false;
  const lowerTown = trimmed.toLowerCase();
  if (/^[a-z' -]+$/i.test(trimmed)) {
    return new RegExp(`\\b${escapeRegExp(lowerTown)}\\b`).test(lowerAddress);
  }
  return lowerAddress.includes(lowerTown);
}

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
    if (zone.towns.some((town) => matchesTown(lower, town))) {
      return zone.base_fee_cents;
    }
  }
  return null;
}
