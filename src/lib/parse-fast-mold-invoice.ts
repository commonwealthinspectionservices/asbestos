// Per Tim, 2026-09-28 — "in the future all of these should be logged in
// my admin page and in QuickBooks automatically": Fast Mold Testing's own
// invoicing system emails a "[INVOICE] Tim Hall - INV-..." PDF once a job
// he did for them is done, billed against their own client and offset by
// whatever lab samples they covered themselves (see 26-0040, restored
// 2026-09-28, for the real example this was built against — text below is
// pdf-parse's own real extraction of that exact PDF, not a guess at the
// shape). This only ever parses THIS one invoice format; a genuinely
// different layout should fail to parse (return null) rather than guess,
// same as every other lab/invoice parser in this app.
//
// Real pdf-parse output this was built against:
//   Invoice Number:
//   FMT-LQCDHD-2026
//   Invoice Date:
//   September 22, 2026
//   ...
//   Location:
//   627 Tremont Street, Boston, MA 02118
//   ...
//   Notes: Client (Andrea Joanna Contreras,
//   Property Manager for RENU Vacations)
//   ...
//   September
//   18, 2026
//   11:00 AM
//   $1638.24
//   Less: Lab Services provided by Fast
//   Mold Testing, Inc.
//   (13 samples @ $25.00 each, offset per
//   service agreement)
//   September
//   18, 2026
//   –$325.00
//   Total Due$1313.24
export interface ParsedFastMoldInvoice {
  invoiceNumber: string;
  invoiceDate: string; // YYYY-MM-DD
  serviceAddress: string;
  inspectionDate: string; // YYYY-MM-DD
  inspectionTime: string | null; // as printed, e.g. "11:00 AM"
  endClientName: string | null;
  endClientCompany: string | null;
  baseAmountCents: number;
  labFeeCents: number; // positive — the amount offset, not the signed delta
  netAmountCents: number; // "Total Due"
}

// "September 22, 2026" (no time component) parses as local midnight in
// Node either way — reading it back with the LOCAL getters (not the UTC
// ones) means the calendar date that comes out always matches the string
// that went in, regardless of which timezone the server process happens
// to be running in.
function parseMonthDayYear(monthDayYear: string): string | null {
  const d = new Date(monthDayYear.trim());
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function centsFromDollarString(s: string): number {
  return Math.round(Number(s.replace(/,/g, "")) * 100);
}

export function isFastMoldInvoiceText(text: string): boolean {
  return /invoice for mold inspection services/i.test(text) && /fast mold testing/i.test(text);
}

export function parseFastMoldInvoiceText(text: string): ParsedFastMoldInvoice | null {
  if (!isFastMoldInvoiceText(text)) return null;

  // \s+ throughout (not \s*\n\s*) — this same invoice reaches this parser
  // two different ways with two different whitespace shapes: pdf-parse's
  // extraction of the PDF attachment splits "September 18, 2026" across
  // lines (month, then day/year, on their own lines), while Fast Mold
  // Testing's own email has no PDF attachment at all (confirmed live,
  // 2026-09-28 — findPdfParts came back empty for the real message), so
  // this also has to parse getMessageBodyText's crude tag-stripped HTML
  // fallback, where that same date sits on one line, space-separated.
  // \s+ matches either shape.
  const invoiceNumberMatch = text.match(/Invoice Number:\s+([A-Za-z0-9-]+)/);
  const invoiceDateMatch = text.match(/Invoice Date:\s+([A-Za-z]+ \d{1,2},\s*\d{4})/);
  const addressMatch = text.match(/Location:\s+(.+)/);
  const clientMatch = text.match(/Client\s*\(\s*([^,]+),\s*([^)]+)\)/);
  // The inspection's own month/day/year/time — same shape twice in the
  // real invoice (once per line item), always identical, so the first
  // match is authoritative.
  const inspectionMatch = text.match(/([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})\s+(\d{1,2}:\d{2}\s*[AP]M)/);
  // The base fee is the first plain (non-offset) dollar amount, printed
  // right after that same inspection date/time block.
  const baseMatch = text.match(/\d{1,2}:\d{2}\s*[AP]M\s+\$([\d,]+\.\d{2})/);
  // En dash ("–"), not a hyphen — pdf-parse preserves it verbatim.
  const labFeeMatch = text.match(/–\$([\d,]+\.\d{2})/);
  const totalMatch = text.match(/Total Due\s*\$?([\d,]+\.\d{2})/);

  if (!invoiceNumberMatch || !invoiceDateMatch || !addressMatch || !inspectionMatch || !baseMatch || !totalMatch) {
    return null;
  }

  const invoiceDate = parseMonthDayYear(invoiceDateMatch[1]);
  const inspectionDate = parseMonthDayYear(`${inspectionMatch[1]} ${inspectionMatch[2]}, ${inspectionMatch[3]}`);
  if (!invoiceDate || !inspectionDate) return null;

  return {
    invoiceNumber: invoiceNumberMatch[1].trim(),
    invoiceDate,
    serviceAddress: addressMatch[1].trim(),
    inspectionDate,
    inspectionTime: inspectionMatch[4]?.replace(/\s+/g, " ").trim() ?? null,
    endClientName: clientMatch?.[1]?.trim() ?? null,
    endClientCompany: clientMatch?.[2]?.replace(/\s+/g, " ").trim() ?? null,
    baseAmountCents: centsFromDollarString(baseMatch[1]),
    labFeeCents: labFeeMatch ? centsFromDollarString(labFeeMatch[1]) : 0,
    netAmountCents: centsFromDollarString(totalMatch[1]),
  };
}
