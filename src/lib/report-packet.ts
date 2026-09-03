import { getSupabaseAdmin } from "@/lib/supabase";
import { renderProjectReportPdfForDomain } from "@/lib/report-pdf";
import { mergePdfBuffers } from "@/lib/pdf-merge";
import { jobReportDomains, domainForServiceTypeLabel, FLI_ENVIRONMENTAL_COMPANY_ID, type ReportDomain } from "@/lib/report-findings";
import type { Customer, Job, Settings } from "@/lib/types";

// Per Tim, 2026-09-01 — FLI Environmental's own reports carry FLI's own DLS
// Asbestos Consulting Service Provider Certificate on the trailing page,
// never Commonwealth's own (settings.credentials_document_path below) —
// they're a different license holder, so Commonwealth's certificate
// wouldn't even be accurate for their client to see. One fixed path, same
// "single-owner business, one standing file, re-uploading replaces it"
// reasoning as credentials-document/route.ts's own — there's only the one
// FLI Environmental relationship, so no Settings UI for this one.
const FLI_CREDENTIALS_STORAGE_PATH = "_settings/credentials-fli.pdf";
// Per Tim, 2026-09-01 — but his own personal inspector license (he's the
// one who actually did the inspection, regardless of whose consulting
// certificate covers the job) must still lead, ahead of FLI's own
// certificate — split out once from settings.credentials_document_path's
// own first page (that combined PDF's page order is owner's personal
// license, then Commonwealth's own consulting certificate) into this own
// standing file, same "re-uploading replaces it" convention.
const PERSONAL_LICENSE_STORAGE_PATH = "_settings/personal-license.pdf";

// Per Tim, 2026-08-27 — a daily audit isn't fast enough (reports go out
// the moment lab results land, not on a schedule), so this is a hard stop
// instead of a next-day alert: every path that can ever produce a
// customer-facing report — the admin's own download button, the portal
// download a homeowner can hit directly, and both automated draft
// builders — all funnel through buildFinalReportPacket below, so gating
// there closes all four at once instead of needing four separate checks.
export class DomainMismatchError extends Error {
  constructor(public readonly domain: ReportDomain, public readonly flaggedDocIds: string[]) {
    super(`Refusing to build the ${domain} report packet — ${flaggedDocIds.length} filed document(s) don't look like they match this domain and haven't been cleared for review.`);
    this.name = "DomainMismatchError";
  }
}

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
  // Hard stop, not just a warning — a document only ever carries
  // domain_mismatch when either the automated classifier (lab-email.ts)
  // or a manual upload (documents/route.ts) already flagged its own
  // content as not matching the domain it's filed under. Never silently
  // ship that; the admin has to actually open the job and resolve it
  // (replace the document, which clears the flag) before any packet for
  // this domain can be built again.
  const flaggedDocs = documents.filter((d) => d.kind === "lab_report" && d.domain_mismatch);
  if (flaggedDocs.length > 0) {
    throw new DomainMismatchError(domain, flaggedDocs.map((d) => d.id));
  }
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
    ...(domain === "asbestos"
      ? customer.company_id === FLI_ENVIRONMENTAL_COMPANY_ID
        ? [PERSONAL_LICENSE_STORAGE_PATH, FLI_CREDENTIALS_STORAGE_PATH]
        : settings.credentials_document_path
          ? [settings.credentials_document_path]
          : []
      : []),
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
// draft's multiple report attachments (see lab-email.ts). `onlyDomains`
// (the Email tab's checklist — see lab-email.ts's createSelectedDraftForJob)
// narrows that down to a chosen subset; omitted, every domain on the job
// is included, same as before this parameter existed.
export async function buildAllFinalReportPackets(
  job: Job, customer: Customer, settings: Settings, onlyDomains?: ReportDomain[]
): Promise<{ domain: ReportDomain; buffer: Buffer }[]> {
  const domains = jobReportDomains(job.service_type).filter((d) => !onlyDomains || onlyDomains.includes(d));
  return Promise.all(domains.map(async (domain) => ({ domain, buffer: await buildFinalReportPacket(job, customer, settings, domain) })));
}

// Per Tim, 2026-09-04 — factored out of the standalone download route
// (api/admin/jobs/[id]/moisture-mapping-report) so the Email tab's
// checklist-driven draft builder (lab-email.ts) can attach the same PDF
// to a Gmail draft without duplicating the photo-download logic.
export async function buildMoistureMappingReportBuffer(
  job: Job, customer: Customer, settings: Settings
): Promise<Buffer> {
  const { renderMoistureMappingReportPdf, moistureMappingPhotoFormat } = await import("@/lib/report-pdf");
  const supabase = getSupabaseAdmin();
  const jobPhotos = job.photos ?? [];
  if (jobPhotos.length === 0) {
    throw new Error("This job has no photos yet");
  }
  const photos = await Promise.all(
    jobPhotos.map(async (photo) => {
      const { data: blob, error: downloadError } = await supabase.storage
        .from("job-photos")
        .download(photo.storage_path);
      if (downloadError || !blob) {
        console.error(`Skipping missing moisture mapping photo ${photo.storage_path}:`, downloadError);
        return null;
      }
      return {
        room: photo.room ?? null,
        caption: photo.caption ?? null,
        buffer: Buffer.from(await blob.arrayBuffer()),
        format: moistureMappingPhotoFormat(photo.file_name),
      };
    })
  );
  const resolvedPhotos = photos.filter((p): p is NonNullable<typeof p> => p !== null);
  if (resolvedPhotos.length === 0) {
    throw new Error("None of this job's photos could be loaded");
  }
  return renderMoistureMappingReportPdf({ job, customer, settings, photos: resolvedPhotos });
}
