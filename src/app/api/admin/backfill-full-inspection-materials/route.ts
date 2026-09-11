import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-api";
import { withApiErrors } from "@/lib/api-handler";
import { getSupabaseAdmin } from "@/lib/supabase";
import { deriveFullInspectionMaterials } from "@/lib/sample-items";
import { isFullInspectionAsbestosJob } from "@/lib/report-findings";

// One-off, 2026-09-11 (26-0026) — not a route anything else calls. Delete
// after use.
//
// Catches up every existing Full Inspection asbestos job whose lab report
// was already parsed before deriveFullInspectionMaterials existed — their
// Materials Sampled table only has whatever was hand-typed in (often just
// the ACM row), so "Total Materials Sampled" undercounts. Safe to run more
// than once: the underlying function only fills in field codes no existing
// row already covers, never touches a row that's there.
export const maxDuration = 60;

export const GET = withApiErrors(async (req: NextRequest) => {
  const unauthorized = requireAdminApi(req);
  if (unauthorized) return unauthorized;

  const supabase = getSupabaseAdmin();
  const { data: jobs } = await supabase
    .from("jobs")
    .select("id, project_number, service_type, sample_results, full_inspection_materials")
    .not("sample_results", "is", null);

  const updated: { project_number: string | null; addedCount: number }[] = [];
  for (const job of jobs ?? []) {
    if (!isFullInspectionAsbestosJob(job.service_type)) continue;
    const sampleResults = (job.sample_results ?? []) as { fieldCode: string; result: string; material?: string }[];
    if (sampleResults.length === 0) continue;
    const existing = job.full_inspection_materials ?? [];
    const derived = deriveFullInspectionMaterials(sampleResults, existing);
    if (derived.length === existing.length) continue;
    await supabase.from("jobs").update({ full_inspection_materials: derived }).eq("id", job.id);
    updated.push({ project_number: job.project_number, addedCount: derived.length - existing.length });
  }

  return NextResponse.json({ updated });
});
