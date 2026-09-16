import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-api";
import { getSupabaseAdmin } from "@/lib/supabase";
import { withApiErrors } from "@/lib/api-handler";
import { jobReportDomains } from "@/lib/report-findings";
import type { Job } from "@/lib/types";

// Per Tim, 2026-09-16 — a one-time retroactive sweep, not a route anything
// else calls. report_sent_domains only starts getting populated on a NEW
// report-sent confirmation going forward (see checkDraftSentStatus in
// lib/lab-email.ts) — it can't retroactively know which domain(s) an
// already-sent job's report actually covered. Before this field existed,
// every real report-drafting path always built every domain on the job at
// once, so report_sent_at being set has always safely meant "every domain
// this job has was sent together" — EXCEPT the Email tab's own per-domain
// checklist (draftSelectedEmailForJob), which lets a subset go out on its
// own and is exactly what exposed this gap (26-0032, where only its
// Asbestos report had gone out but the card read as "Report: Sent" for
// the whole job). This backfill applies the safe bulk assumption — every
// domain on the job, same timestamp as report_sent_at — to every
// already-sent job; any job whose real history doesn't match that
// (26-0032 included) needs its own one-off correction afterward, same as
// any other data-quality exception this backfill can't know about on its
// own. GET (not POST), and idempotent — only ever fills in a job whose
// report_sent_domains is still null, never overwrites one that's already
// set — so it's safe to re-run.
export const GET = withApiErrors(async (req: NextRequest) => {
  const unauthorized = requireAdminApi(req);
  if (unauthorized) return unauthorized;

  const supabase = getSupabaseAdmin();
  const { data: jobs, error } = await supabase
    .from("jobs")
    .select("id, project_number, service_type, report_sent_at, report_sent_domains")
    .not("report_sent_at", "is", null);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  type Row = Pick<Job, "id" | "project_number" | "service_type" | "report_sent_at" | "report_sent_domains">;

  let scanned = 0;
  let alreadySet = 0;
  let backfilled = 0;
  const errors: { project_number: string | null; error: string }[] = [];

  for (const job of (jobs ?? []) as unknown as Row[]) {
    scanned++;
    if (job.report_sent_domains && Object.keys(job.report_sent_domains).length > 0) {
      alreadySet++;
      continue;
    }
    try {
      const domains = jobReportDomains(job.service_type);
      const sentDomains = Object.fromEntries(domains.map((d) => [d, job.report_sent_at as string]));
      const { error: updateError } = await supabase
        .from("jobs")
        .update({ report_sent_domains: sentDomains })
        .eq("id", job.id);
      if (updateError) throw new Error(updateError.message);
      backfilled++;
    } catch (e) {
      errors.push({ project_number: job.project_number, error: e instanceof Error ? e.message : String(e) });
    }
  }

  return NextResponse.json({ scanned, alreadySet, backfilled, errors });
});
