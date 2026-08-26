import { randomUUID } from "crypto";
// Imports the implementation directly rather than the package root — see
// src/app/api/admin/jobs/[id]/documents/route.ts for why.
import pdfParse from "pdf-parse/lib/pdf-parse.js";
import { getSupabaseAdmin } from "@/lib/supabase";
import { getSettings } from "@/lib/settings";
import { withCompanyBillingAddress } from "@/lib/customer-billing";
import { formatDateMDY } from "@/lib/date-format";
import { threadSubject, threadHeaders } from "@/lib/email-thread";
import {
  addLabelToMessage,
  createDraft,
  deleteDraft,
  findPdfParts,
  getAttachmentData,
  getHeader,
  getMessage,
  getOrCreateLabelId,
  getValidAccessToken,
  listMessagesByQuery,
  markMessageRead,
} from "@/lib/gmail";
import {
  detectAsbestosResult,
  detectLabInfo,
  extractReportProjectNumber,
  extractSampleCount,
  extractSampleResults,
  extractMoldSampleCount,
  extractMoldSampleResults,
  extractSampledDate,
} from "@/lib/parse-lab-report";
import { isLabInvoiceText, extractLabInvoiceTotalCents, extractInvoiceLineItems } from "@/lib/parse-lab-invoice";
import { defaultInvoiceLineItems, invoiceLineItemsTotalCents } from "@/lib/invoice-defaults";
import { formatCents } from "@/lib/pricing";
import { createStripeInvoiceForJob } from "@/lib/stripe";
import { splitTrailingCocPages } from "@/lib/split-lab-report-coc";
import { extractPositionOrderedText } from "@/lib/pdf-position-text";
import { jobReportDomains, ASBESTOS_NEGATIVE_REMARK, ASBESTOS_POSITIVE_REMARK, NEWTON_FIRE_FLOOD_COMPANY_ID, reportEmailAttachmentFilename, type ReportDomain } from "@/lib/report-findings";
import { sendEmail, emailShell } from "@/lib/email";
import { getAppUrl } from "@/lib/app-url";
import { escapeHtml } from "@/lib/html";
import { expandAddress } from "@/lib/address";
import type { Company, Customer, Job, JobDocument, JobWithCustomer, Settings } from "@/lib/types";

// @react-pdf/renderer (report-pdf.tsx / invoice-pdf.ts) is imported
// dynamically, not statically, and only after this module's pdf-parse
// calls are done for the batch. A static top-level import here pulls
// react-pdf's whole module graph in before pdf-parse ever runs (Node
// evaluates every statically-imported module's top-level code before this
// file's own functions can execute), and something in that graph corrupts
// state pdf-parse's bundled legacy pdf.js depends on — real attachments
// that parsed correctly in isolation (verified byte-for-byte) started
// throwing "bad XRef entry" purely from being in the same request as this
// import. The manual upload route (.../documents/route.ts) never imports
// react-pdf at all and has never hit this.

export interface LabEmailCheckResult {
  checked: number;
  matched: { projectNumber: string; jobId: string }[];
  cocUploaded: { projectNumber: string; jobId: string }[];
  labInvoicesRecorded: { projectNumber: string; jobId: string }[];
  unmatched: number;
}

// EMSL scans in the physical chain-of-custody form and emails a "receipt
// confirmation" as soon as it arrives at the lab — well before results are
// ready — with the project number embedded in the subject line rather than
// in the COC PDF itself (that PDF is a scan of a handwritten form, with no
// reliable extractable text): "EMSL receipt confirmation, COC for order(s)
// 132605381 (132605381 - 26-2806 - 11 Regent Circle; Unit 1; Brookline,
// MA)". Gated on "COC for order" so this never fires on some unrelated
// subject that happens to contain a project-number-shaped digit pair.
export function extractProjectNumberFromCocSubject(subject: string): string | null {
  if (!/COC for order/i.test(subject)) return null;
  const match = subject.match(/(?<!\d)(2\d-\d{3,6})(?!\d)/);
  return match ? match[1] : null;
}

function formatDateMMDDYYYY(date: string | null): string {
  return formatDateMDY(date) ?? "__/__/____";
}

// Per Tim: every drafted email needs this plain-text sign-off at the
// bottom, below the existing closing line — not replacing it. Shared here
// since it's identical across the report/invoice/combined/payment-reminder
// draft bodies below (both the "\n"-joined plain-text one and the
// "<br>"-joined HTML ones — plain text renders fine either way).
//
// No phone line (confirmed live 2026-08-26) — every body already states
// the phone number in its own closing sentence just above this block, and
// three short stacked lines (name/company/phone) is exactly the shape
// Gmail's compose UI treats as a collapsible signature block, hiding it
// behind a "..." toggle — which it still did even with a genuinely
// different phone-line format than Tim's own saved Gmail signature, so
// the trigger is the shape (several short lines in a row), not a literal
// text match. Two lines side-steps that shape without dropping any info
// the reader doesn't already have right above it.
const SIGNATURE_LINES = ["Tim Hall", "Commonwealth Inspection Services"];

// Per Tim, 2026-08-26 — replaces the old FLI-inherited template with his
// own shorter wording: domain-labeled ("asbestos inspection report", not
// a generic "final report"), address and sampling date on one line
// instead of two separately-labeled ones, and "call me" instead of
// "contact our office." domainPhrase/reportNoun mirror
// combinedDraftBodyHtml's own domain-labeling below, for a job whose
// service_type spans more than one domain.
//
// HTML, not plain text (confirmed live 2026-08-26) — a plain-text
// message left Gmail's own compose UI to auto-collapse the last two
// signature lines under a "..." "show trimmed content" toggle, the same
// treatment Gmail gives a quoted reply, since a name-then-short-lines
// shape at the end of a text/plain body reads to Gmail as boilerplate to
// hide. HTML content (like every other draft body in this file) doesn't
// get that treatment.
function reportDraftBodyHtml(job: Job, settings: Settings): string {
  const domains = jobReportDomains(job.service_type);
  const domainPhrase = reportDomainListPhrase(domains);
  const reportNoun = domains.length > 1 ? "inspection reports" : "inspection report";
  return [
    "Hi,",
    "",
    `Please find attached the ${domainPhrase} ${reportNoun} for:`,
    "",
    `${escapeHtml(expandAddress(job.service_address))} (Date of Sampling: ${escapeHtml(formatDateMMDDYYYY(job.requested_date))})`,
    "",
    `If you have any questions, call me at ${escapeHtml(settings.business_phone)}.`,
    "",
    ...SIGNATURE_LINES,
  ].join("<br>");
}

// Drafted copy (not the owner's own verbatim wording, unlike the report
// template above) — invoice goes out the moment lab results land, well
// before the report is released, so it needs its own standalone note
// rather than reusing report-focused phrasing ("analytical report",
// "laboratory results") that wouldn't make sense on its own.
function invoiceDraftBodyHtml(job: Job, settings: Settings, totalCents: number, payNowUrl: string | null): string {
  return [
    "Hi,",
    "",
    "Please find attached the invoice for the asbestos inspection completed at:",
    "",
    `Site: ${escapeHtml(expandAddress(job.service_address))}`,
    "",
    `Total due: ${escapeHtml(formatCents(totalCents))}`,
    ...(payNowUrl ? ["", `<a href="${escapeHtml(payNowUrl)}">LINK TO PAY</a>`] : []),
    "",
    `Should you have any questions or need additional information, please contact our office at ${escapeHtml(settings.business_phone)}.`,
    "",
    "Thank you for the opportunity to provide you with our services.",
    "",
    ...SIGNATURE_LINES,
  ].join("<br>");
}

