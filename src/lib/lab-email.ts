import { randomUUID } from "crypto";
// Imports the implementation directly rather than the package root — see
// src/app/api/admin/jobs/[id]/documents/route.ts for why.
import pdfParse from "pdf-parse/lib/pdf-parse.js";
import { getSupabaseAdmin } from "@/lib/supabase";
import { getSettings } from "@/lib/settings";
import { withCompanyBillingAddress } from "@/lib/customer-billing";
import {
  createDraft,
  deleteDraft,
  findPdfParts,
  getAttachmentData,
  getHeader,
  getMessage,
  getValidAccessToken,
  listCandidateMessages,
  markMessageRead,
} from "@/lib/gmail";
import {
  detectAsbestosResult,
  detectLabInfo,
  extractReportProjectNumber,
  extractSampleCount,
  extractSampleResults,
} from "@/lib/parse-lab-report";
import { isLabInvoiceText, extractLabInvoiceTotalCents } from "@/lib/parse-lab-invoice";
import { defaultInvoiceLineItems, invoiceLineItemsTotalCents } from "@/lib/invoice-defaults";
import { formatCents } from "@/lib/pricing";
import { createStripeInvoiceForJob } from "@/lib/stripe";
import { splitTrailingCocPages } from "@/lib/split-lab-report-coc";
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
  if (!date) return "__/__/____";
  const [y, m, d] = date.split("-");
  if (!y || !m || !d) return "__/__/____";
  return `${m}/${d}/${y}`;
}

// The owner's own real template (the one FLI Environmental has sent for
// years) — reused verbatim rather than a generic message, just with the
// blanks filled in and the phone number pulled from Settings instead of
// hardcoded, so it stays correct once he's fully off the old FLI number.
function reportDraftBodyText(job: Job, settings: Settings): string {
  return [
    "Hi,",
    "",
    "Please find attached the asbestos bulk sample analytical report for:",
    "",
    `Site: ${job.service_address}`,
    "",
    `Date of Sampling: ${formatDateMMDDYYYY(job.requested_date)}`,
    "",
    "All laboratory results and analytical data sheets are included in the attached report.",
    "",
    `Should you have any questions or need additional information, please contact our office at ${settings.business_phone}.`,
    "",
    "Thank you for the opportunity to provide you with our services and we look forward to working together in the future.",
  ].join("\n");
}

// Drafted copy (not the owner's own verbatim wording, unlike the report
// template above) — invoice goes out the moment lab results land, well
// before the report is released, so it needs its own standalone note
// rather than reusing report-focused phrasing ("analytical report",
// "laboratory results") that wouldn't make sense on its own.
function invoiceDraftBodyText(job: Job, settings: Settings, totalCents: number, payNowUrl: string | null): string {
  return [
    "Hi,",
    "",
    "Please find attached the invoice for the asbestos inspection completed at:",
    "",
    `Site: ${job.service_address}`,
    "",
    `Total due: ${formatCents(totalCents)}`,
    ...(payNowUrl ? ["", `Pay online: ${payNowUrl}`] : []),
    "",
    `Should you have any questions or need additional information, please contact our office at ${settings.business_phone}.`,
    "",
    "Thank you for the opportunity to provide you with our services.",
  ].join("\n");
}

// The Email tab's single manual send — attached report + invoice covering
// both in one note rather than stitching the two standalone bodies above
// together.
function combinedDraftBodyText(job: Job, settings: Settings, totalCents: number, payNowUrl: string | null): string {
  return [
    "Hi,",
    "",
    "Please find attached the asbestos bulk sample analytical report and invoice for:",
    "",
    `Site: ${job.service_address}`,
    "",
    `Date of Sampling: ${formatDateMMDDYYYY(job.requested_date)}`,
    "",
    "All laboratory results and analytical data sheets are included in the attached report.",
    "",
    `Total due: ${formatCents(totalCents)}`,
    ...(payNowUrl ? ["", `Pay online: ${payNowUrl}`] : []),
    "",
    `Should you have any questions or need additional information, please contact our office at ${settings.business_phone}.`,
    "",
    "Thank you for the opportunity to provide you with our services and we look forward to working together in the future.",
  ].join("\n");
}

