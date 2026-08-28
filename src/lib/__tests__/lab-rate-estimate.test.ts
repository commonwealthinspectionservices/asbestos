import { describe, it, expect } from "vitest";
import { labRateCentsForServiceType, estimatedLabCostCents } from "../lab-rate-estimate";

describe("labRateCentsForServiceType", () => {
  it("rates any asbestos inspection type at the confirmed PLM bulk rate", () => {
    expect(labRateCentsForServiceType("Limited Asbestos Inspection")).toBe(1200);
    expect(labRateCentsForServiceType("Pre-Renovation Asbestos Inspection")).toBe(1200);
    expect(labRateCentsForServiceType("Pre-Demolition Asbestos Inspection")).toBe(1200);
  });

  it("rates Mold Air Sampling at the confirmed Spore Trap rate", () => {
    expect(labRateCentsForServiceType("Mold Air Sampling")).toBe(2000);
  });

  it("rates Mold Bulk Sampling at the confirmed Direct Examination rate", () => {
    expect(labRateCentsForServiceType("Mold Bulk Sampling")).toBe(2000);
  });

  it("leaves Mold Swab Sampling and any Lead type unrated — not on any invoice seen yet", () => {
    expect(labRateCentsForServiceType("Mold Swab Sampling")).toBeNull();
    expect(labRateCentsForServiceType("Lead Bulk Sampling")).toBeNull();
  });
});

describe("estimatedLabCostCents", () => {
  it("matches invoice #6491's real total for 26-0002 (12 asbestos + 4 mold air + 1 mold bulk)", () => {
    const job = {
      sample_counts: {
        "Limited Asbestos Inspection": 12,
        "Mold Air Sampling": 4,
        "Mold Bulk Sampling": 1,
      },
    };
    // 12*$12.00 + 4*$20.00 + 1*$20.00 = $144 + $80 + $20 = $244.00
    expect(estimatedLabCostCents(job)).toBe(24400);
  });

  it("contributes $0 for an unrated service type instead of throwing off the whole estimate", () => {
    const job = {
      sample_counts: {
        "Limited Asbestos Inspection": 4,
        "Mold Swab Sampling": 3,
      },
    };
    // 4*$12.00 + 3*(unrated, $0) = $48.00
    expect(estimatedLabCostCents(job)).toBe(4800);
  });

  it("returns 0 for a job with no sample counts yet", () => {
    expect(estimatedLabCostCents({ sample_counts: {} })).toBe(0);
  });
});
