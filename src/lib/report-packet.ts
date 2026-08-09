import { getSupabaseAdmin } from "@/lib/supabase";
import { renderProjectReportPdfForDomain } from "@/lib/report-pdf";
import { mergePdfBuffers } from "@/lib/pdf-merge";
import { jobReportDomains, domainForServiceTypeLabel, type ReportDomain } from "@/lib/report-findings";
import type { Customer, Job, Settings } from "@/lib/types";

// The real deliverable is a packet, not just the cover letter: the letter,
// then whatever lab_report/coc documents belong to this domain (uploaded
// once the lab sends its own certified results and scanned COC back), then
// the standing credentials document — merged into one PDF, matching the
// real FLI report exactly (letter + lab's own report + COC + license
// pages). One packet per domain — a job combining service types from more
// than one domain (e.g. asbestos + mold) produces two separate final
// reports, so a mold lab report must never end up glued behind the
// asbestos letter or vice versa. Shared by the "Download Final Report"
// route and the report email draft, so both ever only build this one way.
export async function buildFinalReportPacket(job: Job, customer: Customer, settings: Settings, domain: ReportDomain): Promise<Buffer> {
  const supabase = getSupabaseAdmin();
  const letterPdf = await renderProjectReportPdfForDomain({ job, customer, settings }, domain);

  const documents = (job.documents ?? []).filter((d) => domainForServiceTypeLabel(d.service_type) === domain);
  const attachmentPaths = [
    ...documents.filter((d) => d.kind === "lab_report").map((d) => d.storage_path),
    ...documents.filter((d) => d.kind === "coc").map((d) => d.storage_path),
    // The owner's own credentials belong on every domain's report, not just
    // one — everyone gets the same license page.
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

// One packet per domain actually present on the job — for the email
// draft's multiple report attachments (see lab-email.ts).
export async function buildAllFinalReportPackets(
  job: Job, customer: Customer, settings: Settings
): Promise<{ domain: ReportDomain; buffer: Buffer }[]> {
  const domains = jobReportDomains(job.service_type);
  return Promise.all(domains.map(async (domain) => ({ domain, buffer: await buildFinalReportPacket(job, customer, settings, domain) })));
}
