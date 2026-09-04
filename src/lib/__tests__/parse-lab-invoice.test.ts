import { describe, it, expect } from "vitest";
import {
  isLabInvoiceText,
  extractLabInvoiceTotalCents,
  extractInvoiceLineItems,
  isWeeklyLabSummaryText,
  extractWeeklyLabSummaryTransactions,
  extractWeeklySummaryTotalCents,
  extractWeeklySummaryDateRangeLabel,
} from "../parse-lab-invoice";
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

// Real pdf-parse output (verbatim, via `pdf-parse/lib/pdf-parse.js` against
// the actual PDF Tim forwarded, 2026-08-28) — QuickBooks' own weekly rollup
// email, a completely different template from any per-invoice PDF above:
// one table, every transaction (Invoice/Sales Receipt/Refund) billed that
// week, columns run together with no space in extracted text (see
// TRANSACTION_ROW_PATTERN's own comment). 17 line items across 15 distinct
// Nums, one Refund, several jobs with no project number printed at all.
const WEEKLY_SUMMARY = `Cash Basis  Friday, August 28, 2026 05:00 PM GMT-04:00
  1/1
Crystal Analytical LLC
Commonwealth Inspection Weekly Report
August 23-29, 2026
Transaction dateTransaction typeNumProduct/Service full nameDescriptionQuantitySales priceAmountBalance
Commonwealth Inspection Services,
LLC
08/26/2026Invoice6491
Analytical Services:Asbestos
Analysis:PLM - Bulk CVE, Per-Layer
- 24 Hr TAT
2601003627 - 61 Partridge St.,
Boston, MA - 26-0003
8.0012.0096.0096.00
08/26/2026Invoice6491
Analytical Services:Asbestos
Analysis:PLM - Bulk CVE, Per-Layer
- 24 Hr TAT
2601003617 - 36 Drummer Rd.,
Acton, MA - 26-0002
12.0012.00144.00240.00
08/26/2026Invoice6491
Analytical Services:Mold
Analysis:Mold - Spore Trap Analysis
- 24Hr TAT
2601003618 - 36 Drummer Rd.,
Acton, MA - 26-0002
4.0020.0080.00320.00
08/26/2026Invoice6491
Analytical Services:Mold
Analysis:Mold - Direct Examination -
24Hr TAT
2601003618 - 36 Drummer Rd.,
Acton, MA - 26-0002
1.0020.0020.00340.00
08/26/2026Invoice6491
Analytical Services:Asbestos
Analysis:PLM - Bulk CVE, Per-Layer
- 24 Hr TAT
2601003626 - 17 Hastings St.,
Framingham, MA - 26-0001
4.0012.0048.00388.00
08/26/2026Invoice6497
Analytical Services:Asbestos
Analysis:PLM - Bulk CVE, Per-Layer
- 24 Hr TAT
2601003647 - 690 Blue Hill Ave,
Dorchester, MA - 26-0004
10.0012.00120.00508.00
08/26/2026Invoice6498
Analytical Services:Asbestos
Analysis:PLM - Bulk CVE, Per-Layer
- 24 Hr TAT
2601003646 - 29 Tilesboro St., Unit
3, Dorchester, MA - 26-0005
8.0012.0096.00604.00
08/26/2026Sales Receipt6504
Analytical Services:Asbestos
Analysis:PLM - Bulk CVE, Per-Layer
- 24 Hr TAT
2601003653 - 150 Bishops Forest
Dr., Waltham, MA
4.0012.0048.00652.00
08/26/2026Refund6505
Analytical Services:Asbestos
Analysis:PLM - Bulk CVE, Per-Layer
- 24 Hr TAT
2601003653 - 150 Bishops Forest
Dr., Waltham, MA
-4.0012.00-48.00604.00
08/26/2026Sales Receipt6506
Analytical Services:Asbestos
Analysis:PLM - Bulk CVE, Per-Layer
- 24 Hr TAT
2601003655 - 150 Bishops Forest
Drive, Waltham, MA - 26-0007
8.0015.00120.00724.00
08/26/2026Sales Receipt6510
Analytical Services:Mold
Analysis:Mold - Direct Examination -
24Hr TAT
2601003653 - 150 Bishops Forest
Dr., Waltham, MA - 26-0007
2.0020.0040.00764.00
08/26/2026Sales Receipt6512
Analytical Services:Mold
Analysis:Mold - Spore Trap Analysis
- 24Hr TAT
2601003654 - 150 Bishops Forest
Dr., Waltham, MA - 26-0007
3.0020.0060.00824.00
08/26/2026Sales Receipt6515
Analytical Services:Asbestos
Analysis:PLM - Bulk CVE, Per-Layer
- 24 Hr TAT
2601003663 - 11 James Way,
Cambridge, MA
8.0012.0096.00920.00
08/26/2026Sales Receipt6516
Analytical Services:Asbestos
Analysis:PLM - Bulk CVE, Per-Layer
- 24 Hr TAT
2601003656 - 89 Trefton Ave,
Weymouth, MA - 26-0006
4.0012.0048.00968.00
08/26/2026Sales Receipt6519
Analytical Services:Mold
Analysis:Mold - Spore Trap Analysis
- 24Hr TAT
2601003664 - 11 James Way,
Cambridge, MA - 26-0008
3.0020.0060.001,028.00
08/26/2026Sales Receipt6519
Analytical Services:Mold
Analysis:Mold - Direct Examination -
24Hr TAT
2601003664 - 11 James Way,
Cambridge, MA - 26-0008
1.0020.0020.001,048.00
08/28/2026Sales Receipt6545
Analytical Services:Asbestos
Analysis:PLM - Bulk CVE, Per-Layer
- 3Hr TAT
2601003704 - 1 Riverview Rd.,
Hingham, MA - 26-0009
4.0015.0060.001,108.00
Total for Commonwealth Inspection
Services, LLC
80.00$1,108.00
TOTAL80.00$1,108.00`;

