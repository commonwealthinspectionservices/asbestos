import { randomUUID, createHash } from "crypto";
// Imports the implementation directly rather than the package root — see
// src/app/api/admin/jobs/[id]/documents/route.ts for why.
import pdfParse from "pdf-parse/lib/pdf-parse.js";
import { getSupabaseAdmin } from "@/lib/supabase";
import { getSettings, primaryInspector } from "@/lib/settings";
import { withCompanyBillingAddress } from "@/lib/customer-billing";
import { formatDateMDY } from "@/lib/date-format";
import { threadSubject, threadHeaders } from "@/lib/email-thread";
import {
  addLabelToMessage,
  createDraft,
  deleteDraft,
  findPdfParts,
  getAttachmentData,
  getDraftStatus,
  getHeader,
  getMessage,
  getOrCreateLabelId,
  getSentMessageInfo,
  getValidAccessToken,
  listMessagesByQuery,
  markMessageRead,
} from "@/lib/gmail";
import {
  detectAsbestosResult,
  detectLabInfo,
  extractReportProjectAddress,
  extractReportProjectNumber,
  extractSampleCount,
  extractSampleResults,
  extractMoldSampleCount,
  extractMoldSampleResults,
  extractSampledDate,
  extractCrystalAnalyticalMaterialDescriptions,
} from "@/lib/parse-lab-report";
import {
  isLabInvoiceText,
  isWeeklyLabSummaryText,
  extractWeeklyLabSummaryTransactions,
  extractWeeklySummaryTotalCents,
  extractWeeklySummaryDateRangeLabel,
} from "@/lib/parse-lab-invoice";
import { defaultInvoiceLineItems, invoiceLineItemsTotalCents } from "@/lib/invoice-defaults";
import { computeLabCostCentsFromDocuments } from "@/lib/lab-cost";
import { formatCents } from "@/lib/pricing";
import { createStripeInvoiceForJob, tagInvoiceEmailed, getStripe } from "@/lib/stripe";
import { splitTrailingCocPages } from "@/lib/split-lab-report-coc";
import { extractPositionOrderedText } from "@/lib/pdf-position-text";
import { jobReportDomains, ASBESTOS_NEGATIVE_REMARK, ASBESTOS_POSITIVE_REMARK, NEWTON_FIRE_FLOOD_COMPANY_ID, BOSTON_HARBOR_WATER_RESTORATION_COMPANY_ID, reportEmailAttachmentFilename, type ReportDomain } from "@/lib/report-findings";
import { sendEmail, emailShell } from "@/lib/email";
import { getAppUrl } from "@/lib/app-url";
import { escapeHtml } from "@/lib/html";
import { expandAddress, splitAddress } from "@/lib/address";
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
// own wording: domain-labeled ("final asbestos inspection report", not a
// generic "final report"), address and sampling date labeled on their own
// separate lines instead of one combined parenthetical line, and "call
// me" instead of "contact our office." domainPhrase/reportNoun mirror
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
// Per Tim, 2026-08-28 (job 26-0009, Boston Harbor Water Restoration) —
// same fix as report-pdf.tsx's own sampledDate fallback: requested_date is
// just whatever date happened to be in the intake email, not a real target
// date for a company like Boston Harbor that never requests a specific
// date/time at all (Tim schedules those himself once the request comes
// in). The report PDF attached to this same email already got fixed to
// prefer confirmed_date over requested_date — this draft body's own
// separate "Date of Sampling" line hadn't, so the two disagreed on the
// same email. Domain-specific sampled dates (extracted from the actual lab
// report, whichever domain succeeded) still come first when known; a job
// spanning more than one domain just uses whichever one's set.
function bestSampledDate(job: Job): string | null {
  return job.lab_date_sampled ?? job.mold_date_sampled ?? job.lead_date_sampled ?? job.confirmed_date ?? job.requested_date;
}

function reportDraftBodyHtml(job: Job, settings: Settings): string {
  const domains = jobReportDomains(job.service_type);
  const domainPhrase = reportDomainListPhrase(domains);
  const isPlural = domains.length > 1;
  const reportNoun = isPlural ? "inspection reports" : "inspection report";
  const reportVerb = isPlural ? "are" : "is";
  return [
    "Hi,",
    "",
    `The final ${domainPhrase} ${reportNoun} ${reportVerb} attached here.`,
    "",
    `Address: ${escapeHtml(expandAddress(job.service_address))}`,
    `Date of Sampling: ${escapeHtml(formatDateMMDDYYYY(bestSampledDate(job)))}`,
    "",
    // Per Tim, 2026-08-27 — the phone number itself never wraps mid-digit;
    // if the sentence needs to break, the whole number moves to its own
    // line instead.
    `If you have any questions, call me at <span style="white-space:nowrap;">${escapeHtml(settings.business_phone)}</span>.`,
    "",
    ...SIGNATURE_LINES,
  ].join("<br>");
}

