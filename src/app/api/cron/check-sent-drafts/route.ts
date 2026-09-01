import { NextRequest, NextResponse } from "next/server";
import { requireCronAuth, withCronAlert } from "@/lib/cron-auth";
import { withApiErrors } from "@/lib/api-handler";
import { getSupabaseAdmin } from "@/lib/supabase";
import { checkDraftSentStatus, checkForBouncedSends } from "@/lib/lab-email";

// Reads req.headers (via requireCronAuth) — without this, Next tries to
// statically render the route at build time and throws "Dynamic server
// usage" (see check-lab-emails' own identical comment).
export const dynamic = "force-dynamic";

// Per Tim, 2026-08-26 — checkDraftSentStatus used to only ever run when
// someone had a specific job's Final Report tab open, so a report/invoice
// sent while nothing was watching sat undetected (and unlabeled "Sent
// Reports" in Gmail) until the next time that job happened to be opened,
// which could be hours or days. This runs the exact same check for every
// job with an outstanding, not-yet-confirmed-sent draft, on the same
// 15-minute cadence as check-lab-emails.
export const GET = withApiErrors(withCronAlert("check-sent-drafts", async (req: NextRequest) => {
  const unauthorized = requireCronAuth(req);
  if (unauthorized) return unauthorized;

  const supabase = getSupabaseAdmin();
  const { data: jobs } = await supabase
    .from("jobs")
    .select("id, project_number, report_draft_gmail_id, report_sent_at, invoice_draft_gmail_id, invoice_sent_at")
    .or("and(report_draft_gmail_id.not.is.null,report_sent_at.is.null),and(invoice_draft_gmail_id.not.is.null,invoice_sent_at.is.null)");

  const results: { projectNumber: string | null; kind: "report" | "invoice"; status: string; sentAt?: string }[] = [];
  for (const job of jobs ?? []) {
    if (job.report_draft_gmail_id && !job.report_sent_at) {
      const result = await checkDraftSentStatus(job.id, "report");
      if (result.status === "sent") {
        results.push({ projectNumber: job.project_number, kind: "report", ...result });
      }
    }
    if (job.invoice_draft_gmail_id && !job.invoice_sent_at) {
      const result = await checkDraftSentStatus(job.id, "invoice");
      if (result.status === "sent") {
        results.push({ projectNumber: job.project_number, kind: "invoice", ...result });
      }
    }
  }

  // Per Tim, 2026-09-01 — same 15-minute cadence catches a real bounce
  // (Gmail's own Mail Delivery Subsystem notice) for something this app
  // just marked sent above, and undoes the sent status/tracker advance —
  // see checkForBouncedSends's own comment.
  const bounces = await checkForBouncedSends();

  return NextResponse.json({ checked: jobs?.length ?? 0, newlySent: results, bounces });
}));
