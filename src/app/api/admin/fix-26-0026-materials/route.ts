import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-api";
import { withApiErrors } from "@/lib/api-handler";
import { getSupabaseAdmin } from "@/lib/supabase";

// One-off, 2026-09-11 — not a route anything else calls. Delete after use.
//
// The material-extraction fix (parse-lab-report.ts) only applies going
// forward — 26-0026's own sample_results/sample_findings were already
// stored with the "Material not available" gap for 15A/15B before that
// fix shipped. Sets the real, already-confirmed text directly (verified
// against the real report PDF and covered by a new test using this exact
// text) rather than requiring a full re-parse for two known field codes.
const JOB_ID = "15e82a34-0afc-4693-988e-fe056fffca0e";
const FIXED_MATERIAL = "Red vinyl floor tile (layer 2), Basement, back right room";
const FIELD_CODES = new Set(["15A", "15B"]);

export const GET = withApiErrors(async (req: NextRequest) => {
  const unauthorized = requireAdminApi(req);
  if (unauthorized) return unauthorized;

  const supabase = getSupabaseAdmin();
  const { data: job } = await supabase.from("jobs").select("sample_results, sample_findings").eq("id", JOB_ID).maybeSingle();
  if (!job) return NextResponse.json({ error: "job not found" }, { status: 404 });

  const sample_results = (job.sample_results ?? []).map((s: { fieldCode: string; result: string; material?: string }) =>
    FIELD_CODES.has(s.fieldCode) ? { ...s, material: FIXED_MATERIAL } : s
  );
  const sample_findings = (job.sample_findings ?? []).map((f: { fieldCode: string; material: string; estimated_quantity: string; unit: string }) =>
    FIELD_CODES.has(f.fieldCode) ? { ...f, material: FIXED_MATERIAL } : f
  );

  await supabase.from("jobs").update({ sample_results, sample_findings }).eq("id", JOB_ID);
  return NextResponse.json({ updated: [...FIELD_CODES] });
});
