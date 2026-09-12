import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-api";
import { withApiErrors } from "@/lib/api-handler";
import { getSupabaseAdmin } from "@/lib/supabase";
import { getValidAccessToken, getMessage, findPdfParts, getAttachmentData } from "@/lib/gmail";
import { splitTrailingCocPages } from "@/lib/split-lab-report-coc";
import pdfParse from "pdf-parse/lib/pdf-parse.js";
import type { JobDocument } from "@/lib/types";

// One-off, 2026-09-12 (26-0019) — not a route anything else calls. Delete
// after use.
//
// Recovers the original asbestos lab report: today's lead-report upload
// overwrote the Storage file that used to sit in this job's asbestos
// lab_report slot (see fix-26-0019-lead-docs), but the underlying email
// (found via search-26-0019-asbestos-email — "Final PLM Report for
// 2601003900 - 91 Belcher Ave., Brockton, MA", Crystal Analytical,
// 2026-09-10) is still sitting in Gmail with its real attachment.
//
// Without ?confirm=1: downloads the attachment and returns its page-1
// text so the content can be manually verified before filing anything —
// same page-1 text already confirmed the lead-report mixup earlier today.
// With ?confirm=1: uploads it (splitting off any trailing CoC pages, same
// as the normal automated pipeline) as this job's asbestos lab_report +
// coc, leaving sample_results/asbestos_result untouched (already correct).
const JOB_ID = "02d16558-77c4-4efa-8f6a-df97bf2612b7";
const MESSAGE_ID = "1a08b8ccf707a25d";
const SERVICE_TYPE = "Limited Asbestos Inspection";

export const GET = withApiErrors(async (req: NextRequest) => {
  const unauthorized = requireAdminApi(req);
  if (unauthorized) return unauthorized;

  const accessToken = await getValidAccessToken();
  if (!accessToken) return NextResponse.json({ error: "Gmail not connected" }, { status: 400 });

  const message = await getMessage(accessToken, MESSAGE_ID);
  const pdfParts = findPdfParts(message.payload);
  if (pdfParts.length === 0) return NextResponse.json({ error: "No PDF attachment found on this message" }, { status: 404 });

  const pdfBuffer = await getAttachmentData(accessToken, MESSAGE_ID, pdfParts[0].attachmentId);

  const confirm = req.nextUrl.searchParams.get("confirm") === "1";
  if (!confirm) {
    const { text } = await pdfParse(pdfBuffer);
    return NextResponse.json({ preview: true, filename: pdfParts[0].filename, page1Text: text.slice(0, 1500) });
  }

  const { reportBuffer, cocBuffer } = await splitTrailingCocPages(pdfBuffer);

  const supabase = getSupabaseAdmin();
  const { data: job } = await supabase.from("jobs").select("documents").eq("id", JOB_ID).maybeSingle();
  if (!job) return NextResponse.json({ error: "job not found" }, { status: 404 });

  const newDocs: JobDocument[] = [];

  const reportDocId = randomUUID();
  const reportStoragePath = `${JOB_ID}/${reportDocId}-lab-report.pdf`;
  await supabase.storage.from("job-documents").upload(reportStoragePath, reportBuffer, { contentType: "application/pdf" });
  newDocs.push({
    id: reportDocId,
    kind: "lab_report",
    service_type: SERVICE_TYPE,
    file_name: "lab-report.pdf",
    storage_path: reportStoragePath,
    uploaded_at: new Date().toISOString(),
    project_number_mismatch: null,
    domain_mismatch: null,
  });

  if (cocBuffer) {
    const cocDocId = randomUUID();
    const cocStoragePath = `${JOB_ID}/${cocDocId}-coc.pdf`;
    await supabase.storage.from("job-documents").upload(cocStoragePath, cocBuffer, { contentType: "application/pdf" });
    newDocs.push({
      id: cocDocId,
      kind: "coc",
      service_type: SERVICE_TYPE,
      file_name: "coc.pdf",
      storage_path: cocStoragePath,
      uploaded_at: new Date().toISOString(),
      project_number_mismatch: null,
    });
  }

  const documents: JobDocument[] = [...(job.documents ?? []), ...newDocs];
  await supabase.from("jobs").update({ documents }).eq("id", JOB_ID);

  return NextResponse.json({ filed: newDocs });
});
