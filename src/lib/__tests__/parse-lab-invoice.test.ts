import { describe, it, expect } from "vitest";
import { isLabInvoiceText, extractLabInvoiceTotalCents } from "../parse-lab-invoice";
import { extractReportProjectNumber, detectLabInfo } from "../parse-lab-report";

// Excerpt of a real EMSL billing invoice's extracted text (not a results
// report) — same "Project:" line a results report carries, but otherwise a
// completely different document: invoice header/footer, a charges table
// priced per sample, and the dollar total repeated once mid-body and again
// in the tear-off payment stub at the bottom.
const INVOICE_8_SAMPLES = `
EMSL Analytical, Inc.
EMSL Analytical, Inc. Federal Tax ID 22-2357101
5 Constitution Way, Unit A, Woburn, MA 01801
(781) 933-8411
7/21/2026
PLM Asbestos Analysis of Bulk Materials via AHERA EA 10.60 84.80
Method 40CFR 763 Subpart E Appendix E
supplemented with EPA 600/R-93/116 using
Polarized Light Microscopy
32 Hour
Project: 26-2713 - 320 Mendon Road; North
Attleboro, MA
7/19/2026 132605141 8
Sub Total 84.80
$84.80
Billing Inquiries - please call 1-800-220-3675
Invoice
Total
Please detach and return with payment
Invoice Date $84.80
`;

const INVOICE_4_SAMPLES = `
EMSL Analytical, Inc.
EMSL Analytical, Inc. Federal Tax ID 22-2357101
5 Constitution Way, Unit A, Woburn, MA 01801
7/21/2026
PLM Asbestos Analysis of Bulk Materials via AHERA EA 10.60 42.40
Project: 26-2723 - 3 Sunrise Avenue; Plymouth, MA
7/19/2026 132605140 4
Sub Total 42.40
$42.40
Invoice
Total
Invoice Date $42.40
`;

// A real results report excerpt (from parse-lab-report.test.ts) — used
// here only to confirm invoice detection doesn't false-positive on it.
const REPORT_8_SAMPLES = `
EMSL Analytical, Inc.
5 Constitution Way, Unit A Woburn, MA  01801
132605192
EMSL Order:
Customer ID:
FLIE62
Project:
26-2752 - 21 Plain Road; Weston, MA
SampleDescriptionAppearance% Fibrous% Non-Fibrous
01A
132605192-0001
None DetectedNon-fibrous (Other)88%
Samples analyzed by EMSL Analytical, Inc. Woburn, MA NVLAP Lab Code 101147-0, CT PH-0315, MA AA000188
`;

describe("isLabInvoiceText", () => {
  it("recognizes a real EMSL invoice", () => {
    expect(isLabInvoiceText(INVOICE_8_SAMPLES)).toBe(true);
    expect(isLabInvoiceText(INVOICE_4_SAMPLES)).toBe(true);
  });

  it("does not mistake a results report for an invoice", () => {
    expect(isLabInvoiceText(REPORT_8_SAMPLES)).toBe(false);
  });
});

describe("extractLabInvoiceTotalCents", () => {
  it("extracts the dollar total via Sub Total", () => {
    expect(extractLabInvoiceTotalCents(INVOICE_8_SAMPLES)).toBe(8480);
    expect(extractLabInvoiceTotalCents(INVOICE_4_SAMPLES)).toBe(4240);
  });

  it("returns null when there's no Sub Total line at all", () => {
    expect(extractLabInvoiceTotalCents(REPORT_8_SAMPLES)).toBeNull();
  });
});

describe("invoice PDFs still parse fine with the existing results-report helpers", () => {
  it("still extracts the project number off the invoice's own Project: line", () => {
    expect(extractReportProjectNumber(INVOICE_8_SAMPLES)).toBe("26-2713");
    expect(extractReportProjectNumber(INVOICE_4_SAMPLES)).toBe("26-2723");
  });

  it("still recognizes EMSL as the lab from the invoice text", () => {
    expect(detectLabInfo(INVOICE_8_SAMPLES)?.labName).toBe("EMSL Analytical, Inc.");
  });
});