// "asbestos", "asbestos and mold", "asbestos, mold, and lead" — every
// domain actually on the job, not just whichever one happens to be first
// in service_type. Confirmed live 2026-08-25: a mixed asbestos+mold job's
// combined draft said "the asbestos bulk sample analytical report" even
// though a separate mold report was attached right alongside it — a client
// skimming the email body alone would have no idea mold was even tested.
function reportDomainListPhrase(domains: ReportDomain[]): string {
  if (domains.length === 1) return domains[0];
  if (domains.length === 2) return `${domains[0]} and ${domains[1]}`;
  return `${domains.slice(0, -1).join(", ")}, and ${domains[domains.length - 1]}`;
}

// The Email tab's single manual send — attached report + invoice covering
// both in one note rather than stitching the two standalone bodies above
// together.
function combinedDraftBodyHtml(job: Job, settings: Settings, totalCents: number, payNowUrl: string | null): string {
  const domains = jobReportDomains(job.service_type);
  const domainPhrase = reportDomainListPhrase(domains);
  const reportNoun = domains.length > 1 ? "analytical reports" : "analytical report";
  return [
    "Hi,",
    "",
    `Please find attached the ${domainPhrase} ${reportNoun} and invoice for:`,
    "",
    `Site: ${escapeHtml(expandAddress(job.service_address))}`,
    "",
    `Date of Sampling: ${escapeHtml(formatDateMMDDYYYY(job.requested_date))}`,
    "",
    `Total due: ${escapeHtml(formatCents(totalCents))}`,
    ...(payNowUrl ? ["", `<a href="${escapeHtml(payNowUrl)}">LINK TO PAY</a>`] : []),
    "",
    `Should you have any questions or need additional information, please contact our office at ${escapeHtml(settings.business_phone)}.`,
    "",
    "Thank you for the opportunity to provide you with our services and we look forward to working together in the future.",
    "",
    ...SIGNATURE_LINES,
  ].join("<br>");
}

// A label this pipeline alone applies once a candidate is actually handled
// — not is:unread, and not markMessageRead below (that still runs, for the
// owner's own inbox hygiene, but is no longer what candidacy depends on).
// Same fix, same root cause, as job-intake.ts's PROCESSED_LABEL: confirmed
// live 2026-08-25 that two real Crystal Analytical lab-report emails
// (jobs 26-0002, 26-0003) never got processed because they were marked
// read — by the owner checking his own inbox — before the next cron poll
// ever got to them, which silently and permanently dropped them out of an
// is:unread search with no error, no retry, and no trace. A label only
// this pipeline ever sets can't be defeated by the owner's own reading
// habits the way is:unread can.
const PROCESSED_LABEL = "cis-lab-email-processed";

/** Checks the connected inbox for lab result emails, matches them to a project by the project number printed in the PDF, and drafts the final report + invoice. Also catches chain-of-custody receipt emails (matched by subject line), lab-bundled COC attachments, and EMSL's separate billing invoice emails (recorded as lab cost, not drafted). Draft only — never sent automatically. */
export async function checkForLabResultEmails(): Promise<LabEmailCheckResult> {
  const accessToken = await getValidAccessToken();
  if (!accessToken) throw new Error("Gmail is not connected");

  const supabase = getSupabaseAdmin();
  const settings = await getSettings();
  const processedLabelId = await getOrCreateLabelId(accessToken, PROCESSED_LABEL);
  // -from:me — confirmed live 2026-08-25 as the real root cause behind
  // repeated duplicate lab_report/lab_invoice documents: this app's own
  // outgoing drafts (report, invoice, combined) carry a PDF attachment
  // whose text embeds the job's own project number ("Invoice Project
  // #26-0003...") — with nothing excluding the account's own mail, each
  // new draft became a fresh, unlabeled "incoming" candidate on the very
  // next cron tick, got matched back to the same job by its own project
  // number, and got misfiled as a new lab_report (or, for the multi-job
  // invoice path, credited to every job in the same batch) — a
  // self-perpetuating loop: draft → false candidate → refiled → another
  // draft → repeat. The PROCESSED_LABEL guard alone couldn't catch this
  // since each new draft is a genuinely new, never-before-seen message.
  const candidates = await listMessagesByQuery(accessToken, `has:attachment filename:pdf newer_than:14d -label:${PROCESSED_LABEL} -from:me`);

  const result: LabEmailCheckResult = { checked: 0, matched: [], cocUploaded: [], labInvoicesRecorded: [], unmatched: 0 };

  candidateLoop: for (const candidate of candidates) {
    result.checked++;
    // One bad message (a corrupt attachment, an unexpected reply format,
    // a transient Gmail API hiccup) must never fail the whole batch — every
    // other candidate still deserves a chance to match and get drafted.
    try {
      const message = await getMessage(accessToken, candidate.id);
      // Belt-and-suspenders against the exact race that produced duplicate
      // lab_report/lab_invoice documents on real jobs (26-0002, 26-0003)
      // confirmed live 2026-08-25: a label just added by an in-flight run
      // (this one's own manual test, an overlapping "Check Now" click, a
      // prior cron tick) can take a beat to show up in the -label: search
      // above, so the SAME message re-appears as a candidate before that
      // search catches up. This message's own labelIds, fetched fresh right
      // here, reflect the true current state immediately — no index lag —
      // so re-checking it catches what the search alone can miss.
      if (message.labelIds?.includes(processedLabelId)) continue;
      const pdfParts = findPdfParts(message.payload);

      let matchedJob: (Job & { customers: Customer & { companies: Company | null } }) | null = null;
      let matchedBuffer: Buffer | null = null;
      let matchedText = "";

      for (const part of pdfParts) {
        try {
          const data = await getAttachmentData(accessToken, candidate.id, part.attachmentId);
          const { text } = await pdfParse(data);

          // A multi-job invoice (see processMultiJobLabInvoiceEmail) needs
          // its own path before the single-project-number match below —
          // that match can only ever land on one job, which would
          // attribute an invoice spanning several jobs entirely to
          // whichever one happened to match first.
          if (isLabInvoiceText(text)) {
            const distinctProjectNumbers = new Set(extractInvoiceLineItems(text).map((i) => i.projectNumber));
            if (distinctProjectNumbers.size > 1) {
              const { recorded, unmatchedProjectNumbers } = await processMultiJobLabInvoiceEmail({
                accessToken,
                messageId: candidate.id,
                pdfBuffer: data,
                pdfText: text,
              });
              await addLabelToMessage(accessToken, candidate.id, processedLabelId);
              result.labInvoicesRecorded.push(...recorded);
              result.unmatched += unmatchedProjectNumbers.length;
              if (unmatchedProjectNumbers.length > 0) {
                console.error(`lab-email: invoice on message ${candidate.id} named project number(s) with no matching job: ${unmatchedProjectNumbers.join(", ")}`);
              }
              continue candidateLoop;
            }
          }

          const projectNumber = extractReportProjectNumber(text);
          if (!projectNumber) continue;

          const { data: job } = await supabase
            .from("jobs")
            .select("*, customers!customer_id(*, companies!company_id(*))")
            .ilike("project_number", projectNumber)
            .maybeSingle();
          if (job) {
            matchedJob = job as unknown as Job & { customers: Customer & { companies: Company | null } };
            matchedBuffer = data;
            matchedText = text;
            break;
          }
        } catch (e) {
          console.error(`lab-email: failed to parse attachment ${part.filename} on message ${candidate.id}:`, e);
        }
      }

      if (matchedJob && matchedBuffer) {
        // EMSL's billing invoice carries the same "Project:" line as its
        // results report, so it matches a job here too — isLabInvoiceText
        // tells the two apart before this runs the results-report path
        // (sample extraction, drafting) on a document that isn't one.
        if (isLabInvoiceText(matchedText)) {
          await processMatchedLabInvoiceEmail({
            accessToken,
            messageId: candidate.id,
            job: matchedJob,
            pdfBuffer: matchedBuffer,
            pdfText: matchedText,
          });
          await addLabelToMessage(accessToken, candidate.id, processedLabelId);
          result.labInvoicesRecorded.push({ projectNumber: matchedJob.project_number ?? "", jobId: matchedJob.id });
          continue;
        }

        await processMatchedLabEmail({
          accessToken,
          messageId: candidate.id,
          job: matchedJob,
          pdfBuffer: matchedBuffer,
          pdfText: matchedText,
          settings,
        });
        await addLabelToMessage(accessToken, candidate.id, processedLabelId);
        result.matched.push({ projectNumber: matchedJob.project_number ?? "", jobId: matchedJob.id });
        continue;
      }

      // Not a lab-report email — check whether it's EMSL's separate,
      // earlier "receipt confirmation" for a chain-of-custody form instead
      // (see extractProjectNumberFromCocSubject above).
      const subject = getHeader(message, "Subject") ?? "";
      const cocProjectNumber = extractProjectNumberFromCocSubject(subject);
      const cocPart = pdfParts.find((p) => /coc/i.test(p.filename));
      if (cocProjectNumber && cocPart) {
        const { data: job } = await supabase
          .from("jobs")
          .select("*, customers!customer_id(*, companies!company_id(*))")
          .ilike("project_number", cocProjectNumber)
          .maybeSingle();
        if (job) {
          const cocBuffer = await getAttachmentData(accessToken, candidate.id, cocPart.attachmentId);
          await uploadCocDocument(job as unknown as Job, cocBuffer);
          await markMessageRead(accessToken, candidate.id);
          await addLabelToMessage(accessToken, candidate.id, processedLabelId);
          result.cocUploaded.push({ projectNumber: job.project_number ?? "", jobId: job.id });
          continue;
        }
      }

      result.unmatched++;
    } catch (e) {
      console.error(`Skipping lab-result candidate message ${candidate.id}:`, e);
      result.unmatched++;
    }
  }

  return result;
}