// Drafted copy (not the owner's own verbatim wording, unlike the report
// template above) — invoice goes out the moment lab results land, well
// before the report is released, so it needs its own standalone note
// rather than reusing report-focused phrasing ("analytical report",
// "laboratory results") that wouldn't make sense on its own. Per Tim,
// 2026-08-27 — this is the app's one shared/standard invoice message; the
// only company that actually gets it as its own separate email is Boston
// Harbor Water Restoration (see isSeparateDraftsCompany/
// BOSTON_HARBOR_WATER_RESTORATION_COMPANY_ID) — everyone else's invoice
// goes out folded into combinedDraftBodyHtml instead.
function invoiceDraftBodyHtml(job: Job, settings: Settings, payNowUrl: string | null): string {
  // Street on its own line, city/state/zip on the next — same split
  // JobsDashboard.tsx's own mobile address rendering uses.
  const { street, cityStateZip } = splitAddress(job.service_address);
  return [
    "Hi,",
    "",
    "Please find attached the invoice for the asbestos inspection completed at:",
    "",
    escapeHtml(expandAddress(street)),
    escapeHtml(expandAddress(cityStateZip)),
    // No "Total due" dollar figure in the email body itself (the attached
    // PDF and the pay link both already show it); "Link to pay", not
    // all-caps.
    ...(payNowUrl ? ["", `<a href="${escapeHtml(payNowUrl)}">Link to pay</a>`] : []),
    "",
    // The phone number itself never wraps mid-digit — see reportDraftBodyHtml's own comment on this.
    `If you have any questions, please call me at <span style="white-space:nowrap;">${escapeHtml(settings.business_phone)}</span>`,
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
// Same domain names the report PDFs themselves use ("Asbestos Inspection
// Report", not the admin dashboard tab's shorter "Asbestos Report") — per
// Tim, 2026-08-26.
const COMBINED_DRAFT_DOMAIN_REPORT_LABEL: Record<ReportDomain, string> = {
  asbestos: "Asbestos Inspection Report",
  mold: "Mold Inspection Report",
  lead: "Lead Inspection Report",
};

function combinedDraftBodyHtml(job: Job, settings: Settings, totalCents: number, payNowUrl: string | null): string {
  const domains = jobReportDomains(job.service_type);
  return [
    `<strong>Site:</strong> ${escapeHtml(expandAddress(job.service_address))}`,
    `<strong>Date of Sampling:</strong> ${escapeHtml(formatDateMMDDYYYY(bestSampledDate(job)))}`,
    "",
    "Hi,",
    "",
    "Attached are the following documents:",
    "",
    ...domains.map((d) => `&bull; ${COMBINED_DRAFT_DOMAIN_REPORT_LABEL[d]}`),
    "&bull; Invoice",
    ...(payNowUrl ? ["", `<a href="${escapeHtml(payNowUrl)}">Link to pay</a>`] : []),
    "",
    `Should you have any questions or need additional information, please contact me at <span style="white-space:nowrap;">${escapeHtml(settings.business_phone)}</span>.`,
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

// Per Tim — every report/invoice this app detects as sent also gets his
// own "Sent Reports"/"Sent Invoices" Gmail label applied, so they're easy
// to find/filter in his inbox alongside whatever he sends by hand.
// getOrCreateLabelId finds his existing label by name rather than making a
// new one.
const SENT_REPORTS_LABEL = "Sent Reports";
const SENT_INVOICES_LABEL = "Sent Invoices";

/**
 * Live check for whether a job's drafted report/invoice has actually been
 * sent — there is no manual "mark as sent", this is the only place
 * *_sent_at ever gets set, inferred from Gmail itself: still in Drafts is
 * "drafted", gone-and-carrying-the-SENT-label is "sent" (persisted right
 * here so it sticks without a re-check), gone-and-unlabeled means the
 * owner deleted the draft without sending. Called two ways: on demand from
 * the Final Report tab (via draft-status/route.ts) when someone actually
 * has the job open, and proactively every 15 minutes for every job with an
 * outstanding draft (check-sent-drafts cron) — per Tim, 2026-08-26, so a
 * sent report gets recognized and labeled without needing anyone to open
 * the job first.
 */
export async function checkDraftSentStatus(
  jobId: string,
  kind: "report" | "invoice"
): Promise<{ status: "sent" | "drafted" | "none"; sentAt?: string }> {
  const gmailIdCol = kind === "invoice" ? "invoice_draft_gmail_id" : "report_draft_gmail_id";
  const gmailMessageIdCol = kind === "invoice" ? "invoice_draft_gmail_message_id" : "report_draft_gmail_message_id";
  const sentAtCol = kind === "invoice" ? "invoice_sent_at" : "report_sent_at";
  // The "combined" draft (createCombinedDraftForJob, the only path the UI
  // actually uses now) writes the same Gmail draft/message id into both
  // pairs of columns — one Gmail send event covers both. Selecting the
  // other kind's columns too lets a single check here mark both sent at
  // once, instead of leaving the other column stuck unset forever because
  // nothing else ever polls it with its own kind.
  const otherGmailIdCol = kind === "invoice" ? "report_draft_gmail_id" : "invoice_draft_gmail_id";
  const otherSentAtCol = kind === "invoice" ? "report_sent_at" : "invoice_sent_at";

  const supabase = getSupabaseAdmin();
  const { data: job } = await supabase
    .from("jobs")
    .select(`${gmailIdCol}, ${gmailMessageIdCol}, ${sentAtCol}, ${otherGmailIdCol}, ${otherSentAtCol}, status, stripe_invoice_id`)
    .eq("id", jobId)
    .maybeSingle<Record<string, string | null>>();

  const sentAt = job?.[sentAtCol];
  if (sentAt) {
    return { status: "sent", sentAt };
  }
  const gmailId = job?.[gmailIdCol];
  if (!gmailId) {
    return { status: "none" };
  }

  const accessToken = await getValidAccessToken();
  if (!accessToken) {
    return { status: "none" };
  }

  const draftStatus = await getDraftStatus(accessToken, gmailId);
  if (draftStatus.status === "drafted") {
    return { status: "drafted" };
  }

  // draftStatus.status is "sent" (the common case — Gmail still resolves
  // the draft id, just with its message now SENT) or "gone" (the draft id
  // itself 404s, so fall back to whatever message id this app stored when
  // the draft was created — see getSentMessageInfo's own comment on why
  // that stored id can itself be stale).
  const resolved = draftStatus.status === "sent"
    ? draftStatus
    : await (async () => {
      const gmailMessageId = job?.[gmailMessageIdCol];
      if (!gmailMessageId) return null;
      const { sent, sentAt } = await getSentMessageInfo(accessToken, gmailMessageId);
      return sent ? { messageId: gmailMessageId, sentAt: sentAt ?? new Date().toISOString() } : null;
    })();

  if (resolved) {
    const finalSentAt = resolved.sentAt;
    const update: Record<string, string> = { [sentAtCol]: finalSentAt };
    const isCombinedDraft = gmailId && job?.[otherGmailIdCol] === gmailId && !job?.[otherSentAtCol];
    if (isCombinedDraft) update[otherSentAtCol] = finalSentAt;
    // Per Tim, 2026-08-27 — advance out of "ready_to_send" (drafted, not
    // yet sent) into "report_invoice_sent" ("Payment Pending") the moment
    // the invoice specifically is confirmed sent, regardless of the
    // report's own status — waiting on payment doesn't wait on the report
    // going out too. True whenever this call is itself confirming the
    // invoice sent (kind === "invoice") or a combined draft, where one
    // Gmail send event covers both at once. Only from ready_to_send
    // specifically — an individual-billed job is already "paid" by the
    // time its report/invoice go out (payment happens before release for
    // those), so this never regresses a paid job backward.
    const invoiceJustSent = kind === "invoice" || isCombinedDraft;
    if (invoiceJustSent && job?.status === "ready_to_send") {
      update.status = "report_invoice_sent";
    }
    await supabase.from("jobs").update(update).eq("id", jobId);
    // Best-effort — a labeling hiccup must never block the sent-status
    // check itself, which the Final Report tab depends on to update the
    // draft button. A combined draft's one message covers both, and its
    // *other* kind's check would otherwise never run this block at all —
    // sentAtCol is already set from this same update by the time the other
    // kind's check comes around, so it short-circuits at the early return
    // above and never reaches here. Apply both labels now instead of
    // relying on that second check to add its own.
    const labelsToApply = isCombinedDraft
      ? [SENT_REPORTS_LABEL, SENT_INVOICES_LABEL]
      : [kind === "invoice" ? SENT_INVOICES_LABEL : SENT_REPORTS_LABEL];
    for (const labelName of labelsToApply) {
      try {
        const labelId = await getOrCreateLabelId(accessToken, labelName);
        await addLabelToMessage(accessToken, resolved.messageId, labelId);
      } catch (e) {
        console.error(`Failed to apply "${labelName}" label to message ${resolved.messageId}:`, e);
      }
    }
    // Same "is the invoice's own sentAt column being newly set right here"
    // condition as the labeling above — invoice_sent_at either is sentAtCol
    // (kind === "invoice") or otherSentAtCol on a combined draft. Per Tim,
    // 2026-08-27 — best-effort, since Stripe has no idea an invoice was
    // ever actually emailed otherwise (see tagInvoiceEmailed's own
    // comment).
    if ((kind === "invoice" || isCombinedDraft) && job?.stripe_invoice_id) {
      try {
        await tagInvoiceEmailed(job.stripe_invoice_id, finalSentAt);
      } catch (e) {
        console.error(`Failed to tag Stripe invoice ${job.stripe_invoice_id} as emailed:`, e);
      }
    }
    return { status: "sent", sentAt: finalSentAt };
  }

  return { status: "none" };
}

// Collapses an address down to just its letters/digits (drops punctuation,
// spacing, and street-suffix abbreviation differences via expandAddress
// first) so "690 Blue Hill Ave, Dorchester, MA" from a lab report and
// "690 Blue Hill Ave, Dorchester, MA 02121" from job.service_address compare
// equal up to the point the shorter one ends, regardless of a missing zip
// or a "St"/"Street" mismatch.
export function normalizeAddressForMatch(address: string): string {
  return expandAddress(address).toLowerCase().replace(/[^a-z0-9]/g, "");
}

// Fallback for a report whose own project number was never typed anywhere
// as machine-readable text (see extractReportProjectAddress's own comment)
// — matches by the address the lab printed instead, against every job still
// actually waiting on lab results. Scoped to that one status specifically:
// a lab report always targets a job at exactly this stage, and narrowing to
// it keeps an address that happens to recur (a repeat client, a multi-unit
// building) from matching some unrelated older or newer job at the same
// street. Logs (never throws) and returns null on anything but exactly one
// match — zero is a genuine "not found," and more than one is a real
// ambiguity neither this function nor its caller should silently guess
// through.
async function findJobByReportAddress(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  reportAddress: string
): Promise<(Job & { customers: Customer & { companies: Company | null } }) | null> {
  const normalizedReportAddress = normalizeAddressForMatch(reportAddress);
  const { data: candidates } = await supabase
    .from("jobs")
    .select("*, customers!customer_id(*, companies!company_id(*))")
    .eq("status", "pending_lab_results");
  const matches = (candidates ?? []).filter((j) =>
    normalizeAddressForMatch(j.service_address ?? "").startsWith(normalizedReportAddress)
  );
  if (matches.length === 1) return matches[0] as unknown as Job & { customers: Customer & { companies: Company | null } };
  if (matches.length > 1) {
    console.error(`lab-email: report address "${reportAddress}" matched more than one job awaiting lab results (${matches.map((j) => j.project_number).join(", ")}) — needs a human to sort out, not guessing.`);
  }
  return null;
}

// Confirmed live 2026-08-28 — the QuickBooks-generated weekly summary PDF
// specifically (never any Crystal Analytical or EMSL PDF seen so far)
// intermittently fails pdf-parse's bundled legacy pdf.js with "Invalid root
// reference" or "Invalid PDF structure", even though the exact same bytes
// parse fine as a plain standalone Node script every time — genuinely
// non-deterministic within this app's own webpack-bundled module (the same
// document succeeded on one run and failed differently on the next, no
// code change in between), not a real defect in the PDF itself. A short
// retry is enough in practice — every failure observed recovered on the
// very next attempt.
async function parsePdfWithRetry(data: Buffer, label: string, attempts = 3): Promise<{ text: string }> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await pdfParse(data);
    } catch (e) {
      lastError = e;
      console.error(`lab-email: pdf-parse attempt ${attempt}/${attempts} failed for ${label}:`, e instanceof Error ? e.message : e);
    }
  }
  throw lastError;
}

/** Checks the connected inbox for lab result emails, matches them to a project by the project number printed in the PDF (falling back to the report's own printed address when the project number was only ever handwritten on a scanned, non-machine-readable chain-of-custody page — see extractReportProjectAddress/findJobByReportAddress), and drafts the final report + invoice. Also catches chain-of-custody receipt emails (matched by subject line), lab-bundled COC attachments, and QuickBooks' weekly summary rollup (recorded as lab cost, not drafted — see processWeeklyLabSummaryEmail). Per Tim, 2026-08-28 — the weekly summary is now the sole source for lab cost tracking; a per-invoice Crystal/EMSL email is recognized only so it doesn't get misrouted into the results-report path below, then marked processed and otherwise ignored. Draft only — never sent automatically. */
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
  //
  // No -label:${PROCESSED_LABEL} here (deliberately) — confirmed live
  // 2026-08-27 (invoices #6497/#6498, QuickBooks payment-request emails
  // from Crystal Analytical): Gmail's search index can flag a message as
  // matching `label:cis-lab-email-processed` — and so get silently
  // excluded by the negation here — even though a direct messages.get on
  // that exact message shows the label was never actually applied to it.
  // Both invoices sat excluded from every candidate list for 12+ hours
  // this way, never even reaching the per-message check below. That check
  // (message.labelIds, fetched fresh per message, no index involved) is
  // the only place PROCESSED_LABEL needs to be checked — it's authoritative
  // where this search-time negation isn't.
  const candidates = await listMessagesByQuery(accessToken, `has:attachment filename:pdf newer_than:14d -from:me`);

  const result: LabEmailCheckResult = { checked: 0, matched: [], cocUploaded: [], labInvoicesRecorded: [], unmatched: 0 };

  candidateLoop: for (const candidate of candidates) {
    result.checked++;
    // One bad message (a corrupt attachment, an unexpected reply format,
    // a transient Gmail API hiccup) must never fail the whole batch — every
    // other candidate still deserves a chance to match and get drafted.
    try {
      const message = await getMessage(accessToken, candidate.id);
      const subject = getHeader(message, "Subject") ?? "";
      // The only place PROCESSED_LABEL is actually checked (the candidate
      // query above deliberately doesn't try to exclude by it — see that
      // comment). This message's own labelIds, fetched fresh right here,
      // are authoritative — no search index involved, so no lag and no
      // risk of the index wrongly flagging an unlabeled message as a match
      // the way it did for #6497/#6498.
      if (message.labelIds?.includes(processedLabelId)) continue;
      const pdfParts = findPdfParts(message.payload);

      let matchedJob: (Job & { customers: Customer & { companies: Company | null } }) | null = null;
      let matchedBuffer: Buffer | null = null;
      let matchedText = "";

      for (const part of pdfParts) {
        try {
          const data = await getAttachmentData(accessToken, candidate.id, part.attachmentId);
          const { text } = await parsePdfWithRetry(data, `${candidate.id}:${part.filename}`);

          // QuickBooks' own weekly rollup (see processWeeklyLabSummaryEmail)
          // needs its own path checked first, same reasoning as the
          // multi-job invoice check right below it — one PDF, many jobs.
          if (isWeeklyLabSummaryText(text)) {
            const { recorded, unmatched } = await processWeeklyLabSummaryEmail({
              accessToken,
              messageId: candidate.id,
              pdfBuffer: data,
              pdfText: text,
            });
            await addLabelToMessage(accessToken, candidate.id, processedLabelId);
            result.labInvoicesRecorded.push(...recorded.map((r) => ({ projectNumber: r.projectNumber, jobId: r.jobId })));
            result.unmatched += unmatched.length;
            if (unmatched.length > 0) {
              console.error(
                `lab-email: weekly summary on message ${candidate.id} had unmatched transaction(s): ${unmatched
                  .map((u) => `${u.transactionType} #${u.num}${u.projectNumber ? ` (${u.projectNumber})` : ""}`)
                  .join(", ")}`
              );
              await alertUnmatchedWeeklySummaryTransactions(unmatched).catch(() => {});
            }
            continue candidateLoop;
          }

          // Per Tim, 2026-08-28 — "the system should only take into
          // account the weekly invoice that I got... screw all the other
          // ones": the weekly QuickBooks summary (isWeeklyLabSummaryText
          // above) is now the sole source for lab cost tracking — it's a
          // strict superset of what these per-invoice Crystal/EMSL emails
          // ever covered. Recognized here only so an invoice PDF doesn't
          // fall through into the lab-REPORT matching logic below as if it
          // were results data (it has no real sample data, which used to
          // trigger a false "may be filed under wrong domain" alert) —
          // marked processed and otherwise ignored, not filed or recorded
          // anywhere.
          if (isLabInvoiceText(text)) {
            await addLabelToMessage(accessToken, candidate.id, processedLabelId);
            continue candidateLoop;
          }

          const projectNumber = extractReportProjectNumber(text);
          let job: (Job & { customers: Customer & { companies: Company | null } }) | null = null;
          if (projectNumber) {
            const { data } = await supabase
              .from("jobs")
              .select("*, customers!customer_id(*, companies!company_id(*))")
              .ilike("project_number", projectNumber)
              .maybeSingle();
            job = data as unknown as (Job & { customers: Customer & { companies: Company | null } }) | null;
          } else {
            const reportAddress = extractReportProjectAddress(text);
            if (reportAddress) job = await findJobByReportAddress(supabase, reportAddress);
          }
          if (job) {
            matchedJob = job;
            matchedBuffer = data;
            matchedText = text;
            break;
          }
        } catch (e) {
          console.error(`lab-email: failed to parse attachment ${part.filename} on message ${candidate.id}:`, e);
        }
      }

      if (matchedJob && matchedBuffer) {
        // An invoice PDF can no longer reach here at all — the isLabInvoiceText
        // check above skips the whole candidate before matchedJob/matchedText
        // ever gets set from one (see its own comment).
        await processMatchedLabEmail({
          accessToken,
          messageId: candidate.id,
          job: matchedJob,
          pdfBuffer: matchedBuffer,
          pdfText: matchedText,
          subject,
          settings,
        });
        await addLabelToMessage(accessToken, candidate.id, processedLabelId);
        result.matched.push({ projectNumber: matchedJob.project_number ?? "", jobId: matchedJob.id });
        continue;
      }

      // Not a lab-report email — check whether it's EMSL's separate,
      // earlier "receipt confirmation" for a chain-of-custody form instead
      // (see extractProjectNumberFromCocSubject above).
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

// Every lab-email document append is one PDF per kind+service_type (one
// chain of custody, one lab report, one lab invoice, per service type) —
// but a message can legitimately get reprocessed (a "processed" Gmail label
// removed to fix a misfiled report, a drafting failure that leaves the
// message unread, a retried cron run), and every append site used to just
// push another row onto job.documents with no check for one already there.
// Confirmed live 2026-08-26 on 26-0007/26-0008 — reconciling the mold vs.
// asbestos misfile (see isMoldLabReport above) by clearing the processed
// label and rerunning checkForLabResultEmails duplicated the CoC and lab
// report documents on both jobs. This replaces any existing document(s) of
// the same kind+service_type instead of piling on a duplicate, and cleans
// up the superseded document's storage object so it doesn't just orphan.
async function replaceDocumentsByKindAndServiceType(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  existing: JobDocument[],
  incoming: JobDocument[]
): Promise<JobDocument[]> {
  const superseded = existing.filter((d) =>
    incoming.some((n) => n.kind === d.kind && n.service_type === d.service_type)
  );
  const kept = existing.filter((d) => !superseded.includes(d));
  // Confirmed live 2026-08-27 (26-0007) — a combined report's one PDF can
  // legitimately be filed under more than one label (see reportDocuments'
  // own comment), meaning two different kept/superseded rows can share the
  // same storage_path. Deleting a superseded row's file unconditionally
  // broke the OTHER row still pointing at it. Only delete a path nothing in
  // the final result (kept or incoming) still references.
  const stillReferenced = new Set([...kept, ...incoming].map((d) => d.storage_path));
  const pathsToDelete = superseded.map((d) => d.storage_path).filter((p) => !stillReferenced.has(p));
  if (pathsToDelete.length > 0) {
    await supabase.storage.from("job-documents").remove(pathsToDelete);
  }
  return [...kept, ...incoming];
}

// Shared by the lab-bundled path (processMatchedLabEmail, below) and the
// standalone EMSL receipt-confirmation path above — files a chain-of-
// custody PDF on the job the same way the manual "Chain of Custody" upload
// station does, so it shows up there without the admin re-uploading
// something that already landed in their inbox. `serviceType` lets a caller
// that already knows which domain this CoC belongs to (processMatchedLabEmail,
// which works it out from the report itself via isMoldLabReport) say so
// explicitly — without it, every CoC on a mixed asbestos+mold job silently
// landed under whichever label happened to be listed first on the job
// (confirmed live 2026-08-26/27, 26-0007/26-0008: every mold report's own
// trailing CoC page got filed as "Limited Asbestos Inspection"), leaving
// the Mold Report tab's own CoC station permanently empty. The standalone
// EMSL receipt-confirmation path (no report to detect a domain from) keeps
// the old first-label fallback.
async function uploadCocDocument(job: Job, pdfBuffer: Buffer, serviceType?: string): Promise<void> {
  const supabase = getSupabaseAdmin();
  const serviceTypeLabels = (job.service_type ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const primaryServiceType = serviceType ?? serviceTypeLabels[0] ?? "";

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
  const documents = await replaceDocumentsByKindAndServiceType(supabase, job.documents ?? [], [document]);
  await supabase.from("jobs").update({ documents }).eq("id", job.id);
}

// A job can legitimately carry MORE THAN ONE lab_invoice document under the
// very same service_type this way — a real weekly report showed 26-0007
// alone billed under three separate Sales Receipt numbers (6506/6510/6512)
// in one week — so, unlike replaceDocumentsByKindAndServiceType (used
// everywhere else in this file, which replaces by kind+service_type alone),
// this only ever replaces the one row matching this exact invoice/receipt
// number — idempotent against reprocessing the same weekly email, while
// leaving every other invoice number's own row on the job untouched.
function replaceLabInvoiceDocumentByNumber(existing: JobDocument[], incoming: JobDocument[], num: string): JobDocument[] {
  const kept = existing.filter((d) => !(d.kind === "lab_invoice" && d.lab_invoice_number === num));
  return [...kept, ...incoming];
}

interface UnmatchedWeeklySummaryTransaction {
  num: string;
  transactionType: string;
  projectNumber: string | null;
  address: string | null;
}

// Per Tim, 2026-08-28 — real money named on a real invoice that this system
// couldn't attach to any job deserves a page, not just a console.error
// nobody will ever read — a weekly-summary line skipping a job silently is
// a real miss since Tim called this "the golden document for tracking it
// all," and it's now the sole source of lab cost tracking.
async function alertUnmatchedWeeklySummaryTransactions(unmatched: UnmatchedWeeklySummaryTransaction[]): Promise<void> {
  await sendEmail({
    to: process.env.OWNER_EMAIL!,
    subject: `Weekly lab summary: ${unmatched.length} transaction(s) couldn't be matched to a job`,
    html: emailShell(`
      <p style="font-size:15px;">This week's Crystal Analytical weekly summary named transaction(s) that couldn't be matched to any job in this system:</p>
      <ul>
        ${unmatched
          .map((u) => {
            const reason = u.projectNumber
              ? `project number "${escapeHtml(u.projectNumber)}" printed on the invoice doesn't match any job`
              : u.address
                ? `no project number on this line (${escapeHtml(u.address)})`
                : "no project number on this line";
            return `<li>${escapeHtml(u.transactionType)} #${escapeHtml(u.num)} — ${reason}</li>`;
          })
          .join("")}
      </ul>
      <p>These charges are real (they're on the invoice) but aren't reflected on any job's lab cost yet — worth checking the weekly report PDF directly to reconcile.</p>
    `),
  }).catch(() => {});
}

// QuickBooks' own weekly rollup (see isWeeklyLabSummaryText/
// extractWeeklyLabSummaryTransactions in parse-lab-invoice.ts) — a second,
// independent source for the same Invoice-type charges the per-invoice-email
// path above already tracks (Crystal's own invoice number shows up in both
// places — the per-job dedup below, keyed on that same number, is what
// keeps the two from double-counting), but the ONLY source for Sales
// Receipt and Refund transactions, which never arrive as their own separate
// email. Per Tim, 2026-08-28 — "the golden document for tracking it all."
// Grouped by each transaction's own num first (Tim's own framing: "track
// each invoice and then all the jobs that it includes") — a single num can
// carry more than one line item for the same job (e.g. one real receipt,
// #6519, billed two mold sub-methods for 26-0008 as two separate lines), so
// amounts are summed per (num, projectNumber) before anything touches the
// database. Grouping this way, keyed on lab_invoice_number, is also exactly
// what BillingView's existing "All Lab Invoices" cards already group
// by — no new UI needed for this to show up there correctly.
async function processWeeklyLabSummaryEmail(params: {
  accessToken: string;
  messageId: string;
  pdfBuffer: Buffer;
  pdfText: string;
}): Promise<{
  recorded: { projectNumber: string; jobId: string; num: string }[];
  unmatched: UnmatchedWeeklySummaryTransaction[];
}> {
  const { accessToken, messageId, pdfBuffer, pdfText } = params;
  const supabase = getSupabaseAdmin();

  const transactions = extractWeeklyLabSummaryTransactions(pdfText);
  // Per Tim, 2026-08-28 — "I just really want to go off those weekly
  // reports... it should be the main outline": the report's own printed
  // grand total/billing period, not a total this system reconstructs
  // itself — set identically on every document this email produces (see
  // JobDocument's own comment) and grouped back together by contentHash,
  // computed once here since every job below gets the exact same
  // unmodified pdfBuffer re-uploaded as its own copy.
  const reportTotalCents = extractWeeklySummaryTotalCents(pdfText);
  const reportDateRange = extractWeeklySummaryDateRangeLabel(pdfText);
  const contentHash = createHash("sha256").update(pdfBuffer).digest("hex");

  // Per Tim, 2026-08-29 — "we need to fix stuff like that so that all
  // money is accounted for on a job number": confirmed live on this exact
  // report — Sales Receipt #6515 ($96, "11 James Way, Cambridge, MA") had
  // no project number printed on it at all, while #6519 ($80, the SAME
  // address) did, tagged "- 26-0008" — evidently the same job's samples
  // split across two lab order numbers, with Crystal's own export only
  // naming the project on one of them. Before falling back to "unmatched",
  // try resolving a project-number-less transaction by the SAME address
  // already confirmed elsewhere in THIS report — scoped to this one
  // report (not a global address search across every job ever) and only
  // when the address maps to exactly one project number, same
  // never-guess-through-an-ambiguity discipline as findJobByReportAddress's
  // own fallback above.
  const projectByNormalizedAddress = new Map<string, string | null>(); // null = ambiguous, don't use
  for (const t of transactions) {
    if (!t.projectNumber || !t.address) continue;
    const key = normalizeAddressForMatch(t.address);
    const existing = projectByNormalizedAddress.get(key);
    if (existing === undefined) {
      projectByNormalizedAddress.set(key, t.projectNumber);
    } else if (existing !== null && existing !== t.projectNumber) {
      projectByNormalizedAddress.set(key, null);
    }
  }

  const byNum = new Map<string, { transactionType: string; amountCentsByProject: Map<string, number> }>();
  const unmatched: UnmatchedWeeklySummaryTransaction[] = [];
  for (const t of transactions) {
    const resolvedProjectNumber = t.projectNumber ?? (t.address ? projectByNormalizedAddress.get(normalizeAddressForMatch(t.address)) ?? null : null);
    if (!resolvedProjectNumber) {
      unmatched.push({ num: t.num, transactionType: t.transactionType, projectNumber: null, address: t.address });
      continue;
    }
    if (!byNum.has(t.num)) byNum.set(t.num, { transactionType: t.transactionType, amountCentsByProject: new Map() });
    const group = byNum.get(t.num)!;
    group.amountCentsByProject.set(resolvedProjectNumber, (group.amountCentsByProject.get(resolvedProjectNumber) ?? 0) + t.amountCents);
  }

  const recorded: { projectNumber: string; jobId: string; num: string }[] = [];
  // One upload per JOB, not per num or globally — a job appearing under
  // several num-groups this week (26-0007 above) still only gets this same
  // weekly PDF's bytes stored once, same "own the job.id-prefixed path"
  // storage convention every other upload in this file already follows.
  const uploadedStoragePathByJobId = new Map<string, string>();

  for (const [num, group] of byNum) {
    for (const [projectNumber, amountCents] of group.amountCentsByProject) {
      const { data: job } = await supabase.from("jobs").select("*").ilike("project_number", projectNumber).maybeSingle();
      if (!job) {
        unmatched.push({ num, transactionType: group.transactionType, projectNumber, address: null });
        continue;
      }

      const existingDocsForNum = ((job.documents ?? []) as JobDocument[]).filter(
        (d) => d.kind === "lab_invoice" && d.lab_invoice_number === num
      );
      if (existingDocsForNum.length > 0) {
        // This exact transaction was already recorded — almost always by
        // this same weekly-summary pipeline on an earlier run (idempotent
        // reprocessing), but for a handful of jobs processed before the
        // weekly summary became the sole source (see checkForLabResultEmails'
        // own comment), it's the OLDER per-invoice-email pipeline's own
        // document, filed under Crystal's own per-invoice PDF rather than
        // this weekly one. Either way, the dollar amount is already
        // accounted for — recording it again here would double it. What's
        // still missing on that older case is this report's own
        // report_total_cents/report_date_range (added after that document
        // existed) — BillingView groups "Weekly Reports" by
        // report_date_range specifically, not content_hash (a job's
        // existing document keeps its OWN real PDF's hash, so forcing this
        // report's hash onto it would misattribute which file it actually
        // is), so filling this in is what's needed to recognize this job as
        // part of THIS report. Confirmed live 2026-08-28: without this
        // backfill, 26-0001 through 26-0005's real share of the report
        // showed up as "not linked to a job on file," which is backwards.
        // Only fills in fields that are still null — never touches
        // amount_cents, so the real dollar total this job already carries
        // can't change here.
        if (existingDocsForNum.some((d) => d.report_date_range == null)) {
          const enriched = (job.documents ?? []).map((d: JobDocument) =>
            d.kind === "lab_invoice" && d.lab_invoice_number === num && d.report_date_range == null
              ? { ...d, report_total_cents: d.report_total_cents ?? reportTotalCents, report_date_range: d.report_date_range ?? reportDateRange }
              : d
          );
          await supabase.from("jobs").update({ documents: enriched }).eq("id", job.id);
        }
        continue;
      }

      let storagePath = uploadedStoragePathByJobId.get(job.id);
      if (!storagePath) {
        const docId = randomUUID();
        storagePath = `${job.id}/${docId}-weekly-lab-summary.pdf`;
        await supabase.storage.from("job-documents").upload(storagePath, pdfBuffer, { contentType: "application/pdf" });
        uploadedStoragePathByJobId.set(job.id, storagePath);
      }

      const serviceTypeLabels = (job.service_type ?? "").split(",").map((s: string) => s.trim()).filter(Boolean);
      const uploadedAt = new Date().toISOString();
      const newDocuments: JobDocument[] = serviceTypeLabels.map((label: string) => ({
        id: randomUUID(),
        kind: "lab_invoice",
        service_type: label,
        file_name: `weekly-lab-summary-${num}.pdf`,
        storage_path: storagePath as string,
        uploaded_at: uploadedAt,
        project_number_mismatch: null,
        lab_invoice_number: num,
        amount_cents: amountCents,
        content_hash: contentHash,
        report_total_cents: reportTotalCents,
        report_date_range: reportDateRange,
      }));
      const mergedDocuments = replaceLabInvoiceDocumentByNumber(job.documents ?? [], newDocuments, num);

      await supabase
        .from("jobs")
        .update({
          documents: mergedDocuments,
          lab_cost_cents: computeLabCostCentsFromDocuments(mergedDocuments),
        })
        .eq("id", job.id);
      recorded.push({ projectNumber: job.project_number ?? projectNumber, jobId: job.id, num });
    }
  }

  await markMessageRead(accessToken, messageId);
  return { recorded, unmatched };
}

// Confirmed live 2026-08-26 (jobs 26-0007/26-0008, "Final Fungal Report
// for ..."): processMatchedLabEmail used to assume whichever service type
// was listed *first* on the job always matched whatever report just came
// in — true only when a mixed job's asbestos and mold results happen to
// arrive in that same order. When mold results land on a job listing
// asbestos first, they got silently run through the asbestos-only
// extractors (which naturally find nothing in a fungal report), leaving
// mold_sample_results empty forever with no error anywhere — the job just
// sits at "Pending Lab Results" permanently since it can never become
// complete. Crystal Analytical's own subject line reliably says "Fungal
// Report" for mold and never for asbestos (confirmed against every real
// example on file); that, not the job's own field order, is what actually
// says which domain this specific report is.
export function isMoldLabReport(subject: string, pdfText: string): boolean {
  return /fungal/i.test(subject) || /fungal/i.test(pdfText);
}

async function processMatchedLabEmail(params: {
  accessToken: string;
  messageId: string;
  job: Job & { customers: Customer & { companies: Company | null } };
  pdfBuffer: Buffer;
  pdfText: string;
  subject: string;
  settings: Settings;
}): Promise<void> {
  const { accessToken, messageId, job, pdfBuffer, pdfText, subject, settings } = params;
  const supabase = getSupabaseAdmin();

  const isMold = isMoldLabReport(subject, pdfText);
  const isAsbestos = !isMold;

  // A job's service_type can carry multiple labels of the *same* domain
  // (e.g. both "Mold Air Sampling" and "Mold Bulk Sampling"), and Crystal
  // Analytical bundles every mold sub-method the job ordered into one PDF/
  // one email — confirmed live 2026-08-26/27 on 26-0002 and 26-0008, where
  // a combined air+bulk report's bulk (Direct Analysis) samples were
  // silently dropped because only the domain's first label ever got
  // extracted. primaryServiceType still stands in for "the domain" wherever
  // only one value makes sense (mold_lab_name, the CoC's own label below);
  // domainServiceTypeLabels is what the per-label loops below actually walk.
  const serviceTypeLabels = (job.service_type ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const domainServiceTypeLabels = serviceTypeLabels.filter((label) => (isMold ? /mold/i.test(label) : !/mold/i.test(label)));
  const primaryServiceType = domainServiceTypeLabels[0] ?? serviceTypeLabels[0] ?? "";

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
  // Which of this job's own mold labels THIS report actually covers — not
  // necessarily all of them. Crystal Analytical usually bundles every mold
  // sub-method into one combined PDF (26-0008's own air+bulk report), but
  // confirmed live 2026-08-27 (26-0007) it can just as easily send air and
  // bulk as two entirely separate emails with their own Lab IDs. Reused
  // below for which label(s) to file the lab_report document under — filing
  // it under every mold label unconditionally overwrote 26-0007's real air
  // spore-trap report with this bulk-only PDF once both labels existed.
  const reportedMoldLabels = new Set<string>();
  if (isMold) {
    // One extraction pass per mold label the job actually has, not just
    // primaryServiceType — see the comment above on why a single combined
    // report can carry more than one label's own samples.
    const newCounts: Record<string, number> = {};
    const newResultsByLabel = new Map<string, ReturnType<typeof extractMoldSampleResults>>();
    for (const label of domainServiceTypeLabels) {
      const labelCount = extractMoldSampleCount(pdfText, label);
      if (labelCount != null) { newCounts[label] = labelCount; reportedMoldLabels.add(label); }
      const labelResults = extractMoldSampleResults(pdfText, label);
      if (labelResults.length > 0) { newResultsByLabel.set(label, labelResults); reportedMoldLabels.add(label); }
    }
    if (Object.keys(newCounts).length > 0) {
      update.sample_counts = { ...(job.sample_counts ?? {}), ...newCounts };
    }
    if (newResultsByLabel.size > 0) {
      // Replaces only the labels this pass actually found new samples for —
      // an untagged legacy row or a label this report doesn't cover at all
      // (e.g. a swab label with no swab data in this particular email)
      // stays exactly as it was.
      const touchedLabels = new Set(newResultsByLabel.keys());
      const priorOtherLabels = (job.mold_sample_results ?? []).filter((r) => !r.serviceType || !touchedLabels.has(r.serviceType));
      update.mold_sample_results = [...priorOtherLabels, ...[...newResultsByLabel.values()].flat()];
    }
  } else {
    const count = extractSampleCount(pdfText, positionOrderedText);
    if (count != null && primaryServiceType) {
      update.sample_counts = { ...(job.sample_counts ?? {}), [primaryServiceType]: count };
    }
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
  let asbestosDataFound = false;
  if (isAsbestos) {
    const asbestosResult = detectAsbestosResult(pdfText, positionOrderedText);
    if (asbestosResult != null) {
      update.asbestos_result = asbestosResult;
      asbestosDataFound = true;
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
    if (sampleResults.length > 0) {
      update.sample_results = sampleResults;
      asbestosDataFound = true;
      // Per Tim, 2026-08-31 — material for each positive result should
      // always be pre-filled from the lab report, not typed in by hand.
      // Only Crystal Analytical's layout has been verified (see
      // extractCrystalAnalyticalMaterialDescriptions) — labInfo may not be
      // set on this particular pass (only assigned when detectLabInfo finds
      // a name above), so this also falls back to the job's own already-
      // stored lab_name. Merges rather than replaces: an admin-entered
      // footage (estimated_quantity) on a prior pass must survive a
      // re-parse from a corrected/supplemental report, exactly like
      // sample_findings is kept separate from sample_results in the first
      // place (see that field's own comment in types.ts).
      const labName = (labInfo?.labName ?? job.lab_name ?? "").toLowerCase();
      if (positionOrderedText && labName.includes("crystal analytical")) {
        const materials = extractCrystalAnalyticalMaterialDescriptions(positionOrderedText);
        const existingByCode = new Map((job.sample_findings ?? []).map((f) => [f.fieldCode, f]));
        const findings = sampleResults
          .filter((s) => /%/.test(s.result))
          .map((s) => {
            const existing = existingByCode.get(s.fieldCode);
            return {
              fieldCode: s.fieldCode,
              material: materials[s.fieldCode] || existing?.material || "",
              estimated_quantity: existing?.estimated_quantity ?? "",
            };
          });
        if (findings.length > 0) update.sample_findings = findings;
      }
    }
  }
  // Per Tim, 2026-08-27 — isMoldLabReport's own "fungal" keyword is the
  // only thing standing between a report landing on the right domain or
  // the wrong one (this exact mistake — a mold report's content filed
  // under the asbestos label — has now happened twice, 26-0007/26-0008).
  // Independent of that keyword: whichever domain this report was just
  // classified into should also have actually produced real, parseable
  // data for that domain. When it didn't, isMoldLabReport's verdict is
  // likely wrong for this specific email — rather than silently filing a
  // report that doesn't match its own label, alert immediately so this
  // gets caught before a customer ever sees it, not after.
  const domainDataFound = isMold ? reportedMoldLabels.size > 0 : asbestosDataFound;
  if (!domainDataFound) {
    await sendEmail({
      to: process.env.OWNER_EMAIL!,
      subject: `Lab report may be filed under the wrong domain — ${job.project_number ?? job.id}`,
      html: emailShell(`
        <p style="font-size:15px;">This report was just filed on ${escapeHtml(job.project_number ?? job.id)} as <strong>${isMold ? "mold" : "asbestos"}</strong> (subject: "${escapeHtml(subject)}"), but no ${isMold ? "mold" : "asbestos"}-shaped results could actually be read out of it.</p>
        <p>That's exactly how the mold/asbestos mislabeling bug showed up before — this report is now held (the ${isMold ? "mold" : "asbestos"} report/invoice draft for this job won't build until it's resolved). Open the job's Laboratory Paperwork, replace this document with the right file, and it'll draft normally again.</p>
      `),
    }).catch(() => {});
  }

  // Crystal Analytical (and similarly-shaped labs) email back one PDF with
  // the typed lab data pages followed by the scanned, handwritten chain-of-
  // custody form as the trailing page(s) — never a separate attachment.
  // Split that off so it can be filed in the Chain of Custody station
  // instead of staying buried at the end of the Laboratory Results PDF
  // (and so the merged final report packet doesn't show that page twice —
  // it already includes both kinds of documents in order).
  const { reportBuffer, cocBuffer } = await splitTrailingCocPages(pdfBuffer);

  // File the lab's own PDF on the job the same way a manual upload does, so
  // it shows up on the Laboratory Paperwork tab and gets merged into the
  // downloadable report packet — not just used to extract numbers. One row
  // per mold label THIS report actually reported data for (same
  // one-copy-per-label approach processWeeklyLabSummaryEmail's own lab
  // invoice documents use) — not every mold label the job has: confirmed live wrong on
  // 26-0007, where filing an air+bulk *combo* report under every mold label
  // was right (26-0008), but filing a bulk-*only* report under "Mold Air
  // Sampling" too overwrote that label's real air spore-trap report with
  // the bulk-only PDF. Falls back to primaryServiceType alone in the
  // unexpected case where isMoldLabReport said yes but neither extractor
  // found anything on any label — still files the report somewhere rather
  // than silently dropping it.
  const reportLabels = isMold
    ? (reportedMoldLabels.size > 0 ? [...reportedMoldLabels] : [primaryServiceType])
    : [primaryServiceType];
  const docId = randomUUID();
  const storagePath = `${job.id}/${docId}-lab-report.pdf`;
  await supabase.storage.from("job-documents").upload(storagePath, reportBuffer, { contentType: "application/pdf" });
  const reportUploadedAt = new Date().toISOString();
  const reportDocuments: JobDocument[] = reportLabels.map((label) => ({
    id: randomUUID(),
    kind: "lab_report",
    service_type: label,
    file_name: "lab-report.pdf",
    storage_path: storagePath,
    uploaded_at: reportUploadedAt,
    project_number_mismatch: null,
    // Not just the alert email above — this is what actually stops
    // buildFinalReportPacket (report-packet.ts) from including this
    // document in a customer-facing report until someone clears it by
    // replacing it with the right file. See DomainMismatchError there.
    domain_mismatch: !domainDataFound,
  }));
  update.documents = await replaceDocumentsByKindAndServiceType(supabase, job.documents ?? [], reportDocuments);

  // sample_findings may not exist yet if its migration hasn't been run —
  // tolerate that rather than failing this whole automated intake (every
  // other field this pass extracted, plus the report document itself,
  // would otherwise be lost too) the same way documents/route.ts's manual
  // upload already tolerates asbestos_result/sample_results being new.
  let updatedRow: Record<string, unknown> | null = null;
  let updateError: { message?: string } | null = null;
  for (let attempt = 0; attempt <= 1; attempt++) {
    ({ data: updatedRow, error: updateError } = await supabase
      .from("jobs")
      .update(update)
      .eq("id", job.id)
      .select("*, customers!customer_id(*, companies!company_id(*))")
      .single());
    if (!updateError) break;
    if (!("sample_findings" in update) || !/sample_findings/i.test(updateError?.message ?? "")) break;
    delete update.sample_findings;
  }
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
    // documents array fresh and appends to it. Same reportLabels as the
    // report PDF itself, not just primaryServiceType — the trailing CoC
    // page(s) split off this same report cover whichever label(s) the
    // report data above actually covers (confirmed live 2026-08-27,
    // 26-0007: filing a bulk-only report's own CoC page under "Mold Air
    // Sampling" overwrote that label's real air-o-cell CoC with it).
    // Sequential, not Promise.all — each call reads job.documents, then
    // writes a replacement array back, so two calls sharing one stale
    // `updatedJob.documents` snapshot would race and the second write
    // would drop the first's new row. Re-reading between calls (rather
    // than restructuring uploadCocDocument itself, which the standalone
    // single-label EMSL COC path below also calls) keeps each call seeing
    // the previous one's result.
    if (cocBuffer) {
      for (const label of reportLabels) {
        await uploadCocDocument(updatedJob, cocBuffer, label);
        const { data: freshDocuments } = await supabase.from("jobs").select("documents").eq("id", job.id).single();
        if (freshDocuments) updatedJob.documents = freshDocuments.documents;
      }
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
    // Per Tim, 2026-08-28 — every Boston Harbor Water Restoration invoice
    // must also reach Jake, alongside whichever billing contact/job contact
    // already land above — not a per-job invoice_emails entry, since it
    // should apply company-wide without relying on it being typed in each
    // time.
    ...(pricedJob.customers.companies?.id === BOSTON_HARBOR_WATER_RESTORATION_COMPANY_ID
      ? ["jake@bostonharborwater.com"]
      : []),
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
    // Per Tim, 2026-08-27 — always exactly this, regardless of service
    // type(s) on the job.
    subject: `Inspection Invoice - ${expandAddress(pricedJob.service_address)}`,
    bodyHtml: invoiceDraftBodyHtml(pricedJob, settings, payNowUrl),
    attachments: [
      // Per Tim, 2026-08-27 — every PDF filename starts with the job
      // number, not the document type.
      { filename: `${pricedJob.project_number ?? job.id} Invoice.pdf`, mimeType: "application/pdf", content: invoicePdf },
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
      ...(payNowUrl ? ["", `<a href="${escapeHtml(payNowUrl)}">Link to pay</a>`] : []),
      "",
      `Should you have any questions, please contact our office at <span style="white-space:nowrap;">${escapeHtml(settings.business_phone)}</span>.`,
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
      { filename: `${pricedJob.project_number ?? job.id} Invoice.pdf`, mimeType: "application/pdf", content: invoicePdf },
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
 *
 * Per Tim, 2026-08-28 (26-0007/26-0008) — that payment_reversed_at guard
 * alone isn't enough on its own: it only protects a job *while* the flag
 * stays set, and dismissing the "Payment reversed — review needed" banner
 * (a completely normal thing to do once it's been reviewed) clears exactly
 * that flag, which used to leave the job wide open to a *later* redelivery
 * of the same original invoice.paid event re-marking it paid — Stripe
 * invoices stay "status: paid" forever even after the underlying charge is
 * refunded, so nothing here ever independently re-checked. Now this
 * verifies the underlying charge itself, every single call, regardless of
 * payment_reversed_at's current state: a refunded charge sets
 * payment_reversed_at (again, if needed) and stops here instead of ever
 * marking the job paid — so no caller of this function, present or future,
 * can reintroduce this class of bug by forgetting to check.
 */
export async function markJobPaid(jobId: string, source = "unknown"): Promise<void> {
  const supabase = getSupabaseAdmin();
  const { data: current } = await supabase
    .from("jobs")
    .select("paid_date, payment_reversed_at, project_number, stripe_invoice_id, notes")
    .eq("id", jobId)
    .maybeSingle();

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

  if (current?.stripe_invoice_id) {
    try {
      const stripe = getStripe();
      const invoice = await stripe.invoices.retrieve(current.stripe_invoice_id);
      const chargeId = typeof invoice.charge === "string" ? invoice.charge : invoice.charge?.id ?? null;
      if (chargeId) {
        const charge = await stripe.charges.retrieve(chargeId);
        if (charge.refunded || charge.amount_refunded > 0) {
          console.error(`markJobPaid: invoice.paid for job ${jobId} but its underlying charge is refunded ($${(charge.amount_refunded / 100).toFixed(2)}) — flagging instead of marking paid.`);
          await supabase.from("jobs").update({ payment_reversed_at: new Date().toISOString() }).eq("id", jobId).is("payment_reversed_at", null);
          return;
        }
      }
    } catch (e) {
      // Best-effort — a Stripe hiccup here must never block a genuinely
      // paid job from being recorded as paid; it just means this specific
      // safety check couldn't run this time.
      console.error(`markJobPaid: failed to verify refund status for job ${jobId}:`, e);
    }
  }

  const update: Record<string, unknown> = { status: "paid" };
  if (!current?.paid_date) {
    update.paid_date = new Date().toISOString().slice(0, 10);
  }
  // Per Tim, 2026-08-28 (26-0007/26-0008) — a permanent, visible audit
  // trail right on the job itself for every time this function actually
  // marks something paid: which caller triggered it (webhook, reconcile,
  // etc.) and when. Every write path that can mark a job paid was already
  // proven correct by direct testing, yet the job kept flipping back to
  // paid anyway with no way to tell which of them did it — this is so the
  // next occurrence is a one-look answer instead of another multi-hour
  // investigation.
  const auditLine = `[markJobPaid: ${source}, ${new Date().toISOString()}]`;
  update.notes = current?.notes ? `${current.notes}\n${auditLine}` : auditLine;
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
