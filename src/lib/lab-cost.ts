import type { JobDocument } from "@/lib/types";

// Per Tim, 2026-08-28 — Job's own lab_cost_cents used to be written
// directly by whichever pipeline last touched it, each with its own
// bespoke semantics: EMSL's single-invoice path overwrote it outright, the
// Crystal multi-job-invoice path also overwrote it (per job, scoped to
// that job's own share), and the new weekly-summary path added to it. That
// was already fragile before a job could be billed across more than one
// invoice/receipt number in the same stretch — confirmed for real on
// 26-0007, split across three separate Sales Receipts (#6506/#6510/#6512)
// in one week — since the three writers' different overwrite/add semantics
// would race depending purely on processing order. This derives the one
// true total straight from the job's own itemized lab_invoice documents
// every time (each one now carries its own amount_cents — see
// JobDocument's own comment), so it can never drift out of sync with
// what's actually on file: every writer just appends/replaces a document
// and recomputes from the result, instead of mutating a shared scalar.
//
// Deduped by lab_invoice_number — a job combining domains (e.g. asbestos +
// mold) gets one lab_invoice JobDocument row PER SERVICE-TYPE LABEL for the
// very same real invoice, all carrying the identical amount_cents (that
// job's whole share of that one invoice, not split per domain); counting
// every row would double- or triple-count it. A document with no
// lab_invoice_number (an EMSL invoice, which never has one) falls back to
// its own id so it isn't collapsed with anything else.
export function computeLabCostCentsFromDocuments(documents: JobDocument[]): number {
  const amountByKey = new Map<string, number>();
  for (const doc of documents) {
    if (doc.kind !== "lab_invoice" || doc.amount_cents == null) continue;
    const key = doc.lab_invoice_number ?? doc.id;
    if (!amountByKey.has(key)) amountByKey.set(key, doc.amount_cents);
  }
  let total = 0;
  for (const amount of amountByKey.values()) total += amount;
  return total;
}