// Shared by the lab-bundled path (processMatchedLabEmail, below) and the
// standalone EMSL receipt-confirmation path above — files a chain-of-
// custody PDF on the job the same way the manual "Chain of Custody" upload
// station does, so it shows up there without the admin re-uploading
// something that already landed in their inbox.
async function uploadCocDocument(job: Job, pdfBuffer: Buffer): Promise<void> {
  const supabase = getSupabaseAdmin();
  const serviceTypeLabels = (job.service_type ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const primaryServiceType = serviceTypeLabels[0] ?? "";

  const docId = randomUUID();
  const storagePath = `${job.id}/${docId}-coc.pdf`;
  await supabase.storage.from("job-documents").upload(storagePath, pdfBuffer, { contentType: "application/pdf" });
  const document: JobDocument = {
    id: docId,
    kind: "coc",
    service_type: primaryServiceType,
    file_name: "coc.pdf",
    storage_path: storagePath,
    uploaded_at: new Date().toISOString(),
    project_number_mismatch: null,
  };
  await supabase.from("jobs").update({ documents: [...(job.documents ?? []), document] }).eq("id", job.id);
}

// EMSL's billing invoice for the job, caught by the same project-number
// match as a results report (see isLabInvoiceText's call site above) but
// routed here instead — files it under "Laboratory Invoice" (the same
// document kind and station the manual upload uses) and records the
// dollar total as this job's lab cost. Per how EMSL actually bills here,
// there's only ever one invoice per job, so this overwrites lab_cost_cents
// outright rather than accumulating — the real invoiced amount is
// authoritative over anything typed in manually beforehand.
async function processMatchedLabInvoiceEmail(params: {
  accessToken: string;
  messageId: string;
  job: Job;
  pdfBuffer: Buffer;
  pdfText: string;
}): Promise<void> {
  const { accessToken, messageId, job, pdfBuffer, pdfText } = params;
  const supabase = getSupabaseAdmin();

  // One Laboratory Invoice station per service type label, not per domain
  // (see the Lab Paperwork loop in JobsDashboard.tsx) — a job combining
  // asbestos and mold work billed on the same invoice needs it filed under
  // every label so each domain's own Report tab actually shows it, not
  // just whichever label happened to be first. Confirmed live 2026-08-25:
  // 26-0002's invoice only populated under Limited Asbestos Inspection,
  // leaving the Mold Report tab's own station empty even though the same
  // invoice covers the mold work too. One storage upload, one JobDocument
  // row per label (all pointing at the same file — no need to re-upload
  // the same bytes once per label).
  const serviceTypeLabels = (job.service_type ?? "").split(",").map((s) => s.trim()).filter(Boolean);

  const docId = randomUUID();
  const storagePath = `${job.id}/${docId}-lab-invoice.pdf`;
  await supabase.storage.from("job-documents").upload(storagePath, pdfBuffer, { contentType: "application/pdf" });
  const uploadedAt = new Date().toISOString();
  const newDocuments: JobDocument[] = serviceTypeLabels.map((label) => ({
    id: randomUUID(),
    kind: "lab_invoice",
    service_type: label,
    file_name: "lab-invoice.pdf",
    storage_path: storagePath,
    uploaded_at: uploadedAt,
    project_number_mismatch: null,
  }));
  const update: Record<string, unknown> = { documents: [...(job.documents ?? []), ...newDocuments] };

  const totalCents = extractLabInvoiceTotalCents(pdfText);
  if (totalCents != null) update.lab_cost_cents = totalCents;
  const labInfo = detectLabInfo(pdfText);
  if (labInfo) {
    update.lab_name = labInfo.labName;
    update.lab_nist_cert = labInfo.nistCert;
    update.lab_massdls_cert = labInfo.massdlsCert;
  }

  await supabase.from("jobs").update(update).eq("id", job.id);
  await markMessageRead(accessToken, messageId);
}

// Crystal Analytical bills per lab order, not per job — one invoice
// routinely spans every job billed that day (confirmed against a real
// invoice, #6491: three jobs, five line items, one shared PDF). Unlike
// EMSL's always-one-job invoice above, this looks its own jobs up rather
// than receiving one already matched — the single-project-number match in
// checkForLabResultEmails' main loop can only ever land on one job, which
// would silently attribute the *entire* invoice total to whichever job
// happened to match first. Each matched job gets its own copy of the PDF
// (so it shows up on that job's own Laboratory Invoice station) and only
// the amount its own line items actually total to, not the invoice grand
// total. A project number the invoice names but this system has no job
// for (a typo, a job from before this system, one outside FLI Environmental
// entirely) is skipped and reported back, not silently dropped.
async function processMultiJobLabInvoiceEmail(params: {
  accessToken: string;
  messageId: string;
  pdfBuffer: Buffer;
  pdfText: string;
}): Promise<{ recorded: { projectNumber: string; jobId: string }[]; unmatchedProjectNumbers: string[] }> {
  const { accessToken, messageId, pdfBuffer, pdfText } = params;
  const supabase = getSupabaseAdmin();

  const amountCentsByProject = new Map<string, number>();
  for (const item of extractInvoiceLineItems(pdfText)) {
    amountCentsByProject.set(item.projectNumber, (amountCentsByProject.get(item.projectNumber) ?? 0) + item.amountCents);
  }

  const labInfo = detectLabInfo(pdfText);
  const recorded: { projectNumber: string; jobId: string }[] = [];
  const unmatchedProjectNumbers: string[] = [];

  for (const [projectNumber, amountCents] of amountCentsByProject) {
    const { data: job } = await supabase.from("jobs").select("*").ilike("project_number", projectNumber).maybeSingle();
    if (!job) {
      unmatchedProjectNumbers.push(projectNumber);
      continue;
    }

    // Same one-station-per-label reasoning as processMatchedLabInvoiceEmail
    // above — a job combining domains needs the invoice filed under every
    // label, not just the first, so every domain's own Report tab shows it.
    const serviceTypeLabels = (job.service_type ?? "").split(",").map((s: string) => s.trim()).filter(Boolean);

    const docId = randomUUID();
    const storagePath = `${job.id}/${docId}-lab-invoice.pdf`;
    await supabase.storage.from("job-documents").upload(storagePath, pdfBuffer, { contentType: "application/pdf" });
    const uploadedAt = new Date().toISOString();
    const newDocuments: JobDocument[] = serviceTypeLabels.map((label: string) => ({
      id: randomUUID(),
      kind: "lab_invoice",
      service_type: label,
      file_name: "lab-invoice.pdf",
      storage_path: storagePath,
      uploaded_at: uploadedAt,
      project_number_mismatch: null,
    }));
    const update: Record<string, unknown> = {
      documents: [...(job.documents ?? []), ...newDocuments],
      lab_cost_cents: amountCents,
    };
    if (labInfo) {
      update.lab_name = labInfo.labName;
      update.lab_nist_cert = labInfo.nistCert;
      update.lab_massdls_cert = labInfo.massdlsCert;
    }

    await supabase.from("jobs").update(update).eq("id", job.id);
    recorded.push({ projectNumber: job.project_number ?? projectNumber, jobId: job.id });
  }

  await markMessageRead(accessToken, messageId);
  return { recorded, unmatchedProjectNumbers };
}

async function processMatchedLabEmail(params: {
  accessToken: string;
  messageId: string;
  job: Job & { customers: Customer & { companies: Company | null } };
  pdfBuffer: Buffer;
  pdfText: string;
  settings: Settings;
}): Promise<void> {
  const { accessToken, messageId, job, pdfBuffer, pdfText, settings } = params;
  const supabase = getSupabaseAdmin();

  // Same extraction the manual "Laboratory Results" upload uses (see
  // src/app/api/admin/jobs/[id]/documents/route.ts) — a job's service_type
  // can carry multiple labels (e.g. "Limited Asbestos Inspection, Mold Bulk
  // Sampling"), but one lab report only ever covers one of them per
  // upload, so the first label is the same best-effort assumption that
  // route makes today.
  const serviceTypeLabels = (job.service_type ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const primaryServiceType = serviceTypeLabels[0] ?? "";

  // Mirrors the manual "Laboratory Results" upload route's own isMold
  // branching (api/admin/jobs/[id]/documents/route.ts) — this automated
  // path used to always call the asbestos-only extractors regardless of
  // service type, so a mold job's report landing via the Gmail scanner
  // (rather than a manual upload) never got its sample count/results
  // auto-filled at all, silently, for any lab. Same mold/asbestos field
  // split as the manual route: mold's own mold_lab_name/mold_sample_results,
  // never the shared asbestos/lead ones, so a mixed job's two domains can't
  // clobber each other.
  const isMold = /mold/i.test(primaryServiceType);
  const isAsbestos = primaryServiceType.toLowerCase().includes("asbestos");

  // See pdf-position-text.ts — Crystal Analytical's tables (and its
  // "Date(s) Sampled:"/"Collected:" line, see extractSampledDate) only
  // parse correctly from reading-order text, not the raw PDF stream.
  // Computed once, up front, since the sample count below, the
  // sample-by-sample results/positive-negative call further down, and the
  // sampled-date extraction all need it — using it for some but not
  // others let them disagree (confirmed live on a manual upload for
  // 26-0001: sample_counts said 2, sample_results correctly listed all 4
  // of the same report's samples).
  const positionOrderedText = isMold || isAsbestos ? await extractPositionOrderedText(pdfBuffer) : undefined;

  const update: Record<string, unknown> = {};
  const count = isMold ? extractMoldSampleCount(pdfText, primaryServiceType) : extractSampleCount(pdfText, positionOrderedText);
  if (count != null && primaryServiceType) {
    update.sample_counts = { ...(job.sample_counts ?? {}), [primaryServiceType]: count };
  }
  // The report's own actual sample-collection date — see
  // extractSampledDate's own comment for why this isn't requested_date
  // (the scheduled/booked date, which can differ from when the tech
  // actually collected samples). One field per domain, same as
  // lab_name/mold_lab_name above.
  const sampledDate = extractSampledDate(pdfText, positionOrderedText);
  if (sampledDate != null) {
    if (isMold) update.mold_date_sampled = sampledDate;
    else if (isAsbestos) update.lab_date_sampled = sampledDate;
  }
  const labInfo = detectLabInfo(pdfText);
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
    const sampleResults = extractMoldSampleResults(pdfText, primaryServiceType);
    if (sampleResults.length > 0) {
      // Tagged per-label, not overwritten wholesale — see the manual
      // upload route's own comment on this for why (Crystal Analytical
      // bundles every mold method into one PDF uploaded once per label).
      const priorOtherLabels = (job.mold_sample_results ?? []).filter((r) => r.serviceType !== primaryServiceType);
      update.mold_sample_results = [...priorOtherLabels, ...sampleResults];
    }
  } else if (isAsbestos) {
    const asbestosResult = detectAsbestosResult(pdfText, positionOrderedText);
    if (asbestosResult != null) {
      update.asbestos_result = asbestosResult;
      // Same fix as the manual upload route — the positive/negative flag
      // alone doesn't fill in the letter's findings sentence
      // (report_summary), which otherwise only ever got set by an admin
      // picking from the Result dropdown. Only when nothing's there yet,
      // so a manually-edited summary is never overwritten.
      if (!job.report_summary) {
        update.report_summary = asbestosResult === "positive" ? ASBESTOS_POSITIVE_REMARK : ASBESTOS_NEGATIVE_REMARK;
      }
    }
    const sampleResults = extractSampleResults(pdfText, positionOrderedText);
    if (sampleResults.length > 0) update.sample_results = sampleResults;
  }

  // Crystal Analytical (and similarly-shaped labs) email back one PDF with
  // the typed lab data pages followed by the scanned, handwritten chain-of-
  // custody form as the trailing page(s) — never a separate attachment.
  // Split that off so it can be filed in the Chain of Custody station
  // instead of staying buried at the end of the Laboratory Results PDF
  // (and so the merged final report packet doesn't show that page twice —
  // it already includes both kinds of documents in order).
  const { reportBuffer, cocBuffer } = await splitTrailingCocPages(pdfBuffer);

  // File the lab's own PDF on the job the same way a manual upload does,
  // so it shows up on the Laboratory Paperwork tab and gets merged into
  // the downloadable report packet — not just used to extract numbers.
  const docId = randomUUID();
  const storagePath = `${job.id}/${docId}-lab-report.pdf`;
  await supabase.storage.from("job-documents").upload(storagePath, reportBuffer, { contentType: "application/pdf" });
  const document: JobDocument = {
    id: docId,
    kind: "lab_report",
    service_type: primaryServiceType,
    file_name: "lab-report.pdf",
    storage_path: storagePath,
    uploaded_at: new Date().toISOString(),
    project_number_mismatch: null,
  };
  update.documents = [...(job.documents ?? []), document];

  const { data: updatedRow, error: updateError } = await supabase
    .from("jobs")
    .update(update)
    .eq("id", job.id)
    .select("*, customers!customer_id(*, companies!company_id(*))")
    .single();
  if (updateError || !updatedRow) {
    throw new Error(`Failed to update project from lab email: ${updateError?.message}`);
  }
  const updatedJob = updatedRow as unknown as Job & { customers: Customer & { companies: Company | null } };

  // Marked read here — right after the lab PDF is safely filed on the job
  // — rather than after drafting succeeds below. Used to happen at the very
  // end, so any failure in the drafting steps (a stale Gmail token, a
  // template bug, one malformed PDF) left this message unread, and the
  // next 15-minute cron cycle would reprocess it from scratch: re-uploading
  // and re-appending the identical lab PDF as a brand-new duplicate
  // "Laboratory Paperwork" document, forever, every cycle, with nothing
  // but a console.error to notice by. Marking read now means a drafting
  // failure fails once (loudly, see below) instead of looping and piling
  // up duplicate documents — the admin's existing manual "Create Invoice
  // Draft"/report buttons are the correct recovery path from here, not an
  // automatic retry that also re-runs the parts that already succeeded.
  await markMessageRead(accessToken, messageId);

  try {
    // updatedJob (not job) so this doesn't race the lab_report document
    // just added above — uploadCocDocument reads the job's current
    // documents array fresh and appends to it.
    if (cocBuffer) {
      await uploadCocDocument(updatedJob, cocBuffer);
    }

    // Invoice always goes out the moment lab results land. Invoice pricing
    // happens inside draftInvoiceEmailForJob — shared with the manual
    // "Create Invoice Draft" button so both paths price and persist the
    // invoice exactly the same way.
    await draftInvoiceEmailForJob({ job: updatedJob, settings, accessToken });
    // The report follows immediately too, unless this job is flagged
    // individual-billed (job.is_individual) — those are held back until
    // autoDraftReportIfJustPaid releases them once the job is marked Paid.
    // The customer isn't just left to wonder, though — they get their own
    // short notice instead, saying the report is ready and waiting on
    // payment.
    if (!updatedJob.is_individual) {
      await draftReportEmailForJob({ job: updatedJob, settings, accessToken });
    } else {
      await draftPaymentReminderForIndividual({ job: updatedJob, settings, accessToken });
    }
  } catch (err) {
    console.error(`processMatchedLabEmail: lab PDF filed on job ${updatedJob.id}, but invoice/report drafting failed:`, err);
    await sendEmail({
      to: process.env.OWNER_EMAIL!,
      subject: `Lab results landed but drafting failed — ${updatedJob.project_number ?? updatedJob.id}`,
      html: emailShell(`
        <p style="font-size:15px;">The lab report PDF was filed on this job successfully, but drafting the invoice and/or report afterward failed.</p>
        <p>This won't retry automatically — use the "Create Invoice Draft" / report buttons on the job to finish it by hand.</p>
      `),
    }).catch(() => {});
  }
}

// Invoice half of the split — called the moment lab results land (see
// processMatchedLabEmail above) and from the manual "Create Invoice Draft"
// button. Prices the invoice fresh (same shared computation as the Invoice
// tab) and creates the draft — never sends it.
async function draftInvoiceEmailForJob(params: {
  job: Job & { customers: Customer & { companies: Company | null } };
  settings: Settings;
  accessToken: string;
}): Promise<{ messageId: string }> {
  const { job, settings, accessToken } = params;
  const supabase = getSupabaseAdmin();

  const { data: settingsRow } = await supabase.from("settings").select("service_types, pricing_zones").eq("id", 1).single();
  const lineItems = defaultInvoiceLineItems(
    job as JobWithCustomer,
    settingsRow?.service_types ?? [],
    settingsRow?.pricing_zones ?? []
  );
  const totalCents = invoiceLineItemsTotalCents(lineItems);
  await supabase
    .from("jobs")
    .update({ invoice_line_items: lineItems, invoice_total_cents: totalCents, invoice_auto: true })
    .eq("id", job.id);
  const pricedJob = { ...job, invoice_line_items: lineItems, invoice_total_cents: totalCents };

  const customer = withCompanyBillingAddress(pricedJob.customers, pricedJob.customers.companies);
  const { renderInvoicePdf } = await import("@/lib/invoice-pdf");
  const invoicePdf = await renderInvoicePdf({ job: pricedJob, customer, company: pricedJob.customers.companies, settings });

  // A company can designate a specific contact (e.g. its AP person) as who
  // invoices go to, distinct from whichever contact this job itself is tied
  // to — see the `billing_contact_id` column comment. This specific job's
  // own override (set from the portal's "Billing contact for this project"
  // selector) wins over the company-wide default when both are set. Falls
  // back to the job's own contact when neither is set, so most jobs are
  // unaffected; when one is set, the job's own contact is Cc'd rather than
  // dropped.
  const billingContactId = pricedJob.billing_contact_id ?? pricedJob.customers.companies?.billing_contact_id;
  const billingContact = billingContactId
    ? (await supabase.from("customers").select("*").eq("id", billingContactId).maybeSingle()).data
    : null;
  const toCustomer = billingContact ?? customer;

  const ccRecipients = [
    ...(billingContact ? [customer.email] : []),
    ...(pricedJob.invoice_emails?.split(",") ?? []),
  ]
    .map((e) => e.trim())
    .filter((e) => e && e !== toCustomer.email);

  // Best-effort: a Stripe hiccup (bad key, network blip) must never block
  // the Gmail draft itself — the draft is the part that matters, the Pay
  // Now link is a bonus when Stripe cooperates. Skipped entirely for a
  // check-paid job (job.payment_type) — no Stripe invoice needed at all.
  let payNowUrl: string | null = null;
  if (pricedJob.payment_type !== "check") {
    try {
      const { hostedInvoiceUrl } = await createStripeInvoiceForJob(pricedJob, toCustomer);
      payNowUrl = hostedInvoiceUrl;
    } catch (e) {
      console.error(`Failed to create Stripe invoice for job ${job.id}:`, e);
    }
  }

  // Recreating a draft (the admin already had one, is now clicking
  // "Recreate Invoice Draft") replaces it rather than leaving the stale
  // copy sitting in Gmail alongside the new one — best-effort, since a
  // draft that's already been sent or manually deleted is expected to 404.
  if (job.invoice_draft_gmail_id) {
    try {
      await deleteDraft(accessToken, job.invoice_draft_gmail_id);
    } catch (e) {
      console.error(`Failed to delete previous invoice draft for job ${job.id}:`, e);
    }
  }

  const draft = await createDraft(accessToken, {
    to: toCustomer.email,
    cc: [...new Set(ccRecipients)].join(", ") || undefined,
    subject: `Invoice - ${expandAddress(pricedJob.service_address)}`,
    bodyHtml: invoiceDraftBodyHtml(pricedJob, settings, totalCents, payNowUrl),
    attachments: [
      { filename: `Invoice-${pricedJob.project_number ?? job.id}.pdf`, mimeType: "application/pdf", content: invoicePdf },
    ],
  });

  await supabase
    .from("jobs")
    .update({
      invoice_drafted_at: new Date().toISOString(),
      invoice_draft_gmail_id: draft.id,
      invoice_draft_gmail_message_id: draft.messageId,
    })
    .eq("id", job.id);

  return { messageId: draft.messageId };
}

// What an individual-billed job gets instead of draftReportEmailForJob
// below — see the is_individual branch in processMatchedLabEmail. No
// attachment (there's nothing to send yet), just a short note so the
// customer isn't left to discover on their own, by checking the portal,
// that a report is sitting there waiting on payment. Draft only, like
// every other customer email in this app — the owner still reviews and
// sends it by hand. Reuses createStripeInvoiceForJob's own idempotency
// (it returns the same invoice draftInvoiceEmailForJob just created,
// rather than making a second one) to get the same Pay Now link.
async function draftPaymentReminderForIndividual(params: {
  job: Job & { customers: Customer & { companies: Company | null } };
  settings: Settings;
  accessToken: string;
}): Promise<void> {
  const { job, settings, accessToken } = params;
  const supabase = getSupabaseAdmin();
  const customer = withCompanyBillingAddress(job.customers, job.customers.companies);

  let payNowUrl: string | null = null;
  if (job.payment_type !== "check") {
    try {
      const { hostedInvoiceUrl } = await createStripeInvoiceForJob(job, customer);
      payNowUrl = hostedInvoiceUrl;
    } catch (e) {
      console.error(`Failed to get Stripe payment link for job ${job.id}:`, e);
    }
  }

  // Recreating (a second lab email landing on the same combined job, e.g.
  // mold results after asbestos) replaces the earlier draft rather than
  // leaving a stale duplicate sitting in Gmail alongside the new one —
  // best-effort, since a draft already sent or deleted by hand 404s.
  if (job.payment_reminder_draft_gmail_id) {
    try {
      await deleteDraft(accessToken, job.payment_reminder_draft_gmail_id);
    } catch (e) {
      console.error(`Failed to delete previous payment-reminder draft for job ${job.id}:`, e);
    }
  }

  const draft = await createDraft(accessToken, {
    to: customer.email,
    subject: `Your report is ready - ${expandAddress(job.service_address)}`,
    bodyHtml: [
      "Hi,",
      "",
      "Your final report is ready. As soon as payment is received, we'll send it right over.",
      "",
      `Site: ${escapeHtml(expandAddress(job.service_address))}`,
      ...(payNowUrl ? ["", `<a href="${escapeHtml(payNowUrl)}">LINK TO PAY</a>`] : []),
      "",
      `Should you have any questions, please contact our office at ${escapeHtml(settings.business_phone)}.`,
      "",
      "Thank you for the opportunity to provide you with our services.",
      "",
      ...SIGNATURE_LINES,
    ].join("<br>"),
    attachments: [],
  });

  await supabase
    .from("jobs")
    .update({
      payment_reminder_drafted_at: new Date().toISOString(),
      payment_reminder_draft_gmail_id: draft.id,
      payment_reminder_draft_gmail_message_id: draft.messageId,
    })
    .eq("id", job.id);
}

// Report half of the split — called the moment lab results land (see
// processMatchedLabEmail above, which drafts a payment-reminder note
// instead for individual-billed jobs) and from the manual "Create Report
// Draft" button. Attaches the full
// merged packet — cover letter, lab results, chain of custody, license —
// via the same builder the "Download Final Report" button uses, not just
// the bare letter.
// Confirmed live 2026-08-25: unlike a Limited Asbestos Inspection report
// (fully mechanical — sample results in, letter out, nothing for the owner
// to add), a mold report's own "IV. Conclusions & Recommendations" section
// (report-pdf.tsx) is the owner's professional judgment, written by hand
// into mold_report_notes — it isn't derivable from the lab data alone.
// Both draft-creation paths below build the actual report packet a client
// would receive, so both must refuse rather than send that section out
// blank/generic — draftReportEmailForJob's caller (processMatchedLabEmail)
// already has a catch-log-and-alert-the-owner path built for exactly this
// kind of drafting failure, so throwing here routes into that instead of
// silently shipping an incomplete report.
function assertMoldReportReady(job: Job & { customers: Customer }): void {
  // Newton Fire & Flood's mold reports always carry real content — their
  // standing Conclusions & Recommendations paragraph (report-pdf.tsx)
  // renders unconditionally, so mold_report_notes is genuinely optional
  // "Additional" notes for them, not something that has to be filled in
  // before a draft can go out.
  if (job.customers.company_id === NEWTON_FIRE_FLOOD_COMPANY_ID) return;
  if (jobReportDomains(job.service_type).includes("mold") && !job.mold_report_notes?.trim()) {
    throw new Error(
      "Mold report is missing its Conclusions & Recommendations (mold_report_notes) — add that on the job's Final Report tab before creating a report draft."
    );
  }
}

async function draftReportEmailForJob(params: {
  job: Job & { customers: Customer & { companies: Company | null } };
  settings: Settings;
  accessToken: string;
}): Promise<{ messageId: string }> {
  const { job, settings, accessToken } = params;
  assertMoldReportReady(job);
  const supabase = getSupabaseAdmin();

  const customer = withCompanyBillingAddress(job.customers, job.customers.companies);
  const { buildAllFinalReportPackets } = await import("@/lib/report-packet");
  // One attachment per domain actually on the job (asbestos/lead/mold) —
  // a job combining types gets one PDF per type, all on this same draft,
  // rather than one email per type.
  const reportPackets = await buildAllFinalReportPackets(job, customer, settings);

  // Deduped — a company job's report_emails can legitimately include the
  // billing contact too (e.g. cc'd on the original order email alongside
  // customer.email being that same person), which would otherwise list them
  // twice on the draft.
  const recipients = [...new Set(
    [customer.email, ...(job.report_emails?.split(",") ?? [])]
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean)
  )];

  // Recreating a draft (the admin already had one, is now clicking
  // "Recreate Report Draft") replaces it rather than leaving the stale
  // copy sitting in Gmail alongside the new one — best-effort, since a
  // draft that's already been sent or manually deleted is expected to 404.
  if (job.report_draft_gmail_id) {
    try {
      await deleteDraft(accessToken, job.report_draft_gmail_id);
    } catch (e) {
      console.error(`Failed to delete previous report draft for job ${job.id}:`, e);
    }
  }

  // Same subject + In-Reply-To/References chain as the earlier automated
  // "request received"/"confirmed" emails (see lib/email-thread.ts) and the
  // manual combined-draft path below — this draft is meant to land as the
  // next reply in that same conversation, not a new email. A job with no
  // prior automated emails (e.g. admin-entered, or an email-intake job
  // whose only prior message is the client's own original one) just has an
  // empty/short chain, so this becomes the next reply in whatever thread
  // that was — same call either way.
  const existingThreadIds: string[] = Array.isArray(job.email_thread_message_ids) ? job.email_thread_message_ids : [];
  const draft = await createDraft(accessToken, {
    to: [...new Set(recipients)].join(", "),
    subject: threadSubject(job.service_address, job.service_type),
    headers: threadHeaders(existingThreadIds),
    threadId: job.email_gmail_thread_id ?? undefined,
    bodyHtml: reportDraftBodyHtml(job, settings),
    attachments: reportPackets.map(({ domain, buffer }) => ({
      filename: reportEmailAttachmentFilename(job.project_number, job.id, domain),
      mimeType: "application/pdf",
      content: buffer,
    })),
  });

  // Marks this project as "a draft exists" for the project list's
  // drafted-but-not-sent indicator and the Final Report tab's
  // confirm-before-duplicate check. Deliberately not cleared or
  // overwritten by a second draft. report_draft_gmail_id (+ the underlying
  // message id) is the live source of truth checked by draft-status/route.ts
  // — there is no manual "mark as sent," it's either still in Drafts or
  // it's gone because the owner actually sent it (detected via the SENT
  // label on that message).
  await supabase
    .from("jobs")
    .update({
      report_drafted_at: new Date().toISOString(),
      report_draft_gmail_id: draft.id,
      report_draft_gmail_message_id: draft.messageId,
    })
    .eq("id", job.id);

  return { messageId: draft.messageId };
}

