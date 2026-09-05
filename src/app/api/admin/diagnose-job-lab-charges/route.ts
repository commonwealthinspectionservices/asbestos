import { NextRequest, NextResponse } from "next/server";
import pdfParse from "pdf-parse/lib/pdf-parse.js";
import { requireAdminApi } from "@/lib/admin-api";
import { getSupabaseAdmin } from "@/lib/supabase";
import { withApiErrors } from "@/lib/api-handler";
import { extractWeeklyLabSummaryTransactions } from "@/lib/parse-lab-invoice";
import type { Job } from "@/lib/types";

// One-off diagnostic, 2026-09-05 — read-only. Tim asked how to fix
// 26-0008's "more than one separate lab invoice charge" flag (2 distinct
// real invoice numbers, same report_date_range) — this downloads every
// lab_invoice document on the named job and re-extracts each real
// transaction line naming that job, so the actual per-line dates/sample
// descriptions can be compared before deciding whether it's a genuine
// duplicate (like 26-0015) or two legitimate separate submissions.
export const GET = withApiErrors(async (req: NextRequest) => {
  const unauthorized = requireAdminApi(req);
  if (unauthorized) return unauthorized;

  const projectNumber = req.nextUrl.searchParams.get("project_number");
  if (!projectNumber) return NextResponse.json({ error: "project_number query param required" }, { status: 400 });

  const supabase = getSupabaseAdmin();
  const { data: job, error } = await supabase.from("jobs").select("id, project_number, documents").ilike("project_number", projectNumber).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!job) return NextResponse.json({ error: "job not found" }, { status: 404 });

  const typedJob = job as unknown as Pick<Job, "id" | "project_number" | "documents">;
  const labDocs = (typedJob.documents ?? []).filter((d) => d.kind === "lab_invoice" && d.amount_cents != null && d.amount_cents > 0);
  const seenStoragePaths = new Set<string>();
  const results: Record<string, unknown>[] = [];

  for (const doc of labDocs) {
    if (seenStoragePaths.has(doc.storage_path)) continue;
    seenStoragePaths.add(doc.storage_path);
    try {
      const { data: blob, error: downloadError } = await supabase.storage.from("job-documents").download(doc.storage_path);
      if (downloadError || !blob) throw new Error(downloadError?.message ?? "download failed");
      const buffer = Buffer.from(await blob.arrayBuffer());
      const { text } = await pdfParse(buffer);
      const allTransactions = extractWeeklyLabSummaryTransactions(text);
      const jobLines = allTransactions.filter((t) => t.projectNumber?.toUpperCase() === typedJob.project_number?.toUpperCase());
      results.push({ file_name: doc.file_name, lab_invoice_number: doc.lab_invoice_number, storage_path: doc.storage_path, jobLines });
    } catch (e) {
      results.push({ file_name: doc.file_name, lab_invoice_number: doc.lab_invoice_number, error: e instanceof Error ? e.message : String(e) });
    }
  }

  return NextResponse.json({ project_number: typedJob.project_number, results });
});