describe("isWeeklyLabSummaryText", () => {
  it("recognizes a real QuickBooks weekly summary", () => {
    expect(isWeeklyLabSummaryText(WEEKLY_SUMMARY)).toBe(true);
  });

  it("does not mistake a per-invoice PDF for a weekly summary", () => {
    expect(isWeeklyLabSummaryText(QUICKBOOKS_INVOICE)).toBe(false);
    expect(isWeeklyLabSummaryText(INVOICE_8_SAMPLES)).toBe(false);
  });
});

describe("extractWeeklyLabSummaryTransactions", () => {
  const transactions = extractWeeklyLabSummaryTransactions(WEEKLY_SUMMARY);

  it("extracts every one of the 17 real line items", () => {
    expect(transactions).toHaveLength(17);
  });

  it("totals to exactly the report's own grand total ($1,108.00)", () => {
    expect(transactions.reduce((sum, t) => sum + t.amountCents, 0)).toBe(110_800);
  });

  it("reads transaction type, num, and project number off the first (Invoice) row", () => {
    expect(transactions[0]).toMatchObject({
      num: "6491",
      transactionType: "Invoice",
      projectNumber: "26-0003",
      amountCents: 9600,
    });
  });

  it("also reads quantity, unit price, and test description off that same row", () => {
    expect(transactions[0]).toMatchObject({
      quantity: 8,
      unitPriceCents: 1200,
      testDescription: "Analytical Services:Asbestos Analysis:PLM - Bulk CVE, Per-Layer - 24 Hr TAT",
    });
  });

  it("sums multiple line items under the same num for the same job (mold sub-methods, #6491/26-0002)", () => {
    const num6491Job0002 = transactions.filter((t) => t.num === "6491" && t.projectNumber === "26-0002");
    expect(num6491Job0002.map((t) => t.amountCents)).toEqual([14400, 8000, 2000]);
  });

  it("reads a Sales Receipt row correctly, including its rush rate ($15/sample, not the standard $12)", () => {
    const rushRow = transactions.find((t) => t.num === "6545");
    expect(rushRow).toMatchObject({
      transactionType: "Sales Receipt",
      projectNumber: "26-0009",
      amountCents: 6000,
      unitPriceCents: 1500,
    });
  });

  it("reads a Refund row as a negative amount", () => {
    const refundRow = transactions.find((t) => t.num === "6505");
    expect(refundRow).toMatchObject({ transactionType: "Refund", amountCents: -4800 });
  });

  it("leaves projectNumber null for a line with no FLI project number printed at all", () => {
    const unmatchedRow = transactions.find((t) => t.num === "6504");
    expect(unmatchedRow?.projectNumber).toBeNull();
    expect(unmatchedRow?.address).toBe("150 Bishops Forest Dr., Waltham, MA");
  });

  it("groups the same job's split billing across separate Sales Receipt nums (26-0007: #6506/#6510/#6512)", () => {
    const job0007 = transactions.filter((t) => t.projectNumber === "26-0007");
    expect(job0007.map((t) => t.num)).toEqual(["6506", "6510", "6512"]);
    expect(job0007.reduce((sum, t) => sum + t.amountCents, 0)).toBe(22000);
  });
});

describe("extractWeeklySummaryTotalCents", () => {
  it("reads the report's own printed grand total ($1,108.00)", () => {
    expect(extractWeeklySummaryTotalCents(WEEKLY_SUMMARY)).toBe(110_800);
  });

  it("returns null for a document that isn't a weekly summary", () => {
    expect(extractWeeklySummaryTotalCents(QUICKBOOKS_INVOICE)).toBeNull();
  });
});

describe("extractWeeklySummaryDateRangeLabel", () => {
  it("reads the report's own printed billing period", () => {
    expect(extractWeeklySummaryDateRangeLabel(WEEKLY_SUMMARY)).toBe("August 23-29, 2026");
  });

  it("returns null for a document that isn't a weekly summary", () => {
    expect(extractWeeklySummaryDateRangeLabel(QUICKBOOKS_INVOICE)).toBeNull();
  });

  // Real report text confirmed live 2026-09-03 — daily invoicing makes a
  // period crossing a month boundary come up far more often than it did
  // as a once-a-week report, and the original pattern silently returned
  // null for one of these (recorded lab costs correctly, but with no
  // report_date_range, breaking BillingView's grouping).
  it("reads a billing period that crosses a month boundary", () => {
    const monthCrossing = `Cash Basis  Thursday, September 03, 2026 05:00 PM GMT-04:00
Crystal Analytical LLC
Commonwealth Inspection Weekly Report
August 30-September 5, 2026
Transaction dateTransaction typeNum...`;
    expect(extractWeeklySummaryDateRangeLabel(monthCrossing)).toBe("August 30-September 5, 2026");
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