// The Email tab's one manual send — the final report packet and invoice
// as two attachments on a single draft, with a Stripe payment link in the
// body. Replaces having to separately draft-then-send an invoice email
// and a report email for the same project. Doesn't touch the automatic
// pipeline (processMatchedLabEmail/autoDraftReportIfJustPaid above still
// draft the invoice and report separately, at the two different moments
// each is actually ready) — this is only the manual, everything's-done,
// send-it-now path.
async function draftCombinedEmailForJob(params: {
  job: Job & { customers: Customer & { companies: Company | null } };
  settings: Settings;
  accessToken: string;
}): Promise<{ messageId: string }> {
  const { job, settings, accessToken } = params;
  assertMoldReportReady(job);
  const supabase = getSupabaseAdmin();

  const { data: settingsRow } = await supabase.from("settings").select("service_types, pricing_zones").eq("id", 1).single();
  const lineItems = defaultInvoiceLineItems(
    job as JobWithCustomer,
    settingsRow?.service_types ?? [],
    settingsRow?.pricing_zones ?? []
  );
  const totalCents = invoiceLineItemsTotalCents(lineItems);
  await supabase
    .from("jobs")
    .update({ invoice_line_items: lineItems, invoice_total_cents: totalCents, invoice_auto: true })
    .eq("id", job.id);
  const pricedJob = { ...job, invoice_line_items: lineItems, invoice_total_cents: totalCents };

  const customer = withCompanyBillingAddress(pricedJob.customers, pricedJob.customers.companies);

  const { renderInvoicePdf } = await import("@/lib/invoice-pdf");
  const invoicePdf = await renderInvoicePdf({ job: pricedJob, customer, company: pricedJob.customers.companies, settings });

  const { buildAllFinalReportPackets } = await import("@/lib/report-packet");
  // One PDF per domain on the job — combined with the invoice below into
  // this same single draft.
  const reportPackets = await buildAllFinalReportPackets(pricedJob, customer, settings);

  // Same billing-contact-aware "to" as the standalone invoice draft (see
  // its own comment) — whoever the invoice reaches should also be who
  // gets the report, since this is now one email covering both.
  const billingContactId = pricedJob.billing_contact_id ?? pricedJob.customers.companies?.billing_contact_id;
  const billingContact = billingContactId
    ? (await supabase.from("customers").select("*").eq("id", billingContactId).maybeSingle()).data
    : null;
  const toCustomer = billingContact ?? customer;

  const ccRecipients = [
    ...(billingContact ? [customer.email] : []),
    ...(pricedJob.invoice_emails?.split(",") ?? []),
    ...(pricedJob.report_emails?.split(",") ?? []),
  ]
    .map((e) => e.trim())
    .filter((e) => e && e !== toCustomer.email);

  // Best-effort, same as the standalone invoice draft — a Stripe hiccup
  // must never block the Gmail draft itself. Skipped entirely for a
  // check-paid job (job.payment_type) — no Stripe invoice needed at all.
  let payNowUrl: string | null = null;
  if (pricedJob.payment_type !== "check") {
    try {
      const { hostedInvoiceUrl } = await createStripeInvoiceForJob(pricedJob, toCustomer);
      payNowUrl = hostedInvoiceUrl;
    } catch (e) {
      console.error(`Failed to create Stripe invoice for job ${job.id}:`, e);
    }
  }

  // Recreating (the admin already had a draft, is clicking again) replaces
  // whatever's there rather than leaving stale copies sitting in Gmail —
  // covers both a previous combined draft and any leftover separate
  // invoice/report drafts from before. Best-effort, since a draft that's
  // already been sent or manually deleted is expected to 404.
  const staleDraftIds = new Set([job.invoice_draft_gmail_id, job.report_draft_gmail_id].filter((id): id is string => Boolean(id)));
  for (const id of staleDraftIds) {
    try {
      await deleteDraft(accessToken, id);
    } catch (e) {
      console.error(`Failed to delete previous draft ${id} for job ${job.id}:`, e);
    }
  }

  // Same subject + In-Reply-To/References chain as the earlier automated
  // "request received"/"confirmed" emails (see lib/email-thread.ts) — this
  // draft is meant to land as the next reply in that same conversation,
  // not a new email, so the client's whole project history reads as one
  // thread. A job with no prior automated emails (e.g. admin-entered,
  // never went through the portal) just has an empty chain, so this
  // becomes its own thread's root instead — same call either way.
  const existingThreadIds: string[] = Array.isArray(pricedJob.email_thread_message_ids) ? pricedJob.email_thread_message_ids : [];
  const draft = await createDraft(accessToken, {
    to: toCustomer.email,
    cc: [...new Set(ccRecipients)].join(", ") || undefined,
    subject: threadSubject(pricedJob.service_address, pricedJob.service_type),
    headers: threadHeaders(existingThreadIds),
    threadId: pricedJob.email_gmail_thread_id ?? undefined,
    bodyHtml: combinedDraftBodyHtml(pricedJob, settings, totalCents, payNowUrl),
    attachments: [
      ...reportPackets.map(({ domain, buffer }) => ({
        filename: reportEmailAttachmentFilename(pricedJob.project_number, job.id, domain),
        mimeType: "application/pdf",
        content: buffer,
      })),
      { filename: `Invoice-${pricedJob.project_number ?? job.id}.pdf`, mimeType: "application/pdf", content: invoicePdf },
    ],
  });

  // Both the invoice and report drafted/gmail-id/message-id columns point
  // at this same draft — from Gmail's perspective it's one email, but the
  // rest of the app (project list drafted-but-not-sent badge, draft-status
  // polling, confirm-before-duplicate check) already reads these two
  // column pairs independently, so pointing both at the same message keeps
  // all of that working without a schema change.
  const draftedAt = new Date().toISOString();
  await supabase
    .from("jobs")
    .update({
      invoice_drafted_at: draftedAt,
      invoice_draft_gmail_id: draft.id,
      invoice_draft_gmail_message_id: draft.messageId,
      report_drafted_at: draftedAt,
      report_draft_gmail_id: draft.id,
      report_draft_gmail_message_id: draft.messageId,
    })
    .eq("id", job.id);

  return { messageId: draft.messageId };
}

