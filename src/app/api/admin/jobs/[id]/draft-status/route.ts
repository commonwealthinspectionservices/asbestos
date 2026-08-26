import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { requireAdminApi } from "@/lib/admin-api";
import { withApiErrors } from "@/lib/api-handler";
import { addLabelToMessage, draftExists, getOrCreateLabelId, getSentMessageInfo, getValidAccessToken } from "@/lib/gmail";

// Per Tim — every report/invoice this app detects as sent also gets his
// own "Sent Reports" Gmail label applied, so they're easy to find/filter
// in his inbox alongside whatever he sends by hand. getOrCreateLabelId
// finds his existing label by name rather than making a new one.
const SENT_REPORTS_LABEL = "Sent Reports";

// Live check for the Final Report tab's invoice and report rows. There is
// no manual "mark as sent" — this is the only place *_sent_at ever gets
// set, inferred from Gmail itself: still in Drafts is "drafted", gone-and-
// carrying-the-SENT-label is "sent" (and gets persisted right here so it
// sticks without a re-check), gone-and-unlabeled means the owner deleted
// the draft without sending. `kind` picks which pair of columns to check;
// defaults to "report" only as a safety net, the UI always passes it
// explicitly.
export const GET = withApiErrors(async (
  req: NextRequest,
  { params }: { params: { id: string } }
) => {
  const unauthorized = requireAdminApi(req);
  if (unauthorized) return unauthorized;

  const kind = req.nextUrl.searchParams.get("kind") === "invoice" ? "invoice" : "report";
  const gmailIdCol = kind === "invoice" ? "invoice_draft_gmail_id" : "report_draft_gmail_id";
  const gmailMessageIdCol = kind === "invoice" ? "invoice_draft_gmail_message_id" : "report_draft_gmail_message_id";
  const sentAtCol = kind === "invoice" ? "invoice_sent_at" : "report_sent_at";
  // The "combined" draft (createCombinedDraftForJob, the only path the UI
  // actually uses now) writes the same Gmail draft/message id into both
  // pairs of columns — one Gmail send event covers both. Selecting the
  // other kind's columns too lets a single check here mark both sent at
  // once, instead of leaving the other column stuck unset forever because
  // nothing else ever polls it with its own kind.
  const otherGmailIdCol = kind === "invoice" ? "report_draft_gmail_id" : "invoice_draft_gmail_id";
  const otherSentAtCol = kind === "invoice" ? "report_sent_at" : "invoice_sent_at";

  const supabase = getSupabaseAdmin();
  const { data: job } = await supabase
    .from("jobs")
    .select(`${gmailIdCol}, ${gmailMessageIdCol}, ${sentAtCol}, ${otherGmailIdCol}, ${otherSentAtCol}, status`)
    .eq("id", params.id)
    .maybeSingle<Record<string, string | null>>();

  const sentAt = job?.[sentAtCol];
  if (sentAt) {
    return NextResponse.json({ status: "sent", sentAt });
  }
  const gmailId = job?.[gmailIdCol];
  if (!gmailId) {
    return NextResponse.json({ status: "none" });
  }

  const accessToken = await getValidAccessToken();
  if (!accessToken) {
    return NextResponse.json({ status: "none" });
  }

  const stillDrafted = await draftExists(accessToken, gmailId);
  if (stillDrafted) {
    return NextResponse.json({ status: "drafted" });
  }

  // The draft is gone — figure out whether that's because it was sent.
  const gmailMessageId = job?.[gmailMessageIdCol];
  if (gmailMessageId) {
    const { sent, sentAt: resolvedSentAt } = await getSentMessageInfo(accessToken, gmailMessageId);
    if (sent) {
      const finalSentAt = resolvedSentAt ?? new Date().toISOString();
      const update: Record<string, string> = { [sentAtCol]: finalSentAt };
      const isCombinedDraft = gmailId && job?.[otherGmailIdCol] === gmailId && !job?.[otherSentAtCol];
      if (isCombinedDraft) update[otherSentAtCol] = finalSentAt;
      // Per Tim, 2026-08-26 — the moment both the report and invoice are
      // actually confirmed sent, advance out of "ready_to_send" (drafted,
      // not yet sent) into "report_invoice_sent" automatically. Only from
      // ready_to_send specifically — an individual-billed job is already
      // "paid" by the time its report/invoice go out (payment happens
      // before release for those), so this never regresses a paid job
      // backward.
      const otherAlreadySent = Boolean(job?.[otherSentAtCol]) || isCombinedDraft;
      if (otherAlreadySent && job?.status === "ready_to_send") {
        update.status = "report_invoice_sent";
      }
      await supabase.from("jobs").update(update).eq("id", params.id);
      // Best-effort — a labeling hiccup must never block the sent-status
      // check itself, which the Final Report tab depends on to update the
      // draft button.
      try {
        const labelId = await getOrCreateLabelId(accessToken, SENT_REPORTS_LABEL);
        await addLabelToMessage(accessToken, gmailMessageId, labelId);
      } catch (e) {
        console.error(`Failed to apply "${SENT_REPORTS_LABEL}" label to message ${gmailMessageId}:`, e);
      }
      return NextResponse.json({ status: "sent", sentAt: finalSentAt });
    }
  }

  return NextResponse.json({ status: "none" });
});
