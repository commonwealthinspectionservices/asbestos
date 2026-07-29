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
// 4 real EMSL invoices. EMSL-specific so far; revisit once a real invoice
// from another lab (e.g. Crystal Analytical) is seen, same incremental,
// real-sample-driven approach as KNOWN_LABS in parse-lab-report.ts.
export function isLabInvoiceText(pdfText: string): boolean {
  return /Federal Tax ID/i.test(pdfText);
}

// Anchored on "Sub Total" rather than "Invoice Total" — the latter's own
// label reliably splits across a line break in extracted text ("Invoice
// \nTotal"), and the same dollar figure repeats again in the tear-off
// payment stub at the bottom, both of which make it a less reliable
// anchor. "Sub Total" appears exactly once and always equals the real
// total in every sample seen (no separate tax/adjustment line ever splits
// them).
export function extractLabInvoiceTotalCents(pdfText: string): number | null {
  const match = pdfText.match(/Sub\s*Total\s*\$?\s*([\d,]+\.\d{2})/i);
  if (!match) return null;
  return Math.round(parseFloat(match[1].replace(/,/g, "")) * 100);
}
