import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { requireAdminApi } from "@/lib/admin-api";
import { withApiErrors } from "@/lib/api-handler";
import { draftExists, getSentMessageInfo, getValidAccessToken } from "@/lib/gmail";

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

  const supabase = getSupabaseAdmin();
  const { data: job } = await supabase
    .from("jobs")
    .select(`${gmailIdCol}, ${gmailMessageIdCol}, ${sentAtCol}`)
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
      await supabase.from("jobs").update({ [sentAtCol]: finalSentAt }).eq("id", params.id);
      return NextResponse.json({ status: "sent", sentAt: finalSentAt });
    }
  }

  return NextResponse.json({ status: "none" });
});