async function loadJobForDraft(jobId: string): Promise<{
  job: Job & { customers: Customer & { companies: Company | null } };
  settings: Settings;
  accessToken: string;
}> {
  const accessToken = await getValidAccessToken();
  if (!accessToken) throw new Error("Gmail is not connected");

  const supabase = getSupabaseAdmin();
  const settings = await getSettings();

  const { data: jobRow, error } = await supabase
    .from("jobs")
    .select("*, customers!customer_id(*, companies!company_id(*))")
    .eq("id", jobId)
    .single();
  if (error || !jobRow) throw new Error("Project not found");

  return {
    job: jobRow as unknown as Job & { customers: Customer & { companies: Company | null } },
    settings,
    accessToken,
  };
}

/** Manual "Create Invoice Draft" button on the Email tab — same draft-creation path the automatic email check uses, callable on demand for any project. */
export async function createInvoiceDraftForJob(jobId: string): Promise<{ messageId: string }> {
  return draftInvoiceEmailForJob(await loadJobForDraft(jobId));
}

/** Manual "Create Report Draft" button on the Email tab — same draft-creation path the automatic email check uses, callable on demand for any project. Returns the new draft's own Gmail message id so a caller can jump straight to it. */
export async function createReportDraftForJob(jobId: string): Promise<{ messageId: string }> {
  return draftReportEmailForJob(await loadJobForDraft(jobId));
}

