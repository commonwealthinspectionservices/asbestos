import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-api";
import { withApiErrors } from "@/lib/api-handler";
import {
  getValidAccessToken,
  listMessagesByQuery,
  getMessage,
  getHeader,
  findPdfParts,
  getAttachmentData,
} from "@/lib/gmail";
import pdfParse from "pdf-parse/lib/pdf-parse.js";

// Same flaky-pdf-parse-under-repeated-use retry already confirmed and
// fixed in audit-lab-invoices — without it, 2 of these 11 real messages
// threw "Invalid PDF structure" and got silently skipped.
async function parsePdfWithRetry(buffer: Buffer, attempts = 3): Promise<string> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const { text } = await pdfParse(buffer);
      return text;
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError;
}

// One-off, 2026-09-08 — read-only. Tim: "I'm sure they did charge this
// all already" re: 3 jobs the app shows as "no lab invoice yet" (their
// week is over): 26-0002.1 (36 Drummer Rd, Acton), 26-0010 (6 Redmond
// Ave, N. Reading), 26-0017 (10 Ridgeway Rd, N. Reading). Downloads every
// real message in the "Crystal Invoices" label since 08/20 and searches
// its actual PDF text for each job's address/street name, so this can be
// checked directly against what Crystal really sent rather than trusting
// the matching pipeline's own silence as proof nothing arrived.
export const GET = withApiErrors(async (req: NextRequest) => {
  const unauthorized = requireAdminApi(req);
  if (unauthorized) return unauthorized;
  const accessToken = await getValidAccessToken();
  if (!accessToken) return NextResponse.json({ error: "Gmail is not connected" }, { status: 500 });

  const needles = [
    { pn: "26-0002.1", terms: ["26-0002", "Drummer"] },
    { pn: "26-0010", terms: ["26-0010", "Redmond"] },
    { pn: "26-0017", terms: ["26-0017", "Ridgeway"] },
  ];

  const query = `label:"Crystal Invoices" after:2026/08/20`;
  const candidates = await listMessagesByQuery(accessToken, query);
  const results = [];
  for (const c of candidates) {
    const message = await getMessage(accessToken, c.id);
    const subject = getHeader(message, "Subject") ?? "";
    const date = getHeader(message, "Date") ?? "";
    const pdfParts = findPdfParts(message.payload);
    const hits: Record<string, string[]> = {};
    for (const part of pdfParts) {
      try {
        const data = await getAttachmentData(accessToken, c.id, part.attachmentId);
        const text = await parsePdfWithRetry(data);
        for (const n of needles) {
          const found = n.terms.filter((t) => text.toLowerCase().includes(t.toLowerCase()));
          if (found.length > 0) {
            hits[n.pn] = [...(hits[n.pn] ?? []), ...found.map((f) => `${part.filename}:${f}`)];
          }
        }
        // Context around "Drummer" specifically — 26-0002.1 shares its
        // address with 26-0002 (already known billed under #6491/6568/
        // 6610/6611), so a plain substring hit can't tell whether this is
        // just those same known charges recurring in a cumulative report,
        // or a genuinely new lab order number for the revisit.
        const drummerIdx = text.toLowerCase().indexOf("drummer");
        if (drummerIdx !== -1) {
          hits._drummerContext = [...(hits._drummerContext ?? []), text.slice(Math.max(0, drummerIdx - 120), drummerIdx + 40).replace(/\s+/g, " ")];
        }
      } catch (e) {
        hits._error = [...(hits._error ?? []), `${part.filename}: ${e instanceof Error ? e.message : String(e)}`];
      }
    }
    results.push({ subject, date, hits });
  }
  return NextResponse.json({ checked: results.length, results });
});
