// EMSL emails back a billing invoice for completed work, separate from the
// analytical results report — same "Project: NUMBER - ADDRESS" line as a
// results report (see extractReportProjectNumber in parse-lab-report.ts,
// which already handles this PDF's own "Project:" line fine, no changes
// needed there), but otherwise a completely different document. That means
// the existing project-number matching in lab-email.ts would happily match
// an invoice PDF to a job too — these two small functions are what let it
// tell the two apart and pull the dollar figure off the invoice once it does.

// "Federal Tax ID" only ever appears on EMSL's own billing paperwork (the
// biller's own EIN disclosure, e.g. "EMSL Analytical, Inc. Federal Tax ID
// 22-2357101") — never on an analytical results report. Confirmed against
// 4 real EMSL invoices.
//
// "Invoice no.:" is Crystal Analytical's own equivalent marker — confirmed
// against a real invoice (#6491, 08/25/2026): present on every invoice,
// absent from their analytical results reports (those use "Laboratory ID:"
// instead).
export function isLabInvoiceText(pdfText: string): boolean {
  return /Federal Tax ID/i.test(pdfText) || /Invoice no\.\s*:/i.test(pdfText);
}

// Crystal Analytical's own invoice number ("Invoice no.: 6491") — confirmed
// present on both their native template and the QuickBooks payment-request
// template (#6497/#6498, see extractLabInvoiceTotalCents's own comment on
// the two templates). Used so admin views can show the same number Tim
// already sees on Crystal's own invoice/email rather than a generic "Lab
// invoice" label. \s already matches a line break, same as the other
// extractors here tolerating a label split across lines in extracted text.
export function extractInvoiceNumber(pdfText: string): string | null {
  const match = pdfText.match(/Invoice no\.\s*:\s*(\S+)/i);
  return match ? match[1] : null;
}

export interface LabInvoiceLineItem {
  projectNumber: string;
  amountCents: number;
}

// Crystal Analytical bills per lab order, not per job — a single invoice
// routinely covers every job billed that day, one line item per lab order
// (a job with multiple sample types, like mold's Air-O-Cell + Direct
// Examination, gets multiple line items under the same project number).
// Each line's Description cell prints "<lab order id> - <address> -
// <FLI project number>", and in extracted text the line's Qty/Rate/Amount
// run on immediately after with no separating space (confirmed against
// invoice #6491: "...- 26-0003\n8$12.00$96.00" = qty 8, rate $12.00,
// amount $96.00). Returns one entry per LINE (not deduped/grouped) —
// callers that need a per-job total should group by projectNumber and sum
// amountCents themselves, since one job can have several line items here.
const LINE_ITEM_PATTERN = /(2\d-\d{3,6})\s*\n?\d+\$[\d,]+\.\d{2}\$([\d,]+\.\d{2})/g;

export function extractInvoiceLineItems(pdfText: string): LabInvoiceLineItem[] {
  return [...pdfText.matchAll(LINE_ITEM_PATTERN)].map((match) => ({
    projectNumber: match[1],
    amountCents: Math.round(parseFloat(match[2].replace(/,/g, "")) * 100),
  }));
}

// Anchored on "Sub Total" rather than "Invoice Total" — the latter's own
// label reliably splits across a line break in extracted text ("Invoice
// \nTotal"), and the same dollar figure repeats again in the tear-off
// payment stub at the bottom, both of which make it a less reliable
// anchor. "Sub Total" appears exactly once and always equals the real
// total in every sample seen (no separate tax/adjustment line ever splits
// them).
//
// Confirmed live 2026-08-27 (invoices #6497/#6498) — Crystal Analytical's
// invoices aren't all the same template: some come through QuickBooks'
// own payment-request emails instead, which have no "Sub Total" line at
// all, just a plain "Total" with the figure on its own line right after
// ("...Ways to pay\nView and pay\nTotal\n$120.00"). Falls back to that
// once "Sub Total" comes up empty — required literal "$" so this can't
// match the "Amount"/"Total" column header alone with no figure behind it.
export function extractLabInvoiceTotalCents(pdfText: string): number | null {
  const subTotalMatch = pdfText.match(/Sub\s*Total\s*\$?\s*([\d,]+\.\d{2})/i);
  if (subTotalMatch) return Math.round(parseFloat(subTotalMatch[1].replace(/,/g, "")) * 100);
  const totalMatch = pdfText.match(/\bTotal\s*\n?\s*\$\s*([\d,]+\.\d{2})/i);
  if (totalMatch) return Math.round(parseFloat(totalMatch[1].replace(/,/g, "")) * 100);
  return null;
}

