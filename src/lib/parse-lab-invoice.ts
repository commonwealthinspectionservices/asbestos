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
