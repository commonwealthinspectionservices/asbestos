import { describe, it, expect } from "vitest";
import { resolveServiceSelection } from "@/lib/portal-booking";
import type { Settings } from "@/lib/types";

const settings = {
  service_types: [
    { key: "asbestos_bulk", label: "Limited Asbestos Inspection", base_fee_cents: 45000, per_sample_cents: 2500 },
    { key: "asbestos_pre_demo", label: "Pre-Demolition Asbestos Inspection", base_fee_cents: 55000, per_sample_cents: 2500 },
    { key: "mold_air", label: "Mold Air Sampling", base_fee_cents: 45000, per_sample_cents: 8500 },
  ],
  pricing_zones: [
    { name: "Islands", base_fee_cents: 80000, towns: ["Nantucket"] },
  ],
} as Settings;

describe("resolveServiceSelection", () => {
  it("rejects an unknown service type key", () => {
    const result = resolveServiceSelection(["not_a_real_key"], "200 Clarendon St, Boston, MA", settings);
    expect(result).toEqual({ error: "Unknown service type" });
  });

  it("joins matched labels in settings order, not selection order", () => {
    const result = resolveServiceSelection(["mold_air", "asbestos_bulk"], "200 Clarendon St, Boston, MA", settings);
    expect("error" in result).toBe(false);
    if (!("error" in result)) {
      expect(result.serviceTypeLabel).toBe("Limited Asbestos Inspection, Mold Air Sampling");
    }
  });

  it("charges the base fee once, from the first matched type, when no zone override applies", () => {
    const result = resolveServiceSelection(["asbestos_pre_demo", "mold_air"], "200 Clarendon St, Boston, MA", settings);
    if (!("error" in result)) {
      expect(result.baseFeeCents).toBe(55000);
      expect(result.perSampleCents).toBe(2500);
    }
  });

  it("prefers a matching pricing zone's base fee over the service type's own", () => {
    const result = resolveServiceSelection(["asbestos_bulk"], "1 Beach Rd, Nantucket, MA", settings);
    if (!("error" in result)) {
      expect(result.baseFeeCents).toBe(80000);
    }
  });
});