// A completely different document from Crystal's own per-invoice PDFs
// above: QuickBooks' own weekly rollup email (quickbooks@notification.
// intuit.com, subject "Crystal Analytical Weekly Summary"), one PDF listing
// every transaction (Invoice, Sales Receipt, or Refund) billed against
// Commonwealth that week, regardless of which job(s) each one covers. Per
// Tim, 2026-08-28 — "the golden document for tracking it all": Sales
// Receipt and Refund transactions never arrive as their own separate email
// the way an Invoice does, so this is the only source for those. "Commonwealth
// Inspection Weekly Report" is this template's own fixed heading, confirmed
// unique to it (never appears on a per-invoice PDF).
export function isWeeklyLabSummaryText(pdfText: string): boolean {
  return /Commonwealth Inspection Weekly Report/i.test(pdfText);
}

export interface WeeklyLabSummaryTransaction {
  num: string;
  transactionType: "Invoice" | "Sales Receipt" | "Refund";
  date: string | null;
  projectNumber: string | null;
  address: string | null;
  amountCents: number;
  /** The line's own quantity — samples billed on this one lab order. Used for the duplicate/over-billing check in lab-email.ts, not shown to Tim directly. */
  quantity: number;
  /** Per-sample rate actually billed (the second of the four trailing numbers — see the row-shape comment below), in cents. Checked against lab-pricing.ts's published rates. */
  unitPriceCents: number;
  /** The "Product/Service full name" + description text printed before the lab order id — e.g. "Analytical Services:Asbestos Analysis:PLM - Bulk CVE, Per-Layer - 6Hr TAT". Fed to lab-pricing.ts to identify the test type and turnaround tier. Null if the row didn't have the expected lab-order-id anchor to split on. */
  testDescription: string | null;
}

// Confirmed against a real weekly report's own pdf-parse output (no spaces
// survive between adjacent table cells): one row reads as
// "08/26/2026Invoice6491<Product/Service name, wraps across several lines>
// <lab order id> - <address>[ - <FLI project number>]<qty><price><amount>
// <balance>" — the last four numbers run together with no separator at all
// (e.g. "8.0012.0096.0096.00"), but since none of them ever carries more
// than 2 decimal digits, and "." never appears anywhere else in a row,
// matching "digits/commas up to a 2-digit decimal" cleanly recovers all
// four every time — a comma thousands-separator ("1,028.00") or a leading
// "-" on a Refund line both still round-trip through this pattern intact.
// The lookahead (next row's own date+type, or either of the two closing
// "Total" lines) needs its own leading \s* — the line break before it is
// still there in extracted text even though nothing else is.
const TRANSACTION_ROW_PATTERN =
  /(\d{2}\/\d{2}\/\d{4})(Invoice|Sales Receipt|Refund)(\d+)([\s\S]*?)((?:-?[\d,]+\.\d{2}){4})(?=\s*\d{2}\/\d{2}\/\d{4}(?:Invoice|Sales Receipt|Refund)|\s*Total for|\s*TOTAL)/g;
const AMOUNT_TOKEN_PATTERN = /-?[\d,]+\.\d{2}/g;
const PROJECT_NUMBER_PATTERN = /(?<!\d)(2\d-\d{3,6})(?!\d)/;
// The Description cell's own lab-order id — an 8+ digit run with no
// decimal point — anchors where the address starts; an optional trailing
// " - <project number>" (not every line has one) marks where it ends.
const LAB_ORDER_ADDRESS_PATTERN = /\d{8,}\s*-\s*([\s\S]*?)(?:\s*-\s*2\d-\d{3,6})?\s*$/;
// Same lab-order-id anchor, but capturing everything BEFORE it instead —
// the "Product/Service full name" + description cell text (e.g.
// "Analytical Services:Asbestos Analysis:PLM - Bulk CVE, Per-Layer - 6Hr
// TAT"), which is what identifies the test type and turnaround tier for
// the price check in lab-pricing.ts.
const TEST_DESCRIPTION_PATTERN = /^([\s\S]*?)\d{8,}\s*-/;

