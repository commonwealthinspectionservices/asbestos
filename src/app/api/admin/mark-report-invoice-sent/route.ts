import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-api";
import { withApiErrors } from "@/lib/api-handler";
import { getSupabaseAdmin } from "@/lib/supabase";
import { getValidAccessToken, deleteDraft } from "@/lib/gmail";
import { tagInvoiceEmailed } from "@/lib/stripe";

// One-off: for a job the owner actually sent by hand, outside the app's own
// draft (so checkDraftSentStatus's own Gmail-based auto-detection has
// nothing to detect) — marks report/invoice sent exactly the way that
// function would have, had it seen the real send, and cleans up the now-
// stale unsent draft still sitting in Drafts. Delete this route after use.
export const POST = withApiErrors(async (req: NextRequest) => {
  const unauthorized = requireAdminApi(req);
  if (unauthorized) return unauthorized;

  const { projectNumber } = await req.json();
  if (!projectNumber) return NextResponse.json({ error: "projectNumber required" }, { status: 400 });

  const supabase = getSupabaseAdmin();
  const { data: job, error } = await supabase
    .from("jobs")
    .select("id, status, report_draft_gmail_id, invoice_draft_gmail_id, stripe_invoice_id")
    .eq("project_number", projectNumber)
    .single();
  if (error || !job) return NextResponse.json({ error: error?.message ?? "not found" }, { status: 404 });

  const sentAt = new Date().toISOString();
  const update: Record<string, string> = { report_sent_at: sentAt, invoice_sent_at: sentAt };
  if (job.status === "ready_to_send") update.status = "report_invoice_sent";
  await supabase.from("jobs").update(update).eq("id", job.id);

  if (job.stripe_invoice_id) {
    try {
      await tagInvoiceEmailed(job.stripe_invoice_id, sentAt);
    } catch (e) {
      console.error(`Failed to tag Stripe invoice ${job.stripe_invoice_id} as emailed:`, e);
    }
  }

  // The stale draft this app created but the owner never actually sent
  // (he composed and sent a separate message by hand instead) — best-
  // effort cleanup, same as every other draft-recreation path in
  // lab-email.ts.
  const accessToken = await getValidAccessToken();
  const staleDraftIds = new Set([job.report_draft_gmail_id, job.invoice_draft_gmail_id].filter((id): id is string => Boolean(id)));
  const deleted: string[] = [];
  if (accessToken) {
    for (const id of staleDraftIds) {
      try {
        await deleteDraft(accessToken, id);
        deleted.push(id);
      } catch (e) {
        console.error(`Failed to delete stale draft ${id}:`, e);
      }
    }
  }

  return NextResponse.json({ ok: true, update, deletedDrafts: deleted });
});
