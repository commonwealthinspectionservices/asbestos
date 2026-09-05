import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-api";
import { withApiErrors } from "@/lib/api-handler";
import { getValidAccessToken, listMessagesByQuery, getMessage, getHeader, findPdfParts, getAttachmentData, getOrCreateLabelId } from "@/lib/gmail";
import pdfParse from "pdf-parse/lib/pdf-parse.js";
import { isLabInvoiceText, isWeeklyLabSummaryText, isLabSalesReceiptText } from "@/lib/parse-lab-invoice";
import { extractReportProjectNumber } from "@/lib/parse-lab-report";

// One-off diagnostic, 2026-09-05 — read-only, no writes, no labels touched.
// checkForLabResultEmails reported 6 "unmatched" candidates out of 25 on a
// real run (2026-09-05) — this replays the exact same candidate query and
// classification logic (isWeeklyLabSummaryText/isLabSalesReceiptText/
// isLabInvoiceText/extractReportProjectNumber) to report subject/sender/
// classification for every candidate, so the 6 real unmatched ones can be
// read without guessing. Never marks anything processed. Label names/ids
// must match lib/lab-email.ts's own PROCESSED_LABEL/LEGACY_PROCESSED_LABEL
// exactly — labelIds on a message are opaque Gmail label IDs, not names,
// so they only compare correctly after resolving the name via
// getOrCreateLabelId, same as the real pipeline does.
const PROCESSED_LABEL = "Processed/Lab Reports";
const LEGACY_PROCESSED_LABEL = "cis-lab-email-processed";

export const GET = withApiErrors(async (req: NextRequest) => {
  const unauthorized = requireAdminApi(req);
  if (unauthorized) return unauthorized;

  const accessToken = await getValidAccessToken();
  if (!accessToken) return NextResponse.json({ error: "Gmail is not connected" }, { status: 500 });

  const processedLabelId = await getOrCreateLabelId(accessToken, PROCESSED_LABEL);
  const legacyProcessedLabelId = await getOrCreateLabelId(accessToken, LEGACY_PROCESSED_LABEL);
  const candidates = await listMessagesByQuery(accessToken, `has:attachment filename:pdf newer_than:14d -from:me`);
  const results: Record<string, unknown>[] = [];

  for (const candidate of candidates) {
    try {
      const message = await getMessage(accessToken, candidate.id);
      const subject = getHeader(message, "Subject") ?? "";
      const from = getHeader(message, "From") ?? "";
      const date = getHeader(message, "Date") ?? "";
      const alreadyProcessed = Boolean(message.labelIds?.includes(processedLabelId) || message.labelIds?.includes(legacyProcessedLabelId));

      const pdfParts = findPdfParts(message.payload);
      const partSummaries: Record<string, unknown>[] = [];
      for (const part of pdfParts) {
        try {
          const data = await getAttachmentData(accessToken, candidate.id, part.attachmentId);
          const { text } = await pdfParse(data);
          partSummaries.push({
            filename: part.filename,
            isWeeklySummary: isWeeklyLabSummaryText(text),
            isSalesReceipt: isLabSalesReceiptText(text),
            isLabInvoice: isLabInvoiceText(text),
            reportProjectNumber: extractReportProjectNumber(text),
            snippet: text.slice(0, 200).replace(/\s+/g, " "),
          });
        } catch (e) {
          partSummaries.push({ filename: part.filename, error: e instanceof Error ? e.message : String(e) });
        }
      }

      results.push({ id: candidate.id, subject, from, date, alreadyProcessed, parts: partSummaries });
    } catch (e) {
      results.push({ id: candidate.id, error: e instanceof Error ? e.message : String(e) });
    }
  }

  return NextResponse.json({ checked: results.length, results });
});
