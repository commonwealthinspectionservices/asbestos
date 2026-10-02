import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-api";
import { withApiErrors } from "@/lib/api-handler";
import { buildLabResultsLandedEmailHtml } from "@/lib/lab-email";
import { getSupabaseAdmin } from "@/lib/supabase";
import type { Company, Customer, Job } from "@/lib/types";

// Per Tim, 2026-10-01 — "show me what that email will look like": lets a
// job that already has lab results on file preview the exact markup
// sendLabResultsLandedEmail would send, without waiting for a new lab
// email to land or re-triggering a real send. Same pattern as
// preview-paid-email — reuses buildLabResultsLandedEmailHtml so this can
// never drift from the real one. reportLabels isn't stored anywhere (it's
// only ever computed live, per incoming report, inside
// processMatchedLabEmail), so this infers it from the job's own
// service_type domain labels instead — good enough for "what would this
// look like," not meant to reproduce a specific past email exactly.
export const GET = withApiErrors(async (req: NextRequest) => {
  const unauthorized = requireAdminApi(req);
  if (unauthorized) return unauthorized;

  const jobId = req.nextUrl.searchParams.get("jobId");
  if (!jobId) return NextResponse.json({ error: "jobId is required" }, { status: 400 });

  const supabase = getSupabaseAdmin();
  const { data: job } = await supabase
    .from("jobs")
    .select("*, customers!customer_id(*, companies!company_id(*))")
    .eq("id", jobId)
    .maybeSingle();
  if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });

  const typedJob = job as unknown as Job & { customers: Customer & { companies: Company | null } };
  const serviceTypeLabels = (typedJob.service_type ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const requestedDomain = req.nextUrl.searchParams.get("domain");
  const isMold = requestedDomain ? requestedDomain === "mold" : serviceTypeLabels.some((l) => /mold/i.test(l));
  const reportLabels = serviceTypeLabels.filter((l) => (isMold ? /mold/i.test(l) : !/mold/i.test(l)));

  const html = buildLabResultsLandedEmailHtml({ job: typedJob, reportLabels, isMold });
  return NextResponse.json({ html });
});
