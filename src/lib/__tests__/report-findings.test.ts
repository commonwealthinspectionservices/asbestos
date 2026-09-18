import { describe, it, expect } from "vitest";
import { domainForServiceTypeLabel, jobReportDomains, isFullInspectionAsbestosJob, inspectionReportSubjectPrefix, hasAllLabReports } from "@/lib/report-findings";
import type { JobDocument } from "@/lib/types";

describe("inspectionReportSubjectPrefix", () => {
  it("names a single domain", () => {
    expect(inspectionReportSubjectPrefix("Limited Asbestos Inspection")).toBe("Asbestos Inspection Report");
    expect(inspectionReportSubjectPrefix("Mold Air Sampling, Mold Bulk Sampling")).toBe("Mold Inspection Report");
  });

  it("orders a combo as Asbestos + Mold + Lead regardless of booking order", () => {
    expect(inspectionReportSubjectPrefix("Limited Asbestos Inspection, Mold Air Sampling")).toBe("Asbestos + Mold Inspection Report");
    // Mold booked first in service_type — prefix still reads Asbestos first.
    expect(inspectionReportSubjectPrefix("Mold Air Sampling, Limited Asbestos Inspection")).toBe("Asbestos + Mold Inspection Report");
  });

  it("falls back to Asbestos for an empty/unknown service type", () => {
    expect(inspectionReportSubjectPrefix(null)).toBe("Asbestos Inspection Report");
    expect(inspectionReportSubjectPrefix("")).toBe("Asbestos Inspection Report");
  });
});

describe("domainForServiceTypeLabel", () => {
  it("classifies mold labels", () => {
    expect(domainForServiceTypeLabel("Mold Air Sampling")).toBe("mold");
    expect(domainForServiceTypeLabel("Mold Bulk Sampling")).toBe("mold");
  });

  it("classifies lead labels", () => {
    expect(domainForServiceTypeLabel("Lead Paint Inspection")).toBe("lead");
  });

  it("defaults to asbestos for anything else", () => {
    expect(domainForServiceTypeLabel("Limited Asbestos Inspection")).toBe("asbestos");
    expect(domainForServiceTypeLabel("Some Custom Type")).toBe("asbestos");
  });
});

function labReportDoc(serviceType: string): JobDocument {
  return {
    id: serviceType,
    kind: "lab_report",
    service_type: serviceType,
    file_name: "lab-report.pdf",
    storage_path: "x/lab-report.pdf",
    uploaded_at: "2026-09-17T00:00:00.000Z",
  };
}

describe("hasAllLabReports", () => {
  it("is true once the single label's own lab_report is in", () => {
    expect(hasAllLabReports("Limited Asbestos Inspection", [labReportDoc("Limited Asbestos Inspection")])).toBe(true);
  });

  it("is false with no documents at all", () => {
    expect(hasAllLabReports("Limited Asbestos Inspection", [])).toBe(false);
    expect(hasAllLabReports("Limited Asbestos Inspection", null)).toBe(false);
  });

  it("requires every label's own report, not just one of several", () => {
    const docs = [labReportDoc("Mold Air Sampling")];
    expect(hasAllLabReports("Mold Air Sampling, Mold Bulk Sampling", docs)).toBe(false);
    expect(hasAllLabReports("Mold Air Sampling, Mold Bulk Sampling", [...docs, labReportDoc("Mold Bulk Sampling")])).toBe(true);
  });

  it("ignores a lab_report filed under a different label, or a non-lab_report document", () => {
    const wrongLabel: JobDocument = { ...labReportDoc("Mold Bulk Sampling") };
    expect(hasAllLabReports("Mold Air Sampling", [wrongLabel])).toBe(false);
    const wrongKind: JobDocument = { ...labReportDoc("Mold Air Sampling"), kind: "coc" };
    expect(hasAllLabReports("Mold Air Sampling", [wrongKind])).toBe(false);
  });

  it("doesn't require a lab_report for a Moisture Mapping label", () => {
    const docs = [labReportDoc("Mold Air Sampling")];
    expect(hasAllLabReports("Mold Air Sampling, Moisture Mapping", docs)).toBe(true);
  });

  it("is false for a null/empty/blank service type", () => {
    expect(hasAllLabReports(null, [])).toBe(false);
    expect(hasAllLabReports("", [])).toBe(false);
  });
});

