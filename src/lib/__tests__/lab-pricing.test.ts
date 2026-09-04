import { describe, expect, it } from "vitest";
import { checkLabInvoiceLineItemPrice, expectedUnitPriceCents, identifyTestFamily, identifyTurnaroundTier } from "../lab-pricing";

describe("identifyTestFamily", () => {
  it("recognizes asbestos bulk PLM CVE", () => {
    expect(identifyTestFamily("Analytical Services:Asbestos \nAnalysis:PLM - Bulk CVE, Per-Layer \n- 6Hr TAT")).toBe("plm-bulk-cve");
  });

  it("recognizes mold direct examination and spore trap", () => {
    expect(identifyTestFamily("Analytical Services:Mold \nAnalysis:Mold - Direct Examination - \n24Hr TAT")).toBe("mold");
    expect(identifyTestFamily("Analytical Services:Mold \nAnalysis:Mold - Spore Trap Analysis \n- 24Hr TAT")).toBe("mold");
  });

  it("returns null for unrecognized test text rather than guessing", () => {
    expect(identifyTestFamily("Some Unrelated Line Item")).toBeNull();
  });
});

describe("identifyTurnaroundTier", () => {
  it("reads both spaced and unspaced hour tiers", () => {
    expect(identifyTurnaroundTier("- 24 Hr TAT")).toBe("24hr");
    expect(identifyTurnaroundTier("- 24Hr TAT")).toBe("24hr");
    expect(identifyTurnaroundTier("- 6Hr TAT")).toBe("6hr");
    expect(identifyTurnaroundTier("- 3Hr TAT")).toBe("3hr");
  });

  it("returns null when no tier text is present", () => {
    expect(identifyTurnaroundTier("PLM - Bulk CVE, Per-Layer")).toBeNull();
  });
});

describe("expectedUnitPriceCents", () => {
  // Real line items confirmed against Commonwealth's actual invoices this
  // session (job 26-0002 at 24hr, 26-0015 at both 6hr and 3hr) — all
  // matched Crystal's own price sheet exactly.
  it("matches real PLM bulk invoice lines", () => {
    expect(expectedUnitPriceCents("PLM - Bulk CVE, Per-Layer - 24 Hr TAT")).toBe(1200);
    expect(expectedUnitPriceCents("PLM - Bulk CVE, Per-Layer - 6Hr TAT")).toBe(1350);
    expect(expectedUnitPriceCents("PLM - Bulk CVE, Per-Layer - 3Hr TAT")).toBe(1500);
  });

  it("matches real mold invoice lines", () => {
    expect(expectedUnitPriceCents("Mold - Direct Examination - 24Hr TAT")).toBe(2000);
    expect(expectedUnitPriceCents("Mold - Spore Trap Analysis - 24Hr TAT")).toBe(2000);
  });

  it("returns null for an unrecognized test type", () => {
    expect(expectedUnitPriceCents("Some Unrelated Line Item")).toBeNull();
  });
});

describe("checkLabInvoiceLineItemPrice", () => {
  it("passes when billed at the correct published rate", () => {
    const result = checkLabInvoiceLineItemPrice("PLM - Bulk CVE, Per-Layer - 6Hr TAT", 1350);
    expect(result.ok).toBe(true);
    expect(result.family).toBe("plm-bulk-cve");
    expect(result.tier).toBe("6hr");
  });

  it("fails when billed above the published rate for that test+tier", () => {
    // Confirmed real case, 2026-09-03 — job 26-0015 got billed a second,
    // erroneous lab_invoice line the actual delivered report didn't
    // support (the price itself was a real published rate — 6hr TAT at
    // $13.50 — but for a duplicate quantity; see the quantity-based
    // duplicate check in lab-email.ts for that half of the story). This
    // test instead covers the case a price check IS meant to catch: a
    // charge that doesn't match ANY published rate for the test+tier.
    const result = checkLabInvoiceLineItemPrice("PLM - Bulk CVE, Per-Layer - 6Hr TAT", 2500);
    expect(result.ok).toBe(false);
    expect(result.expectedUnitPriceCents).toBe(1350);
    expect(result.billedUnitPriceCents).toBe(2500);
  });

  it("passes (nothing to check) when the test type can't be identified", () => {
    const result = checkLabInvoiceLineItemPrice("Some Unrelated Line Item", 999999);
    expect(result.ok).toBe(true);
    expect(result.family).toBeNull();
  });
});
