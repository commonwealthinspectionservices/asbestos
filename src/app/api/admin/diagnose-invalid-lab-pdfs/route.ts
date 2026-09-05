import { NextRequest, NextResponse } from "next/server";
import pdfParse from "pdf-parse/lib/pdf-parse.js";
import { requireAdminApi } from "@/lib/admin-api";
import { getSupabaseAdmin } from "@/lib/supabase";
import { withApiErrors } from "@/lib/api-handler";
import type { Job } from "@/lib/types";

// One-off diagnostic, 2026-09-05 — read-only, no writes. audit-lab-invoices
// hit "Invalid PDF structure" on 2 real stored documents (26-0014's
// weekly-lab-summary-6617.pdf, 26-0015's weekly-lab-summary-6602.pdf) and
// doesn't report enough to know why — this downloads the same bytes it did
// and reports byte length, whether the file actually starts with the PDF
// magic bytes, and the raw pdf-parse error, so the real cause (truncated
// upload vs. corrupted bytes vs. not actually a PDF) can be told apart
// before deciding how to fix it.
export const GET = withApiErrors(async (req: NextRequest) => {
  const unauthorized = requireAdminApi(req);
  if (unauthorized) return unauthorized;

  const supabase = getSupabaseAdmin();
  const { data: jobs, error } = await supabase.from("jobs").select("id, project_number, documents");
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const results: Record<string, unknown>[] = [];

  for (const job of (jobs ?? []) as unknown as Pick<Job, "id" | "project_number" | "documents">[]) {
    const invoiceDocs = (job.documents ?? []).filter((d) => d.kind === "lab_invoice");
    for (const doc of invoiceDocs) {
      const { data: blob, error: downloadError } = await supabase.storage
        .from("job-documents")
        .download(doc.storage_path);
      if (downloadError || !blob) {
        results.push({
          project_number: job.project_number,
          file_name: doc.file_name,
          storage_path: doc.storage_path,
          downloadError: downloadError?.message ?? "no blob",
        });
        continue;
      }
      const buffer = Buffer.from(await blob.arrayBuffer());
      const magic = buffer.subarray(0, 8).toString("latin1");
      let parseError: string | null = null;
      try {
        await pdfParse(buffer);
      } catch (e) {
        parseError = e instanceof Error ? e.message : String(e);
      }
      if (parseError) {
        results.push({
          project_number: job.project_number,
          file_name: doc.file_name,
          storage_path: doc.storage_path,
          byteLength: buffer.length,
          magicBytes: magic,
          looksLikePdf: magic.startsWith("%PDF-"),
          last16Bytes: buffer.subarray(Math.max(0, buffer.length - 16)).toString("latin1"),
          parseError,
        });
      }
    }
  }

  return NextResponse.json({ results });
});