export function extractWeeklyLabSummaryTransactions(pdfText: string): WeeklyLabSummaryTransaction[] {
  const transactions: WeeklyLabSummaryTransaction[] = [];
  for (const match of pdfText.matchAll(TRANSACTION_ROW_PATTERN)) {
    const [, date, transactionType, num, body, amountsBlock] = match;
    // Order is quantity, sales price, amount, balance — the transaction's
    // own dollar amount (what it actually billed) is the third of the four.
    const amounts = [...amountsBlock.matchAll(AMOUNT_TOKEN_PATTERN)].map((m) =>
      Math.round(parseFloat(m[0].replace(/,/g, "")) * 100)
    );
    const projectMatch = body.match(PROJECT_NUMBER_PATTERN);
    const addressMatch = body.match(LAB_ORDER_ADDRESS_PATTERN);
    const testDescMatch = body.match(TEST_DESCRIPTION_PATTERN);
    transactions.push({
      num,
      transactionType: transactionType as WeeklyLabSummaryTransaction["transactionType"],
      date,
      projectNumber: projectMatch ? projectMatch[1] : null,
      address: addressMatch ? addressMatch[1].replace(/\s+/g, " ").trim() : null,
      amountCents: amounts[2] ?? 0,
      // amounts[0]/[1] are cents-scaled (×100) since AMOUNT_TOKEN_PATTERN
      // always matches a 2-decimal dollar figure — quantity is a whole
      // number on every real row seen, so divide back down.
      quantity: (amounts[0] ?? 0) / 100,
      unitPriceCents: amounts[1] ?? 0,
      testDescription: testDescMatch ? testDescMatch[1].replace(/\s+/g, " ").trim() : null,
    });
  }
  return transactions;
}

// Per Tim, 2026-08-28 — "I just really want to go off those weekly
// reports... it should be the main outline": rather than inferring a
// week's real lab cost by summing whatever this system happened to
// attribute to jobs, this pulls the report's own printed grand total
// straight off the page — the same number Tim sees when he opens the real
// PDF. Anchored on "Total for Commonwealth Inspection" specifically (his
// own company's subtotal), not the bare "TOTAL" line right after it — this
// report's own title ("Commonwealth Inspection Weekly Report") means the
// two have always matched on every real example seen, but the named
// subtotal is the one that's unambiguously ours if Crystal's own template
// ever grows to list other clients in the same document. Same
// concatenated-numbers shape as the transaction rows above: "80.00
// $1,108.00" is quantity then dollar total, with no space in extracted
// text between the label and the numbers that follow it.
const REPORT_TOTAL_PATTERN = /Total for Commonwealth Inspection[\s\S]{0,60}?[\d,]+\.\d{2}\$([\d,]+\.\d{2})/i;

export function extractWeeklySummaryTotalCents(pdfText: string): number | null {
  const match = pdfText.match(REPORT_TOTAL_PATTERN);
  return match ? Math.round(parseFloat(match[1].replace(/,/g, "")) * 100) : null;
}

// The report's own printed billing period ("August 23-29, 2026") — sits on
// its own line directly under the "Commonwealth Inspection Weekly Report"
// heading, confirmed against a real example. A period that crosses a month
// boundary prints the second month's name too ("August 30-September 5,
// 2026") — confirmed live 2026-09-03 against the first real report to span
// one since the lab moved to daily invoicing: the day-count didn't change
// (still a 7-day window each report), but daily emails make a
// month-crossing window come up far more often than it did as a once-a-week
// report, and the original digits-only day2 pattern silently failed to
// match it, leaving report_date_range null on every transaction from that
// report — the optional second month name group here fixes that.
const REPORT_DATE_RANGE_PATTERN = /Commonwealth Inspection Weekly Report\s*\n?\s*([A-Za-z]+\s+\d{1,2}\s*-\s*(?:[A-Za-z]+\s+)?\d{1,2},\s*\d{4})/;

export function extractWeeklySummaryDateRangeLabel(pdfText: string): string | null {
  const match = pdfText.match(REPORT_DATE_RANGE_PATTERN);
  return match ? match[1].replace(/\s+/g, " ").trim() : null;
}

