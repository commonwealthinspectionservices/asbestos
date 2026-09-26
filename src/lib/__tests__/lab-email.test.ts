import { describe, it, expect } from "vitest";
import { extractProjectNumberFromCocSubject, normalizeAddressForMatch, isMoldLabReport, hasLabReportForEveryDomain, invoiceDraftBodyHtml, reportDraftBodyHtml, combinedDraftBodyHtml, projectNumberLine } from "@/lib/lab-email";
import { dueDateSyncTarget } from "@/lib/stripe";
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

  // Per Tim, 2026-09-08 — invoice-only emails aren't the right moment to
  // ask for a review (superseded the 2026-09-03 decision to include it
  // here too).
  it("does not include the Google review link", () => {
    const job = { service_address: "85 Child St, Boston, MA 02130", service_type: "Mold Bulk Sampling" } as Job;
    const html = invoiceDraftBodyHtml(job, settings, null);
    expect(html).not.toContain('<a href="https://g.page/r/CXrf5GqjFZJjECE/review">Leave a review</a>');
  });

  // Per Tim, 2026-09-03 — individual/homeowner jobs only, since payment
  // only ever gates the report for those (see the homeowner payment
  // gate) — a company job's report is never held on payment at all, so
  // the note would just be wrong there.
  it("includes the payment-gates-results note for an individual job", () => {
    const job = { service_address: "85 Child St, Boston, MA 02130", service_type: "Mold Bulk Sampling", is_individual: true } as Job;
    const html = invoiceDraftBodyHtml(job, settings, null);
    expect(html).toContain("<em>Payment must be completed in order for results to be sent out.</em>");
  });

  it("omits the payment-gates-results note for a company job", () => {
    const job = { service_address: "85 Child St, Boston, MA 02130", service_type: "Mold Bulk Sampling", is_individual: false } as Job;
    const html = invoiceDraftBodyHtml(job, settings, null);
    expect(html).not.toContain("Payment must be completed");
  });
});

// Per Tim, 2026-09-25 — "let's just make it a habit to include the project
// number directly above the address... project number then address then date
// of sampling in that order."
describe("project number leads the address in client emails", () => {
  const settings = { business_phone: "617-390-4778" } as Settings;
  const job = {
    project_number: "26-0041.1",
    service_address: "50 Broadway Unit 2, Somerville, MA 02145",
    service_type: "Mold Air Sampling, Mold Bulk Sampling",
    confirmed_date: "2026-09-23",
    requested_date: "2026-09-23",
  } as Job;
  const order = (html: string, ...needles: string[]) => needles.map((n) => html.indexOf(n));

  it("report email: Project #, then Address, then Date of Sampling", () => {
    const html = reportDraftBodyHtml(job, settings);
    const [p, a, d] = order(html, "Project #: 26-0041.1", "Address: ", "Date of Sampling: ");
    expect(p).toBeGreaterThanOrEqual(0);
    expect(p).toBeLessThan(a);
    expect(a).toBeLessThan(d);
  });

  it("combined report+invoice email: Project #, then Site, then Date of Sampling", () => {
    const html = combinedDraftBodyHtml({ ...job, customers: { company_id: null } } as never, settings, 86600, null);
    const [p, a, d] = order(html, "Project #:</strong> 26-0041.1", "Site:</strong>", "Date of Sampling:</strong>");
    expect(p).toBeGreaterThanOrEqual(0);
    expect(p).toBeLessThan(a);
    expect(a).toBeLessThan(d);
  });

  it("invoice email: Project # sits directly above the address", () => {
    const html = invoiceDraftBodyHtml(job, settings, null);
    expect(html.indexOf("Project #: 26-0041.1")).toBeGreaterThanOrEqual(0);
    expect(html.indexOf("Project #: 26-0041.1")).toBeLessThan(html.indexOf("50 Broadway Unit 2"));
  });

  it("leaves the line out when a job has no project number yet", () => {
    expect(projectNumberLine({ project_number: null })).toEqual([]);
    expect(reportDraftBodyHtml({ ...job, project_number: null } as Job, settings)).not.toContain("Project #");
  });
});

// 26-0008, 2026-09-26 — its regenerated invoice said "Due October 19" while
// the job was due 9/26.
describe("dueDateSyncTarget", () => {
  const tz = "America/New_York";
  const now = Math.floor(new Date("2026-09-26T14:00:00Z").getTime() / 1000); // 10am ET on 9/26
  const oct19 = Math.floor(new Date("2026-10-19T12:00:00Z").getTime() / 1000);
  const endOfSep26ET = Math.floor(new Date("2026-09-27T03:59:00Z").getTime() / 1000);

  it("moves an invoice showing October 19 to end of day on the job's own 9/26 due date", () => {
    expect(dueDateSyncTarget(oct19, "2026-09-26", tz, now)).toBe(endOfSep26ET);
  });
  it("does nothing when the invoice already has the job's due date", () => {
    expect(dueDateSyncTarget(endOfSep26ET, "2026-09-26", tz, now)).toBeNull();
  });
  it("does nothing when the job has no due date of its own", () => {
    expect(dueDateSyncTarget(oct19, null, tz, now)).toBeNull();
  });
  it("does nothing for a due date that has already passed", () => {
    expect(dueDateSyncTarget(oct19, "2026-09-20", tz, now)).toBeNull();
  });
});
