import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { requireAdminApi } from "@/lib/admin-api";
import { withApiErrors } from "@/lib/api-handler";

// First half of the two-stage completion workflow: samples are taken
// on-site, but the lab takes 1-2 days to return results, so this just
// records turnaround/date-needed and moves the job to 'pending_lab_results'
// — it does not invoice. The actual sample count comes from the Samples tab
// (sample_items, set via the jobs PATCH route), not from here — it's filled
// in independently, before or after this step. See .../complete/route.ts
// for the second half ("Enter lab results"), which does invoice.
export const POST = withApiErrors(async (
  req: NextRequest,
  { params }: { params: { id: string } }
) => {
  const unauthorized = requireAdminApi(req);
  if (unauthorized) return unauthorized;

  const body = await req.json().catch(() => null);
  const labTurnaround: string | undefined = body?.labTurnaround;
  const labDateNeeded: string | undefined = body?.labDateNeeded;

  const supabase = getSupabaseAdmin();
  const { data: job, error: jobError } = await supabase
    .from("jobs")
    .select("status")
    .eq("id", params.id)
    .single();

  if (jobError || !job) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }
  if (job.status !== "scheduled") {
    return NextResponse.json({ error: `Project is already ${job.status}` }, { status: 400 });
  }

  const { data: updated, error: updateError } = await supabase
    .from("jobs")
    .update({
      lab_turnaround: labTurnaround?.trim() || null,
      lab_date_needed: labDateNeeded?.trim() || null,
      status: "pending_lab_results",
    })
    .eq("id", params.id)
    .select("*")
    .single();

  if (updateError || !updated) {
    throw new Error(`Failed to mark sampled: ${updateError?.message}`);
  }
  return NextResponse.json({ job: updated });
});
