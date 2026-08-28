import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-api";
import { getSupabaseAdmin } from "@/lib/supabase";
import { withApiErrors } from "@/lib/api-handler";
import { BOSTON_HARBOR_WATER_RESTORATION_COMPANY_ID } from "@/lib/report-findings";

// Per Tim, 2026-08-28 — "there still should not be any requested date for
// Boston Harbor water restoration jobs. delete on all!" (and requested_time
// too). Boston Harbor never actually requests a specific date/time — they
// just send a request and Tim schedules it himself; the date their email
// named is already recorded in the job's own notes (see
// buildEmailIntakeNote in lib/job-intake.ts), which is untouched here.
// Going forward, job-intake.ts no longer writes requested_date for this
// company at all — this is the one-time retroactive cleanup for jobs
// already sitting in the database from before that fix. GET (not POST) —
// only ever clears these two columns to null, nothing else, and only for
// Boston Harbor's own jobs.
export const GET = withApiErrors(async (req: NextRequest) => {
  const unauthorized = requireAdminApi(req);
  if (unauthorized) return unauthorized;

  const supabase = getSupabaseAdmin();
  const { data: jobs, error } = await supabase
    .from("jobs")
    .select("id, project_number, requested_date, requested_time, customers!customer_id(company_id)");
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const targets = (jobs ?? []).filter((j) => {
    const customers = j.customers as unknown as { company_id: string | null } | { company_id: string | null }[] | null;
    const companyId = Array.isArray(customers) ? customers[0]?.company_id : customers?.company_id;
    return companyId === BOSTON_HARBOR_WATER_RESTORATION_COMPANY_ID && (j.requested_date || j.requested_time);
  });

  const cleared: string[] = [];
  const errors: { project_number: string | null; error: string }[] = [];
  for (const job of targets) {
    const { error: updateError } = await supabase
      .from("jobs")
      .update({ requested_date: null, requested_time: null })
      .eq("id", job.id);
    if (updateError) {
      errors.push({ project_number: job.project_number, error: updateError.message });
    } else {
      cleared.push(job.project_number ?? job.id);
    }
  }

  return NextResponse.json({ jobsScanned: (jobs ?? []).length, cleared, errors });
});
