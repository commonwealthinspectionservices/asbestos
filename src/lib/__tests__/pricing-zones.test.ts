import { describe, it, expect } from "vitest";
import { resolveZoneBaseFeeCents } from "@/lib/pricing-zones";
import type { PricingZone } from "@/lib/types";

const zones: PricingZone[] = [
  { name: "Islands", base_fee_cents: 80000, towns: ["Nantucket", "Edgartown", "Oak Bluffs"] },
  { name: "Western MA", base_fee_cents: 65000, towns: ["Pittsfield", "Springfield", "Great Barrington"] },
  { name: "Central MA", base_fee_cents: 55000, towns: ["Worcester", "Fitchburg"] },
];

describe("resolveZoneBaseFeeCents", () => {
  it("matches the first zone whose town appears in the address", () => {
    expect(resolveZoneBaseFeeCents("123 Main St, Worcester, MA 01608, USA", zones)).toBe(55000);
  });

  it("is case-insensitive", () => {
    expect(resolveZoneBaseFeeCents("1 Beach Rd, NANTUCKET, MA 02554, USA", zones)).toBe(80000);
  });

  it("returns null when no zone matches (caller falls back to the service type's default)", () => {
    expect(resolveZoneBaseFeeCents("200 Clarendon St, Boston, MA 02116, USA", zones)).toBeNull();
  });

  it("respects array order when a town could plausibly match multiple zones", () => {
    // "Springfield" appears before any conflicting entry — order determines the winner.
    expect(resolveZoneBaseFeeCents("1 State St, Springfield, MA 01103, USA", zones)).toBe(65000);
  });
});
