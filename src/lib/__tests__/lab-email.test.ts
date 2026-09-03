import { describe, it, expect } from "vitest";
import { extractProjectNumberFromCocSubject, normalizeAddressForMatch, isMoldLabReport, hasLabReportForEveryDomain, invoiceDraftBodyHtml } from "@/lib/lab-email";
import type { Job, JobDocument, Settings } from "@/lib/types";

function labReportDoc(serviceType: string): JobDocument {
  return {
    id: "doc-1",
    kind: "lab_report",
    service_type: serviceType,
    file_name: "report.pdf",
    storage_path: "job-1/report.pdf",
    uploaded_at: "2026-09-02T00:00:00.000Z",
  };
}

describe("extractProjectNumberFromCocSubject", () => {
  it("extracts the project number from a real EMSL receipt-confirmation subject", () => {
    const subject =
      "EMSL receipt confirmation, COC for order(s) 132605381 (132605381 - 26-2806 - 11 Regent Circle; Unit 1; Brookline, MA)";
    expect(extractProjectNumberFromCocSubject(subject)).toBe("26-2806");
  });

  it("is case-insensitive on the gating phrase", () => {
    const subject = "coc for order(s) 12345 (12345 - 26-1302 - 545 Herman Street, Fall River, MA)";
    expect(extractProjectNumberFromCocSubject(subject)).toBe("26-1302");
  });

  it("returns null when the subject isn't a COC receipt email, even if it contains a project-number-shaped string", () => {
    const subject = "Re: 26-2806 - invoice question";
    expect(extractProjectNumberFromCocSubject(subject)).toBeNull();
  });

  it("returns null when the gating phrase is present but no project-number-shaped token is found", () => {
    const subject = "EMSL receipt confirmation, COC for order(s) 132605381 (no project number here)";
    expect(extractProjectNumberFromCocSubject(subject)).toBeNull();
  });
});

// Confirmed live 2026-08-26 (job 26-0004) — the report-address fallback
// match's whole reason for existing is a lab report with no project number
// printed as text anywhere, only a zip-less address. These lock in the
// normalization that has to bridge that gap.
describe("normalizeAddressForMatch", () => {
  it("matches a report's zip-less address against a job's full stored address", () => {
    const reportAddress = normalizeAddressForMatch("690 Blue Hill Ave, Dorchester, MA");
    const storedAddress = normalizeAddressForMatch("690 Blue Hill Ave, Dorchester, MA 02121");
    expect(storedAddress.startsWith(reportAddress)).toBe(true);
  });

  it("matches regardless of street-suffix abbreviation", () => {
    expect(normalizeAddressForMatch("690 Blue Hill Ave, Dorchester, MA")).toBe(
      normalizeAddressForMatch("690 Blue Hill Avenue, Dorchester, MA")
    );
  });

  it("does not match a different street number at the same street", () => {
    const reportAddress = normalizeAddressForMatch("692 Blue Hill Ave, Dorchester, MA");
    const storedAddress = normalizeAddressForMatch("690 Blue Hill Ave, Dorchester, MA 02121");
    expect(storedAddress.startsWith(reportAddress)).toBe(false);
  });
});

// Confirmed live 2026-08-26 (jobs 26-0007/26-0008) — a mixed asbestos+mold
// job listing asbestos first used to assume every incoming report was
// asbestos, silently dropping mold results that arrived on their own
// "Final Fungal Report" email. These lock in detecting the report's own
// domain from its subject/content instead of the job's field order.
describe("isMoldLabReport", () => {
  it("recognizes a real Fungal Report subject as mold", () => {
    expect(isMoldLabReport("Final Fungal Report for 11 James Way, Cambridge, MA", "")).toBe(true);
  });

  it("recognizes 'Fungal' inside the PDF text even if the subject doesn't have it", () => {
    expect(isMoldLabReport("Re: your samples", "This Fungal Analysis Report covers...")).toBe(true);
  });

  it("treats a real asbestos PLM report subject as not mold", () => {
    expect(isMoldLabReport("Final Analysis Report for 2601003647 - 690 Blue Hill Ave, Dorchester, MA", "")).toBe(false);
  });
});

// Per Tim, 2026-09-02 — a homeowner job can now be invoiced and paid
// before lab results exist (manual sample-count entry on the Invoice
// tab), so autoDraftReportIfJustPaid can no longer assume "just paid"
// means "the lab report PDF is already filed." These lock in the guard
// that stops it from drafting an incomplete report (no lab results
// pages) the moment a job with no lab_report document yet is marked paid.
describe("hasLabReportForEveryDomain", () => {
  it("is false when no documents have been filed yet", () => {
    expect(hasLabReportForEveryDomain({ documents: null, service_type: "Limited Asbestos Inspection" })).toBe(false);
    expect(hasLabReportForEveryDomain({ documents: [], service_type: "Limited Asbestos Inspection" })).toBe(false);
  });

  it("is true once a matching-domain lab_report document is filed", () => {
    const job = { documents: [labReportDoc("Limited Asbestos Inspection")], service_type: "Limited Asbestos Inspection" };
    expect(hasLabReportForEveryDomain(job)).toBe(true);
  });

  it("is false for a mixed-domain job missing one domain's lab report", () => {
    const job = {
      documents: [labReportDoc("Limited Asbestos Inspection")],
      service_type: "Limited Asbestos Inspection, Mold Air Sampling",
    };
    expect(hasLabReportForEveryDomain(job)).toBe(false);
  });

  it("is true once every domain on a mixed job has its own lab report", () => {
    const job = {
      documents: [labReportDoc("Limited Asbestos Inspection"), labReportDoc("Mold Air Sampling")],
      service_type: "Limited Asbestos Inspection, Mold Air Sampling",
    };
    expect(hasLabReportForEveryDomain(job)).toBe(true);
  });
});

// Confirmed live 2026-09-03 (26-0014, mold-only) — this always said "the
// asbestos inspection" regardless of the job's real service type. Locks in
// that it now matches reportDraftBodyHtml's own domain-aware phrasing.
describe("invoiceDraftBodyHtml", () => {
  const settings = { business_phone: "781-486-3200" } as Settings;

  it("names mold, not asbestos, for a mold-only job", () => {
    const job = { service_address: "85 Child St, Boston, MA 02130", service_type: "Mold Bulk Sampling" } as Job;
    const html = invoiceDraftBodyHtml(job, settings, null);
    expect(html).toContain("the mold inspection completed at");
    expect(html).not.toContain("asbestos");
  });

  it("names asbestos for an asbestos-only job", () => {
    const job = { service_address: "1 Main St, Boston, MA 02130", service_type: "Limited Asbestos Inspection" } as Job;
    const html = invoiceDraftBodyHtml(job, settings, null);
    expect(html).toContain("the asbestos inspection completed at");
  });

  it("names both domains for a mixed asbestos+mold job", () => {
    const job = { service_address: "1 Main St, Boston, MA 02130", service_type: "Limited Asbestos Inspection, Mold Air Sampling" } as Job;
    const html = invoiceDraftBodyHtml(job, settings, null);
    expect(html).toContain("the asbestos and mold inspection completed at");
  });

  // Per Tim, 2026-09-03 — a review-link line under the signature on every
  // invoice and report email.
  it("includes the Google review link", () => {
    const job = { service_address: "85 Child St, Boston, MA 02130", service_type: "Mold Bulk Sampling" } as Job;
    const html = invoiceDraftBodyHtml(job, settings, null);
    expect(html).toContain('<a href="https://g.page/r/CXrf5GqjFZJjECE/review">Leave a review</a>');
  });
});