/** Manual re-send path for the individual-billed "your report is ready, pay to receive it" notice — same draft-creation code the automatic lab-results-landing path uses. */
export async function createPaymentReminderDraftForJob(jobId: string): Promise<void> {
  await draftPaymentReminderForIndividual(await loadJobForDraft(jobId));
}

/** The Email tab's one "View Draft" button — final report + invoice as two attachments on a single Gmail draft, with a payment link. Returns the new draft's own Gmail message id so the caller can jump straight to it. */
export async function createCombinedDraftForJob(jobId: string): Promise<{ messageId: string }> {
  return draftCombinedEmailForJob(await loadJobForDraft(jobId));
}

/**
 * The follow-through for a job newly becoming paid, shared by the two
 * places that can make that happen: the admin PATCH route (the "Set status
 * to Paid" button, which already has its own flexible update — this is
 * just the side effect it triggers afterward) and markJobPaid below (used
 * by the Stripe webhook, which has no other fields to combine and so does
 * its own simple status update first). For an individual-billed job (see
 * job.is_individual) this is what releases the report
 * that processMatchedLabEmail deliberately skipped — for every other job
 * the report was already drafted at lab-results time, so this is just a
 * no-op safety net (report_drafted_at already set) for cases like Gmail
 * not being connected yet. Best-effort: a Gmail hiccup (not connected, API
 * error) must never block the payment/status update itself.
 */
