import { NextRequest, NextResponse } from "next/server";
import rawPdfParse from "pdf-parse/lib/pdf-parse.js";
import { requireAdminApi } from "@/lib/admin-api";
import { withApiErrors } from "@/lib/api-handler";
import { getValidAccessToken, listMessagesByQuery, getMessage, getHeader, findPdfParts, getAttachmentData } from "@/lib/gmail";
import { isWeeklyLabSummaryText, extractWeeklySummaryTotalCents, extractWeeklySummaryDateRangeLabel } from "@/lib/parse-lab-invoice";
import { getSupabaseAdminFresh } from "@/lib/supabase";

// One-off diagnostic, per Tim, 2026-09-13 — a real ~$909 gap between
// QuickBooks' Crystal Analytical expenses and this app's own tracked lab
// costs. The live cron (check-lab-emails) only ever searches
// `newer_than:14d` on a rolling basis — any weekly summary it failed to
// process more than 14 days ago is now permanently outside that search
// window, with no alert and no retry. This widens the same search to 60
// days and reports every weekly-summary PDF found (its own printed total,
// independent of job-matching), so it can be compared directly against
// what's actually recorded in the jobs table. Delete after running.
export const GET = withApiErrors(async (req: NextRequest) => {
  const unauthorized = requireAdminApi(req);
  if (unauthorized) return unauthorized;

  const accessToken = await getValidAccessToken();
  if (!accessToken) return NextResponse.json({ error: "Gmail not connected" }, { status: 400 });

  const candidates = await listMessagesByQuery(accessToken, `has:attachment filename:pdf newer_than:60d -from:me`);

  const found: { messageId: string; subject: string; date: string; filename: string; totalCents: number | null; dateRangeLabel: string | null; labelIds: string[] }[] = [];
  const errors: { messageId: string; error: string }[] = [];

  for (const candidate of candidates) {
    try {
      const message = await getMessage(accessToken, candidate.id);
      const subject = getHeader(message, "Subject") ?? "";
      const dateHeader = getHeader(message, "Date") ?? "";
      const pdfParts = findPdfParts(message.payload);
      for (const part of pdfParts) {
        try {
          const data = await getAttachmentData(accessToken, candidate.id, part.attachmentId);
          const { text } = await rawPdfParse(data);
          if (isWeeklyLabSummaryText(text)) {
            found.push({
              messageId: candidate.id,
              subject,
              date: dateHeader,
              filename: part.filename,
              totalCents: extractWeeklySummaryTotalCents(text),
              dateRangeLabel: extractWeeklySummaryDateRangeLabel(text),
              labelIds: message.labelIds ?? [],
            });
          }
        } catch (e) {
          errors.push({ messageId: candidate.id, error: `attachment ${part.filename}: ${e instanceof Error ? e.message : String(e)}` });
        }
      }
    } catch (e) {
      errors.push({ messageId: candidate.id, error: e instanceof Error ? e.message : String(e) });
    }
  }

  // What the app itself has recorded, grouped by the same report_date_range
  // label the weekly summary PDFs print — so each Gmail-found summary can
  // be lined up against what actually made it into a job's lab_cost_cents.
  const supabase = getSupabaseAdminFresh();
  const { data: jobs } = await supabase.from("jobs").select("documents");
  const recordedByRange: Record<string, number> = {};
  for (const job of jobs ?? []) {
    const docs = (job as { documents?: { kind?: string; report_date_range?: string | null; amount_cents?: number | null }[] }).documents ?? [];
    for (const doc of docs) {
      if (doc.kind === "lab_invoice" && doc.report_date_range) {
        recordedByRange[doc.report_date_range] = (recordedByRange[doc.report_date_range] ?? 0) + (doc.amount_cents ?? 0);
      }
    }
  }

  return NextResponse.json({ scanned: candidates.length, weeklySummariesFound: found.length, found, recordedByRange, errors });
});
