import { getSupabaseAdmin } from "@/lib/supabase";
import { renderProjectReportPdfForDomain } from "@/lib/report-pdf";
import { mergePdfBuffers } from "@/lib/pdf-merge";
import { jobReportDomains, domainForServiceTypeLabel, type ReportDomain } from "@/lib/report-findings";
import type { Customer, Job, Settings } from "@/lib/types";

// The real deliverable is a packet, not just the cover letter: the letter,
// then whatever lab_report/coc documents belong to this domain (uploaded
// once the lab sends its own certified results and scanned COC back), and
// — asbestos only — the owner's own standing credentials/license pages.
// Confirmed live wrong on 26-0002: those license pages were getting
// appended to the mold report too. Per Tim, his asbestos and consulting
// licenses belong only on asbestos reports, never mold or lead. One
// packet per domain — a job combining service types from more than one
// domain (e.g. asbestos + mold) produces two separate final reports, so a
// mold lab report must never end up glued behind the asbestos letter or
// vice versa. Shared by the "Download Final Report" route and the report
// email draft, so both ever only build this one way.
export async function buildFinalReportPacket(job: Job, customer: Customer, settings: Settings, domain: ReportDomain): Promise<Buffer> {
  const supabase = getSupabaseAdmin();
  const letterPdf = await renderProjectReportPdfForDomain({ job, customer, settings }, domain);

  const documents = (job.documents ?? []).filter((d) => domainForServiceTypeLabel(d.service_type) === domain);
  // Deduped by storage_path (first occurrence wins order) — a combined
  // air+bulk (or air+bulk+swab) mold report is deliberately filed as one
  // lab_report row per label it covers, all three pointing at the same
  // uploaded PDF (see lab-email.ts's reportLabels/replaceDocumentsByKindAndServiceType),
  // so each label's own Laboratory Paperwork tab shows it. Without
  // dedup here that same physical PDF got appended once per label instead
  // of once per unique file — confirmed live 2026-08-27 on 26-0008: its
  // combined air+bulk report is filed under both "Mold Air Sampling" and
  // "Mold Bulk Sampling", so the final packet showed every mold result
  // twice, back to back.
  const attachmentPaths = [
    ...new Set([
      ...documents.filter((d) => d.kind === "lab_report").map((d) => d.storage_path),
      ...documents.filter((d) => d.kind === "coc").map((d) => d.storage_path),
    ]),
    ...(domain === "asbestos" && settings.credentials_document_path ? [settings.credentials_document_path] : []),
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

// One packet per domain actually present on the job — for the email
// draft's multiple report attachments (see lab-email.ts).
export async function buildAllFinalReportPackets(
  job: Job, customer: Customer, settings: Settings
): Promise<{ domain: ReportDomain; buffer: Buffer }[]> {
  const domains = jobReportDomains(job.service_type);
  return Promise.all(domains.map(async (domain) => ({ domain, buffer: await buildFinalReportPacket(job, customer, settings, domain) })));
}