export async function autoDraftReportIfJustPaid(jobId: string): Promise<void> {
  const supabase = getSupabaseAdmin();
  const { data } = await supabase.from("jobs").select("report_drafted_at").eq("id", jobId).maybeSingle();
  if (data?.report_drafted_at) return;

  try {
    await createReportDraftForJob(jobId);
  } catch (e) {
    console.error(`autoDraftReportIfJustPaid: failed to auto-draft report for job ${jobId}:`, e);
  }
}

/**
 * Used where nothing else already updates the job's status — currently
 * just the Stripe webhook's `invoice.paid` handler. The admin PATCH route
 * sets status/paid_date itself (as part of its own flexible multi-field
 * update) and calls autoDraftReportIfJustPaid directly instead of this.
 *
 * Guarded against payment_reversed_at already being set: Stripe's webhook
 * delivery is at-least-once, so a delayed or retried invoice.paid event can
 * arrive after the admin has already discovered and flagged a chargeback/
 * refund on this same payment. Blindly re-running would silently revert
 * whatever manual correction the admin made — treat that as a signal this
 * needs human eyes, not an automatic re-confirmation.
 */
export async function markJobPaid(jobId: string): Promise<void> {
  const supabase = getSupabaseAdmin();
  const { data: current } = await supabase.from("jobs").select("paid_date, payment_reversed_at, project_number").eq("id", jobId).maybeSingle();

  if (current?.payment_reversed_at) {
    console.error(`markJobPaid: ignoring invoice.paid for job ${jobId} — payment was already flagged reversed at ${current.payment_reversed_at}. Needs manual review.`);
    await sendEmail({
      to: process.env.OWNER_EMAIL!,
      subject: `Stripe sent a paid confirmation for a job already flagged as reversed — ${current.project_number ?? jobId}`,
      html: emailShell(`
        <p style="font-size:15px;">Stripe just confirmed a payment for this job again, but it was already flagged as refunded/disputed on ${escapeHtml(new Date(current.payment_reversed_at).toLocaleString())}.</p>
        <p>This is likely a delayed or retried webhook delivery for the original payment, not a new one — nothing was changed automatically. Worth a quick look to confirm.</p>
      `),
    });
    return;
  }

  const update: Record<string, unknown> = { status: "paid" };
  if (!current?.paid_date) {
    update.paid_date = new Date().toISOString().slice(0, 10);
  }
  await supabase.from("jobs").update(update).eq("id", jobId);

  await autoDraftReportIfJustPaid(jobId);
}