/** Checks the connected inbox for lab result emails, matches them to a project by the project number printed in the PDF, and drafts the final report + invoice. Also catches chain-of-custody receipt emails (matched by subject line), lab-bundled COC attachments, and EMSL's separate billing invoice emails (recorded as lab cost, not drafted). Draft only — never sent automatically. */
export async function checkForLabResultEmails(): Promise<LabEmailCheckResult> {
  const accessToken = await getValidAccessToken();
  if (!accessToken) throw new Error("Gmail is not connected");

  const supabase = getSupabaseAdmin();
  const settings = await getSettings();
  const candidates = await listCandidateMessages(accessToken);

  const result: LabEmailCheckResult = { checked: 0, matched: [], cocUploaded: [], labInvoicesRecorded: [], unmatched: 0 };

  for (const candidate of candidates) {
    result.checked++;
    // One bad message (a corrupt attachment, an unexpected reply format,
    // a transient Gmail API hiccup) must never fail the whole batch — every
    // other candidate still deserves a chance to match and get drafted.
    try {
      const message = await getMessage(accessToken, candidate.id);
      const pdfParts = findPdfParts(message.payload);

      let matchedJob: (Job & { customers: Customer & { companies: Company | null } }) | null = null;
      let matchedBuffer: Buffer | null = null;
      let matchedText = "";

      for (const part of pdfParts) {
        try {
          const data = await getAttachmentData(accessToken, candidate.id, part.attachmentId);
          const { text } = await pdfParse(data);
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

  const serviceTypeLabels = (job.service_type ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const primaryServiceType = serviceTypeLabels[0] ?? "";

  const docId = randomUUID();
  const storagePath = `${job.id}/${docId}-lab-invoice.pdf`;
  await supabase.storage.from("job-documents").upload(storagePath, pdfBuffer, { contentType: "application/pdf" });
  const document: JobDocument = {
    id: docId,
    kind: "lab_invoice",
    service_type: primaryServiceType,
    file_name: "lab-invoice.pdf",
    storage_path: storagePath,
    uploaded_at: new Date().toISOString(),
    project_number_mismatch: null,
  };
  const update: Record<string, unknown> = { documents: [...(job.documents ?? []), document] };

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

  const update: Record<string, unknown> = {};
  const count = extractSampleCount(pdfText);
  if (count != null && primaryServiceType) {
    update.sample_counts = { ...(job.sample_counts ?? {}), [primaryServiceType]: count };
  }
  const labInfo = detectLabInfo(pdfText);
  if (labInfo) {
    update.lab_name = labInfo.labName;
    update.lab_nist_cert = labInfo.nistCert;
    update.lab_massdls_cert = labInfo.massdlsCert;
  }
  if (primaryServiceType.toLowerCase().includes("asbestos")) {
    const asbestosResult = detectAsbestosResult(pdfText);
    if (asbestosResult != null) update.asbestos_result = asbestosResult;
    const sampleResults = extractSampleResults(pdfText);
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

  // updatedJob (not job) so this doesn't race the lab_report document just
  // added above — uploadCocDocument reads the job's current documents array
  // fresh and appends to it.
  if (cocBuffer) {
    await uploadCocDocument(updatedJob, cocBuffer);
  }

  // Invoice always goes out the moment lab results land. Invoice pricing
  // happens inside draftInvoiceEmailForJob — shared with the manual "Create
  // Invoice Draft" button so both paths price and persist the invoice
  // exactly the same way.
  await draftInvoiceEmailForJob({ job: updatedJob, settings, accessToken });
  // The report follows immediately too, unless this job is flagged
  // individual-billed (job.is_individual) — those are held back until
  // autoDraftReportIfJustPaid releases them once the job is marked Paid.
  if (!updatedJob.is_individual) {
    await draftReportEmailForJob({ job: updatedJob, settings, accessToken });
  }

  // Keeps this message out of the next check's candidate query — the draft
  // is what matters going forward, not the source email itself.
  await markMessageRead(accessToken, messageId);
}

// Invoice half of the split — called the moment lab results land (see
// processMatchedLabEmail above) and from the manual "Create Invoice Draft"
// button. Prices the invoice fresh (same shared computation as the Invoice
// tab) and creates the draft — never sends it.
async function draftInvoiceEmailForJob(params: {
  job: Job & { customers: Customer & { companies: Company | null } };
  settings: Settings;
  accessToken: string;
}): Promise<void> {
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
    subject: `Invoice - ${pricedJob.service_address}`,
    bodyText: invoiceDraftBodyText(pricedJob, settings, totalCents, payNowUrl),
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
}

// Report half of the split — called the moment lab results land (see
// processMatchedLabEmail above, which skips this for individual-billed jobs)
// and from the manual "Create Report Draft" button. Attaches the full
// merged packet — cover letter, lab results, chain of custody, license —
// via the same builder the "Download Final Report" button uses, not just
// the bare letter.
async function draftReportEmailForJob(params: {
  job: Job & { customers: Customer & { companies: Company | null } };
  settings: Settings;
  accessToken: string;
}): Promise<void> {
  const { job, settings, accessToken } = params;
  const supabase = getSupabaseAdmin();

  const customer = withCompanyBillingAddress(job.customers, job.customers.companies);
  const { buildFinalReportPacket } = await import("@/lib/report-packet");
  const reportPdf = await buildFinalReportPacket(job, customer, settings);

  const recipients = [customer.email, ...(job.report_emails?.split(",") ?? [])]
    .map((e) => e.trim())
    .filter(Boolean);

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

  const draft = await createDraft(accessToken, {
    to: [...new Set(recipients)].join(", "),
    subject: `Asbestos Inspection Report - ${job.service_address}`,
    bodyText: reportDraftBodyText(job, settings),
    attachments: [
      { filename: `Final-Report-${job.project_number ?? job.id}.pdf`, mimeType: "application/pdf", content: reportPdf },
    ],
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
}): Promise<void> {
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

  const { buildFinalReportPacket } = await import("@/lib/report-packet");
  const reportPdf = await buildFinalReportPacket(pricedJob, customer, settings);

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

  const draft = await createDraft(accessToken, {
    to: toCustomer.email,
    cc: [...new Set(ccRecipients)].join(", ") || undefined,
    subject: pricedJob.service_type ? `${pricedJob.service_type} - ${pricedJob.service_address}` : pricedJob.service_address,
    bodyText: combinedDraftBodyText(pricedJob, settings, totalCents, payNowUrl),
    attachments: [
      { filename: `Final-Report-${pricedJob.project_number ?? job.id}.pdf`, mimeType: "application/pdf", content: reportPdf },
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
export async function createInvoiceDraftForJob(jobId: string): Promise<void> {
  await draftInvoiceEmailForJob(await loadJobForDraft(jobId));
}

/** Manual "Create Report Draft" button on the Email tab — same draft-creation path the automatic email check uses, callable on demand for any project. */
export async function createReportDraftForJob(jobId: string): Promise<void> {
  await draftReportEmailForJob(await loadJobForDraft(jobId));
}

/** The Email tab's one "Create Draft" button — final report + invoice as two attachments on a single Gmail draft, with a payment link. */
export async function createCombinedDraftForJob(jobId: string): Promise<void> {
  await draftCombinedEmailForJob(await loadJobForDraft(jobId));
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
 */
export async function markJobPaid(jobId: string): Promise<void> {
  const supabase = getSupabaseAdmin();
  const { data: current } = await supabase.from("jobs").select("paid_date").eq("id", jobId).maybeSingle();

  const update: Record<string, unknown> = { status: "paid" };
  if (!current?.paid_date) {
    update.paid_date = new Date().toISOString().slice(0, 10);
  }
  await supabase.from("jobs").update(update).eq("id", jobId);

  await autoDraftReportIfJustPaid(jobId);
}
