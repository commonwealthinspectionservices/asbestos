import { describe, it, expect } from "vitest";
import { labRateCentsForServiceType, estimatedLabCostCents } from "../lab-rate-estimate";

describe("labRateCentsForServiceType", () => {
  it("rates any asbestos inspection type at the confirmed standard PLM bulk rate", () => {
    expect(labRateCentsForServiceType("Limited Asbestos Inspection", false)).toBe(1200);
    expect(labRateCentsForServiceType("Pre-Renovation Asbestos Inspection", false)).toBe(1200);
    expect(labRateCentsForServiceType("Pre-Demolition Asbestos Inspection", false)).toBe(1200);
  });

  it("rates an asbestos inspection type at $15/sample when the job is Rush", () => {
    // Confirmed against the weekly summary's own line item for 26-0009
    // (2026-08-28): a rush bulk asbestos sample billed at $15.00, not $12.00.
    expect(labRateCentsForServiceType("Limited Asbestos Inspection", true)).toBe(1500);
  });

  it("rates Mold Air Sampling at the confirmed Spore Trap rate regardless of rush", () => {
    expect(labRateCentsForServiceType("Mold Air Sampling", false)).toBe(2000);
    expect(labRateCentsForServiceType("Mold Air Sampling", true)).toBe(2000);
  });

  it("rates Mold Bulk Sampling at the confirmed Direct Examination rate", () => {
    expect(labRateCentsForServiceType("Mold Bulk Sampling", false)).toBe(2000);
  });

  it("leaves Mold Swab Sampling and any Lead type unrated — not on any invoice seen yet", () => {
    expect(labRateCentsForServiceType("Mold Swab Sampling", false)).toBeNull();
    expect(labRateCentsForServiceType("Lead Bulk Sampling", false)).toBeNull();
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
      lab_turnaround: null,
    };
    // 12*$12.00 + 4*$20.00 + 1*$20.00 = $144 + $80 + $20 = $244.00
    expect(estimatedLabCostCents(job)).toBe(24400);
  });

  it("matches the weekly summary's real total for 26-0009 (4 rush asbestos samples)", () => {
    const job = {
      sample_counts: { "Limited Asbestos Inspection": 4 },
      lab_turnaround: "Rush",
    };
    // 4*$15.00 = $60.00
    expect(estimatedLabCostCents(job)).toBe(6000);
  });

  it("contributes $0 for an unrated service type instead of throwing off the whole estimate", () => {
    const job = {
      sample_counts: {
        "Limited Asbestos Inspection": 4,
        "Mold Swab Sampling": 3,
      },
      lab_turnaround: null,
    };
    // 4*$12.00 + 3*(unrated, $0) = $48.00
    expect(estimatedLabCostCents(job)).toBe(4800);
  });

  it("returns 0 for a job with no sample counts yet", () => {
    expect(estimatedLabCostCents({ sample_counts: {}, lab_turnaround: null })).toBe(0);
  });
});