describe("jobReportDomains", () => {
  it("returns a single domain for a single-service-type job", () => {
    expect(jobReportDomains("Limited Asbestos Inspection")).toEqual(["asbestos"]);
    expect(jobReportDomains("Mold Air Sampling")).toEqual(["mold"]);
    expect(jobReportDomains("Lead Paint Inspection")).toEqual(["lead"]);
  });

  it("returns every distinct domain present, in original label order", () => {
    expect(jobReportDomains("Limited Asbestos Inspection, Mold Air Sampling")).toEqual(["asbestos", "mold"]);
    expect(jobReportDomains("Mold Air Sampling, Limited Asbestos Inspection")).toEqual(["mold", "asbestos"]);
  });

  it("dedupes multiple labels from the same domain into one entry", () => {
    expect(jobReportDomains("Mold Air Sampling, Mold Bulk Sampling")).toEqual(["mold"]);
    expect(jobReportDomains("Mold Air Sampling, Limited Asbestos Inspection, Mold Bulk Sampling")).toEqual(["mold", "asbestos"]);
  });

  it("defaults to asbestos for null, empty, or blank service types", () => {
    expect(jobReportDomains(null)).toEqual(["asbestos"]);
    expect(jobReportDomains(undefined)).toEqual(["asbestos"]);
    expect(jobReportDomains("")).toEqual(["asbestos"]);
    expect(jobReportDomains("  ,  ")).toEqual(["asbestos"]);
  });

  // Per Tim, 2026-09-04 — a job combining Moisture Mapping with a real
  // lab-sample service used to pick up a spurious extra domain, since
  // domainForServiceTypeLabel's fallback for anything unmatched is
  // "asbestos" — Moisture Mapping isn't a lab-sample domain at all, so it
  // was showing an "Asbestos Report" tab on a mold-only job with zero
  // asbestos work.
  it("excludes Moisture Mapping from domain matching entirely", () => {
    expect(jobReportDomains("Mold Bulk Sampling, Moisture Mapping")).toEqual(["mold"]);
    expect(jobReportDomains("Moisture Mapping, Limited Asbestos Inspection")).toEqual(["asbestos"]);
  });

  it("returns no domains for a Moisture-Mapping-only job (not the asbestos fallback)", () => {
    expect(jobReportDomains("Moisture Mapping")).toEqual([]);
  });
});

describe("isFullInspectionAsbestosJob", () => {
  it("is true for Pre-Renovation and Pre-Demolition", () => {
    expect(isFullInspectionAsbestosJob("Pre-Renovation Asbestos Inspection")).toBe(true);
    expect(isFullInspectionAsbestosJob("Pre-Demolition Asbestos Inspection")).toBe(true);
  });

  it("is false for Limited Asbestos Inspection and other domains", () => {
    expect(isFullInspectionAsbestosJob("Limited Asbestos Inspection")).toBe(false);
    expect(isFullInspectionAsbestosJob("Mold Air Sampling")).toBe(false);
    expect(isFullInspectionAsbestosJob("Lead Bulk Sampling")).toBe(false);
  });

  it("is false for null, undefined, or empty", () => {
    expect(isFullInspectionAsbestosJob(null)).toBe(false);
    expect(isFullInspectionAsbestosJob(undefined)).toBe(false);
    expect(isFullInspectionAsbestosJob("")).toBe(false);
  });

  it("matches within a combined-domain label list", () => {
    expect(isFullInspectionAsbestosJob("Pre-Renovation Asbestos Inspection, Mold Air Sampling")).toBe(true);
  });
});
