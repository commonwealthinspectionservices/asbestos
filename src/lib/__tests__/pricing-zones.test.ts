import { describe, it, expect } from "vitest";
import { resolveZoneBaseFeeCents } from "@/lib/pricing-zones";
import type { PricingZone } from "@/lib/types";

const zones: PricingZone[] = [
  { name: "Islands", base_fee_cents: 80000, towns: ["Nantucket", "Edgartown", "Oak Bluffs"] },
  { name: "Western MA", base_fee_cents: 65000, towns: ["Pittsfield", "Springfield", "Great Barrington"] },
  { name: "Central MA", base_fee_cents: 55000, towns: ["Worcester", "Fitchburg"] },
  { name: "Pioneer Valley", base_fee_cents: 65000, towns: ["Heath", "Chester", "Ware"] },
  { name: "Connecticut", base_fee_cents: 65000, towns: ["Hartford", ", CT"] },
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

  // Found live on 26-0025 ($650 instead of $450) and two Dorchester jobs
  // (26-0004, 26-0005) — a configured town matched as a bare fragment
  // inside an unrelated word that happened to contain the same letters.
  it("does not match a town name as a fragment of an unrelated word", () => {
    expect(resolveZoneBaseFeeCents("14 Heather St, Beverly, MA 01915, USA", zones)).toBeNull();
    expect(resolveZoneBaseFeeCents("690 Blue Hill Ave, Dorchester, MA 02121, USA", zones)).toBeNull();
    expect(resolveZoneBaseFeeCents("123 Elm St, Wareham, MA 02571, USA", zones)).toBeNull();
  });

  it("still matches the real town on its own word boundary", () => {
    expect(resolveZoneBaseFeeCents("1 Heath Rd, Heath, MA 01346, USA", zones)).toBe(65000);
    expect(resolveZoneBaseFeeCents("1 Main St, Chester, MA 01011, USA", zones)).toBe(65000);
    expect(resolveZoneBaseFeeCents("1 Main St, Ware, MA 01082, USA", zones)).toBe(65000);
  });

  it("keeps plain substring matching for a non-name catch-all entry (e.g. \", CT\")", () => {
    expect(resolveZoneBaseFeeCents("1 Main St, Danbury, CT 06810, USA", zones)).toBe(65000);
  });
});