/**
 * Called from the Stripe webhook when a payment already marked "paid" is
 * later refunded, disputed, or the invoice is voided/marked uncollectible
 * after the fact. Deliberately does NOT revert status away from "paid" —
 * that's a business decision (was the report already sent? does the client
 * need a call?) the admin should make, not something to guess at
 * automatically. This just raises a flag they can't miss.
 */
export async function markJobPaymentReversed(jobId: string, reason: string): Promise<void> {
  const supabase = getSupabaseAdmin();
  const { data: job } = await supabase
    .from("jobs")
    .select("project_number, status, report_drafted_at, project_number, service_address, customers(name, email)")
    .eq("id", jobId)
    .maybeSingle();
  if (!job) return;

  await supabase
    .from("jobs")
    .update({ payment_reversed_at: new Date().toISOString() })
    .eq("id", jobId)
    .is("payment_reversed_at", null);

  const appUrl = getAppUrl();
  const jobUrl = appUrl ? `${appUrl}/admin/dashboard?jobId=${jobId}` : null;
  const customer = Array.isArray(job.customers) ? job.customers[0] : job.customers;

  await sendEmail({
    to: process.env.OWNER_EMAIL!,
    subject: `Payment reversed on ${job.project_number ?? "a job"} — needs review`,
    html: emailShell(`
      <p style="font-size:15px;">Stripe reported a payment reversal (${escapeHtml(reason)}) on a job currently marked <strong>${escapeHtml(job.status)}</strong>.</p>
      <table style="width:100%; font-size:14px; color:#16213a;">
        <tr><td style="padding:4px 8px 4px 0; color:#64748b; white-space:nowrap;">Project</td><td>${escapeHtml(job.project_number ?? jobId)}</td></tr>
        <tr><td style="padding:4px 8px 4px 0; color:#64748b; white-space:nowrap;">Customer</td><td>${escapeHtml(customer?.name ?? "—")}</td></tr>
        <tr><td style="padding:4px 8px 4px 0; color:#64748b; white-space:nowrap;">Address</td><td>${escapeHtml(job.service_address ? expandAddress(job.service_address) : "—")}</td></tr>
        <tr><td style="padding:4px 8px 4px 0; color:#64748b; white-space:nowrap;">Report already drafted</td><td>${job.report_drafted_at ? "Yes" : "No"}</td></tr>
      </table>
      <p style="margin-top:12px;">Status was left as-is — this is just a flag. Worth deciding whether to follow up with the client and/or adjust the job's status yourself.</p>
      ${jobUrl ? `<p style="margin-top:12px;"><a href="${jobUrl}" style="display:inline-block; background:#193466; color:#fff; padding:10px 16px; border-radius:8px; text-decoration:none; font-size:14px;">Review this job</a></p>` : ""}
    `),
  });
}