// A third real Crystal Analytical email shape, confirmed live 2026-09-04
// ("Sales Receipt - Additional Jobs"): a credit-card auto-charge receipt,
// one per payment batch (not per job, and not per lab order — its own
// "SALES <n>" number is a THIRD numbering namespace, distinct from both
// the weekly summary's per-line "Num" and Crystal's older "Invoice no.:"
// template), routinely covering several jobs' worth of samples at once.
// Neither isWeeklyLabSummaryText nor isLabInvoiceText recognize this shape
// — confirmed the real email fell through both checks and got misfiled as
// a lab_report (fake analytical results) on job 26-0013, caught only by
// luck via the existing domain_mismatch heuristic. "SALES" (no colon,
// unlike "Invoice no.:") plus "BALANCE DUE" together are unique to this
// template.
export function isLabSalesReceiptText(pdfText: string): boolean {
  return /\bSALES\s*\d/i.test(pdfText) && /BALANCE DUE/i.test(pdfText);
}

export function extractLabSalesReceiptNumber(pdfText: string): string | null {
  const match = pdfText.match(/\bSALES\s*(\d+)/i);
  return match ? match[1] : null;
}

export interface LabSalesReceiptLine {
  date: string | null;
  testDescription: string;
  projectNumber: string | null;
  address: string | null;
  quantity: number;
  unitPriceCents: number;
  amountCents: number;
}

// One row per line item: "<date><description><lab-order-id> - <address>[ -
// <project#>]\n<qty><rate>.00<amount>.00" — same lab-order-id anchor as the
// weekly summary's own row shape, but the trailing qty/rate/amount cluster
// prints differently here: qty has NO decimal point (just "4", "12", "3"),
// immediately followed by rate and amount which DO ("12.0048.00"). That
// makes the qty/rate boundary genuinely ambiguous from the digit string
// alone ("412.0048.00" could misparse as qty=41/rate=2.00 just as easily as
// the real qty=4/rate=12.00) — resolved by trying each plausible qty
// length (1-3 digits) and keeping the one where quantity × rate actually
// equals the printed amount, rather than trusting the first regex match.
const SALES_RECEIPT_ROW_PATTERN = /(\d{2}\/\d{2}\/\d{4})([\s\S]*?)\n([\d.]+)\n/g;

function splitQuantityRateAmount(tail: string): { quantity: number; unitPriceCents: number; amountCents: number } | null {
  for (let qtyLen = 1; qtyLen <= 3 && qtyLen < tail.length; qtyLen++) {
    const qtyStr = tail.slice(0, qtyLen);
    const rest = tail.slice(qtyLen);
    if (!/^\d+$/.test(qtyStr)) continue;
    const restMatch = rest.match(/^(\d+\.\d{2})(\d+\.\d{2})$/);
    if (!restMatch) continue;
    const quantity = parseInt(qtyStr, 10);
    const unitPriceCents = Math.round(parseFloat(restMatch[1]) * 100);
    const amountCents = Math.round(parseFloat(restMatch[2]) * 100);
    if (quantity * unitPriceCents === amountCents) {
      return { quantity, unitPriceCents, amountCents };
    }
  }
  return null;
}

export function extractLabSalesReceiptLines(pdfText: string): LabSalesReceiptLine[] {
  const lines: LabSalesReceiptLine[] = [];
  for (const match of pdfText.matchAll(SALES_RECEIPT_ROW_PATTERN)) {
    const [, date, body, tail] = match;
    const split = splitQuantityRateAmount(tail);
    if (!split) continue;
    const testDescMatch = body.match(TEST_DESCRIPTION_PATTERN);
    const testDescription = testDescMatch ? testDescMatch[1].replace(/\s+/g, " ").trim() : body.replace(/\s+/g, " ").trim();
    const addressMatch = body.match(LAB_ORDER_ADDRESS_PATTERN);
    const projectMatch = body.match(PROJECT_NUMBER_PATTERN);
    lines.push({
      date,
      testDescription,
      projectNumber: projectMatch ? projectMatch[1] : null,
      address: addressMatch ? addressMatch[1].replace(/\s+/g, " ").trim() : null,
      ...split,
    });
  }
  return lines;
}
