import { NextRequest, NextResponse } from "next/server";
// Same direct-implementation import as documents/route.ts — the package
// root's debug-only block breaks the production build (see that file's
// own comment).
import pdfParse from "pdf-parse/lib/pdf-parse.js";
import { requireAdminApi } from "@/lib/admin-api";
import { getSupabaseAdmin } from "@/lib/supabase";
import { withApiErrors } from "@/lib/api-handler";
import { extractInvoiceNumber } from "@/lib/parse-lab-invoice";
import type { Job } from "@/lib/types";

// Per Tim, 2026-08-28 — a one-time retroactive sweep, not a route anything
// else calls. lab_invoice_number (see its own comment on JobDocument) only
// ever gets set on a NEW lab_invoice document going forward (see
// processMatchedLabInvoiceEmail/processMultiJobLabInvoiceEmail in
// lib/lab-email.ts) — it can't retroactively catch a document already
// sitting in the database from before that field existed. This re-downloads
// and re-parses every existing lab_invoice document still missing it, so
// LabInvoicesView's title (Crystal's own "Invoice no." — matching what Tim
// sees on their real invoice/email) shows up for older documents too. GET
// (not POST) — nothing here is destructive (no deletes, no file changes,
// only a number), same reasoning as backfill-lab-invoice-hashes.
export const GET = withApiErrors(async (req: NextRequest) => {
  const unauthorized = requireAdminApi(req);
  if (unauthorized) return unauthorized;

  const supabase = getSupabaseAdmin();
  const { data: jobs, error } = await supabase
    .from("jobs")
    .select("id, project_number, documents");
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Same physical file can be downloaded once and reused for every document
  // row that shares its storage_path (the per-service-type-label duplicates
  // on one job all point at the same file) instead of re-downloading and
  // re-parsing it once per row.
  const numberByStoragePath = new Map<string, string | null>();
  let scanned = 0;
  let alreadySet = 0;
  const errors: { project_number: string | null; file_name: string; error: string }[] = [];

  for (const job of (jobs ?? []) as unknown as Pick<Job, "id" | "project_number" | "documents">[]) {
    const invoiceDocs = (job.documents ?? []).filter((d) => d.kind === "lab_invoice");
    if (invoiceDocs.length === 0) continue;

    let documentsChanged = false;
    const updatedDocuments = [...(job.documents ?? [])];

    for (const doc of invoiceDocs) {
      scanned++;
      if (doc.lab_invoice_number) {
        alreadySet++;
        continue;
      }
      try {
        let number = numberByStoragePath.get(doc.storage_path);
        if (number === undefined) {
          const { data: blob, error: downloadError } = await supabase.storage
            .from("job-documents")
            .download(doc.storage_path);
          if (downloadError || !blob) throw new Error(downloadError?.message ?? "download failed");
          const buffer = Buffer.from(await blob.arrayBuffer());
          const { text } = await pdfParse(buffer);
          number = extractInvoiceNumber(text);
          numberByStoragePath.set(doc.storage_path, number);
        }
        if (number) {
          const idx = updatedDocuments.findIndex((d) => d.id === doc.id);
          if (idx !== -1) {
            updatedDocuments[idx] = { ...updatedDocuments[idx], lab_invoice_number: number };
            documentsChanged = true;
          }
        }
      } catch (e) {
        errors.push({ project_number: job.project_number, file_name: doc.file_name, error: e instanceof Error ? e.message : String(e) });
      }
    }

    if (documentsChanged) {
      await supabase.from("jobs").update({ documents: updatedDocuments }).eq("id", job.id);
    }
  }

  return NextResponse.json({ scanned, alreadySet, newlySet: scanned - alreadySet - errors.length, errors });
});
