import { describe, it, expect } from "vitest";
import { domainForServiceTypeLabel, jobReportDomains } from "@/lib/report-findings";

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
});
