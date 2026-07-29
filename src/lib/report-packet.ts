import { getSupabaseAdmin } from "@/lib/supabase";
import { renderProjectReportPdf } from "@/lib/report-pdf";
import { mergePdfBuffers } from "@/lib/pdf-merge";
import type { Customer, Job, Settings } from "@/lib/types";

// The real deliverable is a packet, not just the cover letter: the letter,
// then whatever lab_report/coc documents are attached to the job (uploaded
// once the lab sends its own certified results and scanned COC back), then
// the standing credentials document — merged into one PDF, matching the
// real FLI report exactly (letter + lab's own report + COC + license
// pages). Shared by the "Download Final Report" route and the report email
// draft, so both ever only build this one way.
export async function buildFinalReportPacket(job: Job, customer: Customer, settings: Settings): Promise<Buffer> {
  const supabase = getSupabaseAdmin();
  const letterPdf = await renderProjectReportPdf({ job, customer, settings });

  const documents = job.documents ?? [];
  const attachmentPaths = [
    ...documents.filter((d) => d.kind === "lab_report").map((d) => d.storage_path),
    ...documents.filter((d) => d.kind === "coc").map((d) => d.storage_path),
    ...(settings.credentials_document_path ? [settings.credentials_document_path] : []),
  ];

  const attachmentBuffers: Buffer[] = [];
  for (const storagePath of attachmentPaths) {
    const { data: blob, error: downloadError } = await supabase.storage.from("job-documents").download(storagePath);
    if (downloadError || !blob) {
      console.error(`Skipping missing report attachment ${storagePath}:`, downloadError);
      continue;
    }
    attachmentBuffers.push(Buffer.from(await blob.arrayBuffer()));
  }

  return mergePdfBuffers([letterPdf, ...attachmentBuffers]);
}
