// Per Tim, 2026-09-28 — the other half of the Fast Mold Testing payment
// pipeline (see parse-fast-mold-invoice.ts): Mercury's own "<Company> sent
// you $X" notification is what actually confirms a payment landed, and its
// own "for invoice <number>" line is what ties it back to the invoice
// email that describes the underlying job. Built and tested against the
// real email's own plain-text body (from:hello@mercury.com), not a guess:
//
//   Fast Mold Testing, Inc. sent you $1,313.24
//   The funds will be posted to your account ending in 8178 in 1 business day.
//   ACH transfer
//   Amount Received: $1,313.24
//   Sent on: Monday September 28, 2026
//   Sender: My Duong on behalf of Fast Mold Testing, Inc.
//   To: AMERICAN EXPRESS NATIONAL BANK ••8178
//   ETA: 1 business day
//   Memo: From Fast Mold Testing, Inc. via mercury.com for invoice FMT-LQCDHD-2026
export interface ParsedMercuryPayment {
  payerCompany: string;
  amountCents: number;
  sentDate: string; // YYYY-MM-DD
  invoiceNumber: string | null;
}

// Same local-getters reasoning as parseFastMoldInvoiceText's own
// parseMonthDayYear — kept as a separate copy rather than a shared import
// since each parser is meant to stand alone (same pattern this app's other
// one-off email parsers already follow, e.g. parse-lab-invoice.ts).
function parseMonthDayYear(monthDayYear: string): string | null {
  const d = new Date(monthDayYear.trim());
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Deliberately doesn't require "mercury.com" to appear in the body itself
// — that substring only ever shows up in the optional Memo line (absent
// when the sender didn't attach an invoice reference), and the real
// sender-domain check belongs at the Gmail-query level (candidacy is
// established by `from:mercury.com`, same as every other known-sender
// intake in this app) — this is just a secondary content sanity check, on
// phrases Mercury's own template always includes regardless of memo.
export function isMercuryPaymentText(text: string): boolean {
  return /\bsent you \$/i.test(text) && /\bSender:/i.test(text);
}

export function parseMercuryPaymentText(text: string): ParsedMercuryPayment | null {
  if (!isMercuryPaymentText(text)) return null;

  const senderMatch = text.match(/^(.+?)\s+sent you\s+\$([\d,]+\.\d{2})/m);
  // "Sent on: Monday September 28, 2026" — the leading day-of-week name is
  // skipped; only the month/day/year after it is captured.
  const sentDateMatch = text.match(/Sent on:\s*[A-Za-z]+\s+([A-Za-z]+ \d{1,2},\s*\d{4})/);
  const invoiceMatch = text.match(/for invoice\s+([A-Za-z0-9-]+)/i);

  if (!senderMatch || !sentDateMatch) return null;
  const sentDate = parseMonthDayYear(sentDateMatch[1]);
  if (!sentDate) return null;

  return {
    payerCompany: senderMatch[1].trim(),
    amountCents: Math.round(Number(senderMatch[2].replace(/,/g, "")) * 100),
    sentDate,
    invoiceNumber: invoiceMatch?.[1]?.trim() ?? null,
  };
}
