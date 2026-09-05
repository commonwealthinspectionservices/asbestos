import { NextRequest, NextResponse } from "next/server";
// Same direct-implementation import as documents/route.ts — the package
// root's debug-only block breaks the production build (see that file's
// own comment).
import pdfParse from "pdf-parse/lib/pdf-parse.js";
import { requireAdminApi } from "@/lib/admin-api";
import { getSupabaseAdmin } from "@/lib/supabase";
import { withApiErrors } from "@/lib/api-handler";
import { isLabInvoiceText } from "@/lib/parse-lab-invoice";
import type { Job } from "@/lib/types";

// pdf-parse (via pdfjs) occasionally throws "Invalid PDF structure" on a
// perfectly well-formed PDF when called dozens of times in a row within
// one function invocation — confirmed 2026-09-05 by re-parsing the exact
// same bytes moments apart and getting success, and by seeing a different
// document "fail" on each run against files with valid %PDF-.../%%EOF
// bytes. The real email pipeline parses one PDF per invocation and never
// hits this; only this batch sweep does. A couple of retries clears it.
async function parsePdfTextWithRetry(buffer: Buffer, attempts = 3): Promise<string> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const { text } = await pdfParse(buffer);
      return text;
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError;
}

// Per Tim, 2026-08-28 — a one-time retroactive sweep, not a route anything
// else calls. The new invoice_mismatch check (see documents/route.ts and
// lib/lab-email.ts) only ever runs on a NEW upload going forward; it can't
// retroactively catch a document that was already sitting in the database
// from before that check existed — exactly the "asbestos report filed
// under Lab Invoice" bug Tim kept finding by hand. This re-checks every
// existing lab_invoice document the same way and persists the flag where
// it's actually wrong, so the same red warning banner shows up on the job
// itself without Tim having to click into every single one to notice.
// GET (not POST) — nothing here is destructive (no deletes, no file
// changes, only a flag), and a plain URL Tim can hit directly from his own
// logged-in browser is the simplest way to trigger a one-off admin sweep
// like this without adding UI for something that's not a recurring action.
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

  const flagged: { project_number: string | null; file_name: string; storage_path: string }[] = [];
  const errors: { project_number: string | null; file_name: string; error: string }[] = [];
  let scanned = 0;
  let alreadyFlagged = 0;

  for (const job of (jobs ?? []) as unknown as Pick<Job, "id" | "project_number" | "documents">[]) {
    const invoiceDocs = (job.documents ?? []).filter((d) => d.kind === "lab_invoice");
    if (invoiceDocs.length === 0) continue;

    let documentsChanged = false;
    const updatedDocuments = [...(job.documents ?? [])];

    for (const doc of invoiceDocs) {
      scanned++;
      if (doc.invoice_mismatch) {
        alreadyFlagged++;
        continue;
      }
      try {
        const { data: blob, error: downloadError } = await supabase.storage
          .from("job-documents")
          .download(doc.storage_path);
        if (downloadError || !blob) throw new Error(downloadError?.message ?? "download failed");
        const buffer = Buffer.from(await blob.arrayBuffer());
        const text = await parsePdfTextWithRetry(buffer);
        if (!isLabInvoiceText(text)) {
          flagged.push({ project_number: job.project_number, file_name: doc.file_name, storage_path: doc.storage_path });
          const idx = updatedDocuments.findIndex((d) => d.id === doc.id);
          if (idx !== -1) {
            updatedDocuments[idx] = { ...updatedDocuments[idx], invoice_mismatch: true };
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

  return NextResponse.json({ scanned, alreadyFlagged, newlyFlagged: flagged.length, flagged, errors });
});
