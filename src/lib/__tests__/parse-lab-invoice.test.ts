import { describe, it, expect } from "vitest";
import { isLabInvoiceText, extractLabInvoiceTotalCents, extractInvoiceLineItems } from "../parse-lab-invoice";
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

// Real QuickBooks-generated payment-request invoice (Crystal Analytical's
// own invoice #6497) — confirmed live 2026-08-27: a completely different
// template from the two EMSL ones above, no "Sub Total" line at all.
const QUICKBOOKS_INVOICE = `
INVOICE
Crystal Analytical LLC
55 Accord Park Dr Ste 2D
Rockland, MA 02370-1070
ccleveland@crystalanalytical.com
+1 (781) 347-3936
www.crystalanalytical.com
Bill to
Tim Hall
Commonwealth Inspection Services, LLC
118 Greenacre Rd.
Westwood, MA 02090
Invoice details
Invoice no.: 6497
Terms: Net 30
Invoice date: 08/26/2026
Due date: 09/25/2026
#
DateProduct or serviceDescriptionQtyRateAmount
1.08/26/2026PLM - Bulk CVE, Per-Layer - 24 Hr
TAT
2601003647 - 690 Blue Hill Ave,
Dorchester, MA - 26-0004
10$12.00$120.00
Ways to pay
View and pay
Total
$120.00
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

  it("falls back to a plain Total line for a QuickBooks-generated invoice", () => {
    expect(extractLabInvoiceTotalCents(QUICKBOOKS_INVOICE)).toBe(12000);
  });
});

describe("isLabInvoiceText / extractInvoiceLineItems on a QuickBooks invoice", () => {
  it("still recognizes it as an invoice via its own Invoice no.: line", () => {
    expect(isLabInvoiceText(QUICKBOOKS_INVOICE)).toBe(true);
  });

  it("still extracts the project number and amount off its own line item", () => {
    expect(extractInvoiceLineItems(QUICKBOOKS_INVOICE)).toEqual([
      { projectNumber: "26-0004", amountCents: 12000 },
    ]);
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
