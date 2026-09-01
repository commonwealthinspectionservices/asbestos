import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-api";
import { getSupabaseAdmin } from "@/lib/supabase";
import { withApiErrors } from "@/lib/api-handler";
import { extractCrystalAnalyticalMaterialDescriptions } from "@/lib/parse-lab-report";
import { extractPositionOrderedText } from "@/lib/pdf-position-text";
import type { Job } from "@/lib/types";

// Per Tim, 2026-09-02 — a one-time retroactive sweep, not a route anything
// else calls. The per-sample `material` field on sample_results (and the
// matching backfill of sample_findings' own material for positive samples)
// only ever gets set on a NEW lab report parse going forward — it can't
// retroactively catch a job whose lab report was already parsed before
// that field existed. This re-downloads and re-parses every Crystal
// Analytical asbestos lab report still missing material on at least one of
// its samples, same Crystal-Analytical-only restriction as the live parse
// (see extractCrystalAnalyticalMaterialDescriptions's own comment). GET
// (not POST), and idempotent — never overwrites a material that's already
// there, only fills in blanks — so it's safe to re-run.
export const GET = withApiErrors(async (req: NextRequest) => {
  const unauthorized = requireAdminApi(req);
  if (unauthorized) return unauthorized;

  const supabase = getSupabaseAdmin();
  const { data: jobs, error } = await supabase
    .from("jobs")
    .select("id, project_number, lab_name, sample_results, sample_findings, documents")
    .not("sample_results", "is", null);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  type Row = Pick<Job, "id" | "project_number" | "lab_name" | "sample_results" | "sample_findings" | "documents">;

  let scanned = 0;
  let skippedNotCrystalAnalytical = 0;
  let alreadyComplete = 0;
  let newlyFilled = 0;
  let noMaterialsFound = 0;
  const errors: { project_number: string | null; error: string }[] = [];

  for (const job of (jobs ?? []) as unknown as Row[]) {
    const sampleResults = job.sample_results ?? [];
    if (sampleResults.length === 0) continue;
    scanned++;

    const labName = (job.lab_name ?? "").toLowerCase();
    if (!labName.includes("crystal analytical")) {
      skippedNotCrystalAnalytical++;
      continue;
    }

    if (sampleResults.every((s) => s.material)) {
      alreadyComplete++;
      continue;
    }

    const labReportDocs = (job.documents ?? []).filter((d) => d.kind === "lab_report");
    if (labReportDocs.length === 0) continue;

    try {
      const materials: Record<string, string> = {};
      for (const doc of labReportDocs) {
        const { data: blob, error: downloadError } = await supabase.storage
          .from("job-documents")
          .download(doc.storage_path);
        if (downloadError || !blob) throw new Error(downloadError?.message ?? "download failed");
        const buffer = Buffer.from(await blob.arrayBuffer());
        const positionOrderedText = await extractPositionOrderedText(buffer);
        Object.assign(materials, extractCrystalAnalyticalMaterialDescriptions(positionOrderedText));
      }

      if (Object.keys(materials).length === 0) {
        noMaterialsFound++;
        continue;
      }

      const updatedResults = sampleResults.map((s) => (!s.material && materials[s.fieldCode] ? { ...s, material: materials[s.fieldCode] } : s));
      const updatedFindings = (job.sample_findings ?? []).map((f) =>
        !f.material && materials[f.fieldCode] ? { ...f, material: materials[f.fieldCode] } : f
      );

      const resultsChanged = updatedResults.some((s, i) => s.material !== sampleResults[i].material);
      const findingsChanged = updatedFindings.some((f, i) => f.material !== (job.sample_findings ?? [])[i].material);
      if (!resultsChanged && !findingsChanged) {
        alreadyComplete++;
        continue;
      }

      const update: Record<string, unknown> = {};
      if (resultsChanged) update.sample_results = updatedResults;
      if (findingsChanged) update.sample_findings = updatedFindings;
      await supabase.from("jobs").update(update).eq("id", job.id);
      newlyFilled++;
    } catch (e) {
      errors.push({ project_number: job.project_number, error: e instanceof Error ? e.message : String(e) });
    }
  }

  return NextResponse.json({ scanned, skippedNotCrystalAnalytical, alreadyComplete, newlyFilled, noMaterialsFound, errors });
});
