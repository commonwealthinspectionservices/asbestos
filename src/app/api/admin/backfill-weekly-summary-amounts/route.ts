import { NextRequest, NextResponse } from "next/server";
import rawPdfParse from "pdf-parse/lib/pdf-parse.js";
import { requireAdminApi } from "@/lib/admin-api";
import { withApiErrors } from "@/lib/api-handler";
import { getValidAccessToken, listMessagesByQuery, getMessage, findPdfParts, getAttachmentData } from "@/lib/gmail";
import { isWeeklyLabSummaryText } from "@/lib/parse-lab-invoice";
import { processWeeklyLabSummaryEmail } from "@/lib/lab-email";

// One-off, per Tim, 2026-09-13 — same root cause as the diagnostic that
// found the ~$900 QuickBooks gap: a resent weekly summary's topped-up
// amount for an already-recorded lab order number never got picked up,
// because checkForLabResultEmails' PROCESSED_LABEL skip excludes a
// message from ever reaching processWeeklyLabSummaryEmail a second time —
// exactly the historical messages this needs to fix. That skip is only
// bypassed here, deliberately, for a one-time backfill; the live cron
// still needs it (see its own comment on the -from:me loop) to avoid
// reprocessing this app's own outgoing drafts forever. Delete after
// running.
export const GET = withApiErrors(async (req: NextRequest) => {
  const unauthorized = requireAdminApi(req);
  if (unauthorized) return unauthorized;

  const accessToken = await getValidAccessToken();
  if (!accessToken) return NextResponse.json({ error: "Gmail not connected" }, { status: 400 });

  const candidates = await listMessagesByQuery(accessToken, `has:attachment filename:pdf newer_than:60d -from:me`);

  const results: { messageId: string; recorded: unknown[]; unmatched: unknown[]; flagged: unknown[] }[] = [];
  const errors: { messageId: string; error: string }[] = [];

  for (const candidate of candidates) {
    try {
      const message = await getMessage(accessToken, candidate.id);
      const pdfParts = findPdfParts(message.payload);
      for (const part of pdfParts) {
        try {
          const data = await getAttachmentData(accessToken, candidate.id, part.attachmentId);
          const { text } = await rawPdfParse(data);
          if (isWeeklyLabSummaryText(text)) {
            const { recorded, unmatched, flagged } = await processWeeklyLabSummaryEmail({
              accessToken,
              messageId: candidate.id,
              pdfBuffer: data,
              pdfText: text,
            });
            results.push({ messageId: candidate.id, recorded, unmatched, flagged });
          }
        } catch (e) {
          errors.push({ messageId: candidate.id, error: `attachment ${part.filename}: ${e instanceof Error ? e.message : String(e)}` });
        }
      }
    } catch (e) {
      errors.push({ messageId: candidate.id, error: e instanceof Error ? e.message : String(e) });
    }
  }

  return NextResponse.json({ scanned: candidates.length, weeklySummariesProcessed: results.length, results, errors });
});
