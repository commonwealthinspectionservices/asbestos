import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
// Imports the implementation directly rather than the package root — the
// root index.js has a debug-only block that (when bundled by webpack/Next)
// unconditionally tries to read a test fixture PDF that only exists inside
// pdf-parse's own node_modules folder, breaking the production build.
import pdfParse from "pdf-parse/lib/pdf-parse.js";
import { requireAdminApi } from "@/lib/admin-api";
import { getSupabaseAdmin } from "@/lib/supabase";
import { withApiErrors } from "@/lib/api-handler";
import { extractSampleCount, detectAsbestosResult, extractSampleResults, extractReportProjectNumber, detectLabInfo, extractMoldSampleCount, extractMoldSampleResults } from "@/lib/parse-lab-report";
import { splitTrailingCocPages } from "@/lib/split-lab-report-coc";
import type { Job, JobDocument } from "@/lib/types";

const DOCUMENT_KINDS = new Set(["coc", "lab_report", "lab_invoice", "report", "other"]);

// Scanned chain-of-custody forms and lab report PDFs get kept on file
// forever alongside the job — the actual sample-level record of what was
// taken, since the app itself only tracks a sample count.
export const POST = withApiErrors(async (
  req: NextRequest,
  { params }: { params: { id: string } }
) => {
  const unauthorized = requireAdminApi(req);
  if (unauthorized) return unauthorized;

  const formData = await req.formData().catch(() => null);
  const file = formData?.get("file");
  const kind = formData?.get("kind");
  const serviceType = formData?.get("serviceType");

  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "A file is required" }, { status: 400 });
  }
  if (typeof kind !== "string" || !DOCUMENT_KINDS.has(kind)) {
    return NextResponse.json({ error: `kind must be one of: ${[...DOCUMENT_KINDS].join(", ")}` }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  const { data: job, error: jobError } = await supabase
    .from("jobs")
    .select("*")
    .eq("id", params.id)
    .single();

  if (jobError || !job) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }
  const jobRow = job as unknown as Job;

  const docId = randomUUID();
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const storagePath = `${params.id}/${docId}-${safeName}`;
  const fileBuffer = Buffer.from(await file.arrayBuffer());

  const update: Record<string, unknown> = {};
  let projectNumberMismatch: string | null = null;

  // Lab results PDFs list one row (asbestos) or one column (mold's
  // Air-O-Cell/Swab genus tables) per physical sample — pull the count
  // straight from the report instead of making the admin count and re-type
  // it by hand. Best effort: any parsing failure just leaves the count for
  // manual entry.
  if (kind === "lab_report" && typeof serviceType === "string" && serviceType && file.type === "application/pdf") {
    try {
      const { text } = await pdfParse(fileBuffer);
      const isMold = /mold/i.test(serviceType);

      const count = isMold ? extractMoldSampleCount(text) : extractSampleCount(text);
      if (count != null) {
        update.sample_counts = { ...(jobRow.sample_counts ?? {}), [serviceType]: count };
      }

      // The lab's own identity/certs are constant per lab — no need to make
      // the admin type them in by hand once the report format is recognized.
      // Written to mold's own separate field for a mold upload, never the
      // shared asbestos/lead one — a job combining domains can use two
      // different labs, and until this split a mold upload would silently
      // overwrite the asbestos lab's own name/certs (or vice versa).
      const labInfo = detectLabInfo(text);
      if (labInfo) {
        if (isMold) {
          update.mold_lab_name = labInfo.labName;
        } else {
          update.lab_name = labInfo.labName;
          update.lab_nist_cert = labInfo.nistCert;
          update.lab_massdls_cert = labInfo.massdlsCert;
        }
      }

      if (isMold) {
        // No asbestos-style pass/fail for mold — genus-level findings live
        // only in the uploaded report itself. Just confirms which samples
        // were actually received and analyzed (see extractMoldSampleResults).
        // Mold's own field, separate from asbestos/lead's sample_results
        // below, so the two domains' per-sample lists never clobber
        // each other on a mixed job.
        const sampleResults = extractMoldSampleResults(text);
        if (sampleResults.length > 0) {
          update.mold_sample_results = sampleResults;
        }
      }

      // Positive/negative for the final report — asbestos jobs only, for
      // now (lead isn't in scope yet). Only EMSL's format is recognized;
      // other labs just leave this for the admin to set by hand on the
      // Final Report tab.
      if (/asbestos/i.test(serviceType)) {
        const result = detectAsbestosResult(text);
        if (result != null) {
          update.asbestos_result = result;
        }
        const sampleResults = extractSampleResults(text);
        if (sampleResults.length > 0) {
          update.sample_results = sampleResults;
        }
      }

      // EMSL always echoes the client's own project number back on the
      // report — catches uploading the right kind of file to the wrong
      // job by mistake. Only flags when the report clearly names a
      // *different* number; says nothing when it can't find one at all.
      // A flag only — the rest of the extraction above still runs and
      // saves normally either way.
      const reportProjectNumber = extractReportProjectNumber(text);
      if (
        reportProjectNumber &&
        jobRow.project_number &&
        reportProjectNumber.toLowerCase() !== jobRow.project_number.toLowerCase()
      ) {
        projectNumberMismatch = reportProjectNumber;
      }
    } catch {
      // Not a recognized report format, or an unreadable PDF — leave
      // sample_counts and asbestos_result untouched for the admin to fill
      // in by hand.
    }
  }

  // Crystal Analytical (and similarly-shaped labs) send back one PDF with
  // the typed lab data pages followed by the scanned, handwritten chain-of-
  // custody form as the trailing page(s) — never a separate file. Splitting
  // it here means the Laboratory Results station only ever holds the lab's
  // own data pages, and the CoC form gets filed on the Chain of Custody
  // station automatically, same as the inbound-email path already does.
  // Run only after the pdfParse-based extraction above is fully done —
  // splitTrailingCocPages dynamically imports pdf-lib, which corrupts
  // pdf-parse's bundled legacy pdf.js state for any pdfParse call after it
  // (see split-lab-report-coc.ts's own comment on this).
  const split =
    kind === "lab_report" && file.type === "application/pdf"
      ? await splitTrailingCocPages(fileBuffer).catch(() => null)
      : null;
  const reportBuffer = split?.reportBuffer ?? fileBuffer;
  const cocBuffer = split?.cocBuffer ?? null;

  const { error: uploadError } = await supabase.storage
    .from("job-documents")
    .upload(storagePath, reportBuffer, {
      contentType: file.type || "application/octet-stream",
    });
  if (uploadError) {
    throw new Error(`Failed to upload document: ${uploadError.message}`);
  }

  const documents: JobDocument[] = [
    {
      id: docId,
      kind: kind as JobDocument["kind"],
      service_type: typeof serviceType === "string" ? serviceType : "",
      file_name: file.name,
      storage_path: storagePath,
      uploaded_at: new Date().toISOString(),
      project_number_mismatch: projectNumberMismatch,
    },
  ];

  if (cocBuffer) {
    const cocDocId = randomUUID();
    const cocStoragePath = `${params.id}/${cocDocId}-coc.pdf`;
    const { error: cocUploadError } = await supabase.storage
      .from("job-documents")
      .upload(cocStoragePath, cocBuffer, { contentType: "application/pdf" });
    if (!cocUploadError) {
      documents.push({
        id: cocDocId,
        kind: "coc",
        service_type: typeof serviceType === "string" ? serviceType : "",
        file_name: "coc.pdf",
        storage_path: cocStoragePath,
        uploaded_at: new Date().toISOString(),
        project_number_mismatch: null,
      });
    }
  }

  update.documents = [...(jobRow.documents ?? []), ...documents];

  // asbestos_result/sample_results may not exist yet if these migrations
  // haven't been run — tolerate that rather than losing the document
  // upload itself over it.
  const TOLERATED_MISSING_COLUMNS = ["asbestos_result", "sample_results"];
  let updated: Record<string, unknown> | null = null;
  let updateError: { message?: string } | null = null;
  for (let attempt = 0; attempt <= TOLERATED_MISSING_COLUMNS.length; attempt++) {
    ({ data: updated, error: updateError } = await supabase
      .from("jobs")
      .update(update)
      .eq("id", params.id)
      .select("*")
      .single());
    if (!updateError) break;
    const missingColumn = TOLERATED_MISSING_COLUMNS.find(
      (col) => col in update && new RegExp(col, "i").test(updateError?.message ?? "")
    );
    if (!missingColumn) break;
    delete update[missingColumn];
  }

  if (updateError || !updated) {
    return NextResponse.json({ error: updateError?.message }, { status: 500 });
  }
  return NextResponse.json({ job: updated });
});
