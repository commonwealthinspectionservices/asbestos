import { createHash } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-api";
import { getSupabaseAdmin } from "@/lib/supabase";
import { withApiErrors } from "@/lib/api-handler";
import type { Job } from "@/lib/types";

// Per Tim, 2026-08-28 — a one-time retroactive sweep, not a route anything
// else calls. content_hash (see its own comment on JobDocument) only ever
// gets set on a NEW lab_invoice document going forward (see
// processMatchedLabInvoiceEmail/processMultiJobLabInvoiceEmail in
// lib/lab-email.ts) — it can't retroactively catch a document that was
// already sitting in the database from before that field existed, which is
// exactly what made "a list of every single pdf invoice" show the same
// real invoice email several times over (once per job it covers, once per
// service-type label on top of that). This re-downloads and hashes every
// existing lab_invoice document that's still missing it, so
// LabInvoicesView's grouping picks up the older ones too. GET (not POST) —
// nothing here is destructive (no deletes, no file changes, only a hash),
// same reasoning as audit-lab-invoices.
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

  // Same physical file can be downloaded once and reused for every
  // document row that shares its storage_path (the per-service-type-label
  // duplicates on one job all point at the same file) instead of
  // re-downloading it once per row.
  const hashByStoragePath = new Map<string, string>();
  let scanned = 0;
  let alreadyHashed = 0;
  const errors: { project_number: string | null; file_name: string; error: string }[] = [];

  for (const job of (jobs ?? []) as unknown as Pick<Job, "id" | "project_number" | "documents">[]) {
    const invoiceDocs = (job.documents ?? []).filter((d) => d.kind === "lab_invoice");
    if (invoiceDocs.length === 0) continue;

    let documentsChanged = false;
    const updatedDocuments = [...(job.documents ?? [])];

    for (const doc of invoiceDocs) {
      scanned++;
      if (doc.content_hash) {
        alreadyHashed++;
        continue;
      }
      try {
        let hash = hashByStoragePath.get(doc.storage_path);
        if (!hash) {
          const { data: blob, error: downloadError } = await supabase.storage
            .from("job-documents")
            .download(doc.storage_path);
          if (downloadError || !blob) throw new Error(downloadError?.message ?? "download failed");
          const buffer = Buffer.from(await blob.arrayBuffer());
          hash = createHash("sha256").update(buffer).digest("hex");
          hashByStoragePath.set(doc.storage_path, hash);
        }
        const idx = updatedDocuments.findIndex((d) => d.id === doc.id);
        if (idx !== -1) {
          updatedDocuments[idx] = { ...updatedDocuments[idx], content_hash: hash };
          documentsChanged = true;
        }
      } catch (e) {
        errors.push({ project_number: job.project_number, file_name: doc.file_name, error: e instanceof Error ? e.message : String(e) });
      }
    }

    if (documentsChanged) {
      await supabase.from("jobs").update({ documents: updatedDocuments }).eq("id", job.id);
    }
  }

  return NextResponse.json({ scanned, alreadyHashed, newlyHashed: scanned - alreadyHashed - errors.length, errors });
});
