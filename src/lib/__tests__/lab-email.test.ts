import { describe, it, expect } from "vitest";
import { extractProjectNumberFromCocSubject, normalizeAddressForMatch, isMoldLabReport } from "@/lib/lab-email";

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
