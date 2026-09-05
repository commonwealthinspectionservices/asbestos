import { describe, expect, it } from "vitest";
import { isLabSalesReceiptText, extractLabSalesReceiptNumber, extractLabSalesReceiptLines } from "../parse-lab-invoice";

// Real pdf-parse output from a real Crystal Analytical "Sales Receipt -
// Additional Jobs" email, confirmed live 2026-09-04 — this exact document
// fell through both isWeeklyLabSummaryText and isLabInvoiceText and got
// misfiled as a fake lab_report on job 26-0013 (caught only by luck via
// the existing domain_mismatch heuristic).
const SALES_RECEIPT = `

--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
No additional transfer fees or taxes apply.
Intuit Payments Inc (IPI) processes payments as an agent of the business. Payment processed by IPI constitutes payment to the business and satisfies your obligation to
pay the business, including in connection with any dispute or case, in law or equity. Money movement services are provided by IPI pursuant to IPI’s licenses (NMLS
#1098819, www.intuit.com/legal/licenses/payment-licenses/). IPI is located at 2700 Coast Avenue, Mountain View, CA 94043, 1-888-536-4801.
Page 1 of 1
Crystal Analytical LLC
55 Accord Park Dr Ste 2D
Rockland, MA  02370-1070 US
(781) 347-3936
ccleveland@crystalanalytical.com
www.crystalanalytical.com

SALES RECEIPT
BILL TO
Tim Hall
Commonwealth Inspection Services, LLC
118 Greenacre Rd.
Westwood, MA  02090
SALES6645
DATE09/04/2026
PAYMENT METHOD
Commonwealth CC - xxxxxxxxxxx1008
AUTH CODE
170499






DATEDESCRIPTIONQTYRATEAMOUNT
09/01/2026PLM - Bulk CVE, Per-
Layer - 24 Hr TAT
2601003752 - 38 Michael Rd.,
Randolph, MA - 26-0013
412.0048.00
09/01/2026PLM - Bulk CVE, Per-
Layer - 24 Hr TAT
2601003751 - 6 Comanche Cir.,
Chelmsford, MA - 26-0012
1212.00144.00
09/03/2026Mold - Direct Examination
- 24Hr TAT
2601003787 - 85 Child St., Boston, MA
- 26-0014
320.0060.00
 TOTAL252.00
BALANCE DUE
$0.00`;

describe("isLabSalesReceiptText", () => {
  it("recognizes a real Sales Receipt email", () => {
    expect(isLabSalesReceiptText(SALES_RECEIPT)).toBe(true);
  });

  it("does not misfire on a weekly summary or a plain results report", () => {
    expect(isLabSalesReceiptText("Commonwealth Inspection Weekly Report\nAugust 23-29, 2026")).toBe(false);
    expect(isLabSalesReceiptText("Laboratory ID: 2601003786\nTest Report for the Analysis of Asbestos")).toBe(false);
  });
});

describe("extractLabSalesReceiptNumber", () => {
  it("reads the SALES number", () => {
    expect(extractLabSalesReceiptNumber(SALES_RECEIPT)).toBe("6645");
  });
});

describe("extractLabSalesReceiptLines", () => {
  const lines = extractLabSalesReceiptLines(SALES_RECEIPT);

  it("extracts all 3 real line items", () => {
    expect(lines).toHaveLength(3);
  });

  it("correctly disambiguates quantity/rate/amount despite the ambiguous concatenated digits (4|12.00|48.00, not 41|2.00|48.00)", () => {
    expect(lines[0]).toMatchObject({
      date: "09/01/2026",
      projectNumber: "26-0013",
      quantity: 4,
      unitPriceCents: 1200,
      amountCents: 4800,
    });
  });

  it("handles a 2-digit quantity correctly (12|12.00|144.00, not 1|212.00|144.00)", () => {
    expect(lines[1]).toMatchObject({
      date: "09/01/2026",
      projectNumber: "26-0012",
      quantity: 12,
      unitPriceCents: 1200,
      amountCents: 14400,
    });
  });

  it("reads the mold line correctly", () => {
    expect(lines[2]).toMatchObject({
      date: "09/03/2026",
      projectNumber: "26-0014",
      quantity: 3,
      unitPriceCents: 2000,
      amountCents: 6000,
      testDescription: "Mold - Direct Examination - 24Hr TAT",
    });
  });

  it("every line's quantity times rate equals the printed amount", () => {
    for (const line of lines) {
      expect(line.quantity * line.unitPriceCents).toBe(line.amountCents);
    }
  });
});
