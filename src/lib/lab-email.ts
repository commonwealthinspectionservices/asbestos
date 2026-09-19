import { randomUUID, createHash } from "crypto";
// Imports the implementation directly rather than the package root — see
// src/app/api/admin/jobs/[id]/documents/route.ts for why.
import pdfParse from "pdf-parse/lib/pdf-parse.js";
import { getSupabaseAdmin, updateJobToleratingMissingColumns } from "@/lib/supabase";
import { getSettingsFresh, primaryInspector } from "@/lib/settings";
import { deriveFullInspectionMaterials } from "@/lib/sample-items";
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
  getMessageBodyText,
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
  extractMoldDirectAnalysisFindings,
  summarizeMoldDirectAnalysisFindings,
  extractMoldSporeTrapFindings,
  summarizeMoldSporeTrapFindings,
  extractSampledDate,
  extractCrystalAnalyticalMaterialDescriptions,
  SPORE_TRAP_KNOWN_TAXA,
} from "@/lib/parse-lab-report";
import {
  isLabInvoiceText,
  isWeeklyLabSummaryText,
  extractWeeklyLabSummaryTransactions,
  extractWeeklySummaryTotalCents,
  extractWeeklySummaryDateRangeLabel,
  isLabSalesReceiptText,
  type WeeklyLabSummaryTransaction,
  extractLabSalesReceiptNumber,
  extractLabSalesReceiptLines,
} from "@/lib/parse-lab-invoice";
import { checkLabInvoiceLineItemPrice, identifyTestSubtype } from "@/lib/lab-pricing";
import { defaultInvoiceLineItems, invoiceLineItemsTotalCents } from "@/lib/invoice-defaults";
import { computeLabCostCentsFromDocuments } from "@/lib/lab-cost";
import { formatCents } from "@/lib/pricing";
import { createStripeInvoiceForJob, tagInvoiceEmailed, getStripe } from "@/lib/stripe";
import { splitTrailingCocPages } from "@/lib/split-lab-report-coc";
import { extractPositionOrderedText, extractSporeTrapSampleNames, extractSporeTrapTaxonColumns } from "@/lib/pdf-position-text";
import { jobReportDomains, domainForServiceTypeLabel, moldDiscussionFieldForLabel, isFullInspectionAsbestosJob, hasAllLabReports, ASBESTOS_NEGATIVE_REMARK, ASBESTOS_POSITIVE_REMARK, NEWTON_FIRE_FLOOD_COMPANY_ID, BOSTON_HARBOR_WATER_RESTORATION_COMPANY_ID, FLI_ENVIRONMENTAL_COMPANY_ID, reportEmailAttachmentFilename, type ReportDomain } from "@/lib/report-findings";
import { sendEmail, emailShell } from "@/lib/email";
import { sendJobPaidNotification } from "@/lib/booking-notify";
import { getAppUrl } from "@/lib/app-url";
import { escapeHtml } from "@/lib/html";
import { expandAddress, splitAddress } from "@/lib/address";
import type { Company, Customer, InvoiceLineItem, Job, JobDocument, JobWithCustomer, PricingZone, ServiceType, Settings } from "@/lib/types";

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
  /** Lab charges that were recorded but didn't check out against Crystal's own published pricing, or repeated the same test type under more than one lab order for the same job — see lib/lab-pricing.ts and 26-0015's real incident, 2026-09-04. */
  flaggedLabInvoices: number;
  /** A real lab report (recognized via detectLabInfo, not just any PDF) that couldn't be matched to any job — see alertUnmatchedLabReport's own comment and 26-0030's real incident, 2026-09-17. */
  unmatchedLabReports: number;
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
// Per Tim, 2026-09-03 — a review-link line under the signature on every
// report email (reportDraftBodyHtml, combinedDraftBodyHtml below), not
// the payment-reminder note further down — that one goes out before
// anything's actually been delivered, so asking for a review there
// would be premature. Per Tim, 2026-09-08 — dropped from
// invoiceDraftBodyHtml: an invoice-only email (no report attached) is
// the wrong moment to ask for a review.
const REVIEW_LINK_LINE = '<a href="https://g.page/r/CXrf5GqjFZJjECE/review">Leave a review</a>';

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
// same fallback as report-pdf.tsx's own sampledDate: requested_date is just
// whatever date happened to be in the intake email, not a real target date
// for a company like Boston Harbor that never requests a specific date/time
// at all (Tim schedules those himself once the request comes in). This
// draft body's own "Date of Sampling" line must always match whatever the
// attached report PDF itself shows, so it uses the exact same fallback
// chain. Per Tim, 2026-09-02 (26-0002.1) — confirmed_date (the job's own
// "Completed date") now leads that chain ahead of the domain-specific
// lab-extracted dates too: confirmed live wrong, Crystal Analytical's own
// reports said "Collected: August 28" while the job's own Completed date
// was August 27 — the job's own record of the visit is authoritative, not
// whatever a lab happened to print.
function bestSampledDate(job: Job): string | null {
  return job.confirmed_date ?? job.requested_date ?? job.lab_date_sampled ?? job.mold_date_sampled ?? job.lead_date_sampled;
}

// Per Tim, 2026-09-11 (26-0019) — a mixed asbestos+lead job whose Email
// tab checklist only had Asbestos Report checked still said "the final
// asbestos and lead inspection reports are attached" even though only the
// asbestos PDF actually went out. draftSelectedEmailForJob now passes its
// own caller-selected domains through here instead of this silently
// recomputing every domain on the job — see this function's other two
// callers (the always-whole-job auto-drafted report and combined paths)
// for why the default still has to fall back to that when no override is
// given.
function reportDraftBodyHtml(job: Job, settings: Settings, domainsOverride?: ReportDomain[]): string {
  const domains = domainsOverride ?? jobReportDomains(job.service_type);
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
    "",
    REVIEW_LINK_LINE,
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
export function invoiceDraftBodyHtml(job: Job & { customers?: Customer }, settings: Settings, payNowUrl: string | null): string {
  // Street on its own line, city/state/zip on the next — same split
  // JobsDashboard.tsx's own mobile address rendering uses.
  const { street, cityStateZip } = splitAddress(job.service_address);
  // Per Tim, 2026-09-14 — Newton Fire & Flood is the one company excluded
  // from the ACH-only restriction on new invoices (see
  // createStripeInvoiceForJob's own comment — they keep a card on file,
  // charged automatically), so calling this a bank transfer specifically
  // would be wrong for them; every other company's invoice really is ACH
  // only now. customers is optional here (unlike combinedDraftBodyHtml,
  // which already required it) since invoiceDraftBodyHtml predates this
  // company-specific wording and some callers may not have it attached —
  // undefined just falls through to the safe, always-true "Link to pay".
  const payLinkPrefix = job.customers?.company_id === NEWTON_FIRE_FLOOD_COMPANY_ID
    ? ""
    : "Pay online by bank transfer: ";
  // Confirmed live 2026-09-03 (26-0014, a mold-only job) — this always
  // said "the asbestos inspection" regardless of what the job actually
  // was. reportDraftBodyHtml above already derives this correctly from
  // the job's real service type(s); this just never matched it.
  const domainPhrase = reportDomainListPhrase(jobReportDomains(job.service_type));
  return [
    "Hi,",
    "",
    `Please find attached the invoice for the ${domainPhrase} inspection completed at:`,
    "",
    escapeHtml(expandAddress(street)),
    escapeHtml(expandAddress(cityStateZip)),
    // Per Tim, 2026-09-03 — individual/homeowner jobs only: this invoice
    // can go out well before the report does (see the homeowner payment
    // gate — autoDraftReportIfJustPaid/processMatchedLabEmail), unlike a
    // company job, where payment never gates the report at all. Never
    // shown on a company invoice — it would just be wrong there.
    ...(job.is_individual ? ["", "<em>Payment must be completed in order for results to be sent out.</em>"] : []),
    // Per Tim, 2026-09-14 — tried leading with "mail a check to avoid a
    // fee" ahead of this, then pulled it back out the same day: just the
    // link, labeled as bank transfer since that's what it actually is now
    // for every company but Newton (see payLinkPrefix above). No "Total
    // due" dollar figure in the email body itself (the attached PDF and
    // the pay link both already show it); "Link to pay", not all-caps.
    ...(payNowUrl ? ["", `${payLinkPrefix}<a href="${escapeHtml(payNowUrl)}">Link to pay</a>`] : []),
    "",
    // The phone number itself never wraps mid-digit — see reportDraftBodyHtml's own comment on this.
    `If you have any questions, please call Tim at <span style="white-space:nowrap;">${escapeHtml(settings.business_phone)}</span>`,
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

// Per Tim, 2026-09-10 — FLI Environmental's combined drafts get a
// shorter sign-off than everyone else's: no "call me with questions"
// line, no second signature line ("Commonwealth Inspection Services"),
// no review-link — just "Tim Hall". Dave is a working subcontract
// relationship, not a homeowner or a new referral source being asked
// to leave a review; confirmed against a real drafted example he
// pointed to directly as the standard to lock in.
function combinedDraftBodyHtml(job: Job & { customers: Customer }, settings: Settings, totalCents: number, payNowUrl: string | null, domainsOverride?: ReportDomain[]): string {
  // Per Tim, 2026-09-17 — "the order that they are listed out in should be
  // the order that they are attached in": the actual attachments always
  // come out in the job's own natural service_type order (see
  // buildAllFinalReportPackets, which derives from jobReportDomains
  // regardless of what order a caller's own domain selection happened to
  // list them in), but this bullet list used to just map over
  // domainsOverride's own raw array order — whatever order the Email tab
  // checklist's domain checkboxes happened to submit in, not necessarily
  // matching. Re-deriving from the job's natural order (filtered down to
  // just what's actually included) keeps both in sync regardless of
  // selection order.
  const domains = domainsOverride
    ? jobReportDomains(job.service_type).filter((d) => domainsOverride.includes(d))
    : jobReportDomains(job.service_type);
  const isFliEnvironmental = job.customers.company_id === FLI_ENVIRONMENTAL_COMPANY_ID;
  // Per Tim, 2026-09-14 — same reasoning as invoiceDraftBodyHtml's own
  // comment: Newton is excluded from the ACH-only restriction (they keep
  // a card on file), so "bank transfer" would be wrong for them
  // specifically — every other company's invoice really is ACH only now.
  const payLinkPrefix = job.customers.company_id === NEWTON_FIRE_FLOOD_COMPANY_ID
    ? ""
    : "Pay online by bank transfer: ";
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
    ...(payNowUrl ? ["", `${payLinkPrefix}<a href="${escapeHtml(payNowUrl)}">Link to pay</a>`] : []),
    "",
    ...(isFliEnvironmental
      ? ["Tim Hall"]
      : [
          `Should you have any questions or need additional information, please contact me at <span style="white-space:nowrap;">${escapeHtml(settings.business_phone)}</span>.`,
          "",
          ...SIGNATURE_LINES,
          "",
          REVIEW_LINK_LINE,
        ]),
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
// habits the way is:unread can. Per Tim, 2026-09-02 — "name them what they
// are": renamed from the old flat "cis-lab-email-processed".
const PROCESSED_LABEL = "Processed/Lab Reports";
// Confirmed live 2026-09-02: the PROCESSED_LABEL rename above silently
// broke the "already handled" check for every message labeled under the
// old name — checkForLabResultEmails below only ever compared a message's
// labelIds against the CURRENT name's label id, so real, already-drafted
// lab emails for jobs 26-0002/26-0007/26-0008 matched as fresh candidates
// again and re-fired their "landed" notifications. Checking both the old
// and new label id from now on means a future rename here can't do this
// again — see job-intake.ts's matching LEGACY_PROCESSED_LABEL comment.
const LEGACY_PROCESSED_LABEL = "cis-lab-email-processed";

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
    // Reconcile status every time this is called, not just on the
    // just-detected-sent transition below — that one-shot advance can lose
    // a race against JobsDashboard.tsx's own "bump to ready_to_send once
    // reportComplete" effect (fires whenever the dialog opens, regardless
    // of send state) if the invoice was confirmed sent by this function
    // while status was still earlier than "ready_to_send" (e.g. caught by
    // the cron before anyone had opened the job to advance it that far).
    // That left jobs like 26-0017 permanently stuck showing "Ready for
    // Review" even after both report and invoice were actually sent — see
    // project_tech_decisions memory. Safe to re-check unconditionally.
    const invoiceAlreadySent = kind === "invoice" ? true : Boolean(job?.[otherSentAtCol]);
    if (invoiceAlreadySent && job?.status === "ready_to_send") {
      await supabase.from("jobs").update({ status: "report_invoice_sent" }).eq("id", jobId);
    }
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
    // Per Tim, 2026-09-16 — merge this confirmed-sent event's report
    // domain(s) into report_sent_domains (see that field's own comment in
    // types.ts), so a multi-domain job can say exactly which domain(s)
    // have actually gone out instead of one shared report_sent_at. A
    // report was just confirmed sent whenever this check is itself the
    // report kind, or a combined draft (one Gmail send covers both) —
    // same condition as the SENT_REPORTS_LABEL logic below. Its own
    // isolated select+update, wrapped separately from the write above —
    // this is a secondary, additive signal on top of report_sent_at, not
    // a replacement for it, and must never block that real write (or run
    // on a database that hasn't had this migration applied yet).
    if (kind === "report" || isCombinedDraft) {
      try {
        const { data: domainsRow } = await supabase
          .from("jobs")
          .select("report_draft_domains, report_sent_domains")
          .eq("id", jobId)
          .maybeSingle<{ report_draft_domains: string[] | null; report_sent_domains: Record<string, string> | null }>();
        const draftDomains = Array.isArray(domainsRow?.report_draft_domains) ? domainsRow.report_draft_domains : [];
        if (draftDomains.length > 0) {
          const mergedSentDomains = { ...(domainsRow?.report_sent_domains ?? {}) };
          for (const domain of draftDomains) mergedSentDomains[domain] = finalSentAt;
          await supabase.from("jobs").update({ report_sent_domains: mergedSentDomains }).eq("id", jobId);
        }
      } catch (e) {
        console.error(`Failed to merge report_sent_domains for job ${jobId}:`, e);
      }
    }
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

// Per Tim, 2026-09-11 (26-0024) — checkDraftSentStatus's own "reconcile
// every time this is called" fix (see its comment above, from the earlier
// 26-0017 incident) only ever helps a job that's still getting called at
// all: check-sent-drafts' own query only selects a job with at least one
// of report_sent_at/invoice_sent_at still null, and the Final Report tab's
// own live-check effect (useDraftTracking in JobsDashboard.tsx) stops
// calling it too once its sentAt is already known — so a job whose BOTH
// sends land close enough together that status was still "ready_to_send"
// at the wrong instant (network jitter, cron cadence, no strict ordering
// guarantee between the two checks) can get permanently skipped by every
// path that would otherwise have caught and fixed it. Confirmed live on
// 26-0024: report sent 17:19, invoice sent 17:23, status stuck on "Ready
// for Review" — manually re-running checkDraftSentStatus fixed it
// instantly, proving the reconcile logic itself was fine, just never
// invoked again once both timestamps were already on file. This is that
// safety net: sweeps every job with both real send timestamps whose status
// hasn't advanced past ready_to_send yet, independent of whichever path
// missed it.
export async function reconcileFullySentJobStatuses(): Promise<{ fixed: string[] }> {
  const supabase = getSupabaseAdmin();
  const { data: jobs } = await supabase
    .from("jobs")
    .select("id, project_number")
    .not("report_sent_at", "is", null)
    .not("invoice_sent_at", "is", null)
    .eq("status", "ready_to_send");

  const fixed: string[] = [];
  for (const job of jobs ?? []) {
    await supabase.from("jobs").update({ status: "report_invoice_sent" }).eq("id", job.id);
    fixed.push(job.project_number ?? job.id);
  }
  return { fixed };
}

// Per Tim, 2026-09-02 — "name them what they are": renamed from the old
// flat "cis-bounce-processed".
const BOUNCE_PROCESSED_LABEL = "Processed/Bounces";
// See PROCESSED_LABEL's own LEGACY_PROCESSED_LABEL comment above — same
// rename bug, same fix, applied here too.
const LEGACY_BOUNCE_PROCESSED_LABEL = "cis-bounce-processed";

// Detects a real Gmail bounce (Mail Delivery Subsystem's "Delivery Status
// Notification (Failure)") for a report/invoice this app already marked
// sent, and undoes that — report_sent_at/invoice_sent_at (and the status
// advance that follows from them, see checkDraftSentStatus above) only
// ever meant "Gmail showed this as sent," which happens the instant Tim
// hits Send regardless of whether the address behind it actually exists.
// Per Tim, 2026-09-01 — confirmed live on job 26-0011
// (dave@flienvironmental.com — the whole domain doesn't resolve, NXDOMAIN):
// the tracker had already advanced to "Payment Pending" for an email
// nobody ever received. Matches the bounce back to its original send via
// Gmail's own rfc822msgid search on the bounce's In-Reply-To header —
// confirmed live to be far more reliable than this app's own stored
// *_draft_gmail_message_id columns, which go stale the moment Gmail
// assigns the sent copy a new message id on send (exactly what happened
// here) — then to a job via the address in that original message's own
// subject line (every report/invoice/combined draft's subject is "<label>
// - <service address>", see threadSubject).
export async function checkForBouncedSends(): Promise<{
  checked: number;
  reverted: { projectNumber: string | null; jobId: string; bouncedAddress: string }[];
}> {
  const accessToken = await getValidAccessToken();
  if (!accessToken) throw new Error("Gmail is not connected");
  const supabase = getSupabaseAdmin();
  const processedLabelId = await getOrCreateLabelId(accessToken, BOUNCE_PROCESSED_LABEL);
  const legacyProcessedLabelId = await getOrCreateLabelId(accessToken, LEGACY_BOUNCE_PROCESSED_LABEL);

  // in:anywhere — confirmed live 2026-09-01 that Gmail (or Tim, reading it)
  // can leave a bounce notice sitting in Trash rather than the inbox; a
  // rare, specific sender like mailer-daemon makes searching that broadly
  // safe here, unlike the wide-open lab-report candidate search elsewhere.
  const candidates = await listMessagesByQuery(accessToken, `from:mailer-daemon newer_than:14d in:anywhere`);
  const reverted: { projectNumber: string | null; jobId: string; bouncedAddress: string }[] = [];

  for (const candidate of candidates) {
    try {
      const message = await getMessage(accessToken, candidate.id);
      if (message.labelIds?.includes(processedLabelId) || message.labelIds?.includes(legacyProcessedLabelId)) continue;

      const subject = getHeader(message, "Subject") ?? "";
      if (!/delivery status notification|undeliverable|delivery.*fail/i.test(subject)) {
        await addLabelToMessage(accessToken, candidate.id, processedLabelId);
        continue;
      }

      const body = getMessageBodyText(message);
      const addressMatch =
        body.match(/wasn't delivered to ([^\s]+@[^\s]+?) because/i) ??
        body.match(/message to ([^\s]+@[^\s]+?) (?:couldn't|could not) be delivered/i);
      const bouncedAddress = addressMatch?.[1]?.replace(/[.,]+$/, "").toLowerCase() ?? null;

      const inReplyTo = getHeader(message, "In-Reply-To") ?? getHeader(message, "References")?.trim().split(/\s+/).pop() ?? null;

      if (!bouncedAddress || !inReplyTo) {
        await addLabelToMessage(accessToken, candidate.id, processedLabelId);
        continue;
      }

      const rawMsgId = inReplyTo.replace(/^<|>$/g, "");
      const originalCandidates = await listMessagesByQuery(accessToken, `rfc822msgid:${rawMsgId} in:anywhere`);
      const original = originalCandidates[0];
      if (!original) {
        await addLabelToMessage(accessToken, candidate.id, processedLabelId);
        continue;
      }
      const originalMessage = await getMessage(accessToken, original.id);
      const originalSubject = getHeader(originalMessage, "Subject") ?? "";
      const addressPart = originalSubject.includes(" - ") ? originalSubject.split(" - ").slice(1).join(" - ") : null;
      if (!addressPart) {
        await addLabelToMessage(accessToken, candidate.id, processedLabelId);
        continue;
      }

      const normalizedTarget = normalizeAddressForMatch(addressPart);
      const { data: sentJobs } = await supabase
        .from("jobs")
        .select("*, customers!customer_id(*, companies!company_id(*))")
        .or("report_sent_at.not.is.null,invoice_sent_at.not.is.null");
      const matches = (sentJobs ?? []).filter((j) => {
        const normalizedService = normalizeAddressForMatch(j.service_address ?? "");
        return normalizedService.startsWith(normalizedTarget) || normalizedTarget.startsWith(normalizedService);
      });

      if (matches.length !== 1) {
        if (matches.length > 1) {
          console.error(`checkForBouncedSends: bounce for "${addressPart}" matched more than one recently-sent job (${matches.map((j) => j.project_number).join(", ")}) — needs a human to sort out, not guessing.`);
        }
        await addLabelToMessage(accessToken, candidate.id, processedLabelId);
        continue;
      }
      const job = matches[0] as unknown as Job & { customers: Customer & { companies: Company | null } };

      // Confirm the bounced address actually plausibly belongs to this
      // job's own send before touching anything — the address match above
      // narrows to one job, this confirms it's the right *email*, not just
      // the right property.
      const knownAddresses = [job.customers?.email, ...(job.report_emails?.split(",") ?? []), job.subcontractor_client_contact_email]
        .filter((e): e is string => Boolean(e))
        .map((e) => e.trim().toLowerCase());
      if (!knownAddresses.includes(bouncedAddress)) {
        await addLabelToMessage(accessToken, candidate.id, processedLabelId);
        continue;
      }

      // A combined draft (createCombinedDraftForJob — see checkDraftSentStatus's
      // own comment) writes the same Gmail draft id into both report_draft_gmail_id
      // and invoice_draft_gmail_id — one send covers both, so one bounce means
      // neither actually arrived.
      const wasCombined = Boolean(job.report_draft_gmail_id) && job.report_draft_gmail_id === job.invoice_draft_gmail_id;
      const update: Record<string, unknown> = {};
      if (job.report_sent_at) {
        update.report_sent_at = null;
        update.report_draft_gmail_id = null;
        update.report_draft_gmail_message_id = null;
        update.report_drafted_at = null;
      }
      if (wasCombined && job.invoice_sent_at) {
        update.invoice_sent_at = null;
        update.invoice_draft_gmail_id = null;
        update.invoice_draft_gmail_message_id = null;
        update.invoice_drafted_at = null;
      }
      if (job.status === "report_invoice_sent" && (wasCombined || !job.invoice_sent_at)) {
        update.status = "ready_to_send";
      }
      await supabase.from("jobs").update(update).eq("id", job.id);

      await sendEmail({
        to: process.env.OWNER_EMAIL!,
        subject: `Email bounced — ${job.project_number ?? job.id} was NOT actually delivered`,
        html: emailShell(`
          <p style="font-size:15px;"><strong>${escapeHtml(bouncedAddress)}</strong> doesn't exist — the report/invoice you sent for this job never reached anyone.</p>
          <p>This job's status has been reverted back to "Ready for Review" so it doesn't look like it went out, and the old draft has been cleared. Fix the recipient's email address, then create a fresh draft and resend.</p>
        `),
      }).catch(() => {});

      reverted.push({ projectNumber: job.project_number, jobId: job.id, bouncedAddress });
      await addLabelToMessage(accessToken, candidate.id, processedLabelId);
    } catch (e) {
      console.error(`checkForBouncedSends: failed to process bounce candidate ${candidate.id}:`, e);
    }
  }

  return { checked: candidates.length, reverted };
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
  // Per Tim, 2026-09-16 — found via 26-0025 ($650 base fee baked into a
  // real invoice, standard rate actually $450): this cron pricing every
  // auto-drafted invoice off a stale cached Settings read is the real root
  // cause — see getSettingsFresh's own comment.
  const settings = await getSettingsFresh();
  const processedLabelId = await getOrCreateLabelId(accessToken, PROCESSED_LABEL);
  const legacyProcessedLabelId = await getOrCreateLabelId(accessToken, LEGACY_PROCESSED_LABEL);
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

  const result: LabEmailCheckResult = { checked: 0, matched: [], cocUploaded: [], labInvoicesRecorded: [], unmatched: 0, flaggedLabInvoices: 0, unmatchedLabReports: 0 };

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
      if (message.labelIds?.includes(processedLabelId) || message.labelIds?.includes(legacyProcessedLabelId)) continue;
      const pdfParts = findPdfParts(message.payload);

      let matchedJob: (Job & { customers: Customer & { companies: Company | null } }) | null = null;
      let matchedBuffer: Buffer | null = null;
      let matchedText = "";
      // Kept even when they don't lead to a match, purely so the "couldn't
      // match this report" alert below can tell Tim what the pipeline
      // actually tried, instead of just "no match" with nothing to go on.
      let lastProjectNumber: string | null = null;
      let lastReportAddress: string | null = null;
      // Whether ANY part of this message was recognized as a real lab
      // report at all — confirmed live on 26-0030 (a genuine Crystal
      // Analytical mold report) that extractReportProjectNumber and
      // extractReportProjectAddress both returned null on: this PDF's
      // two-column layout (a project-info box beside a full disclaimer
      // paragraph) interleaves the position-ordered text badly enough that
      // neither extractor found the address or number actually printed on
      // it. detectLabInfo matching plain "Crystal Analytical"/"EMSL" text
      // is a much lower bar and is what still recognizes it as a real
      // report worth alerting on below, even when the more specific
      // extractors come up empty.
      let recognizedAsLabReport = false;

      for (const part of pdfParts) {
        try {
          const data = await getAttachmentData(accessToken, candidate.id, part.attachmentId);
          const { text } = await parsePdfWithRetry(data, `${candidate.id}:${part.filename}`);
          if (detectLabInfo(text)) recognizedAsLabReport = true;

          // QuickBooks' own weekly rollup (see processWeeklyLabSummaryEmail)
          // needs its own path checked first, same reasoning as the
          // multi-job invoice check right below it — one PDF, many jobs.
          if (isWeeklyLabSummaryText(text)) {
            const { recorded, unmatched, flagged } = await processWeeklyLabSummaryEmail({
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
            result.flaggedLabInvoices += flagged.length;
            if (flagged.length > 0) {
              console.error(
                `lab-email: weekly summary on message ${candidate.id} had suspicious charge(s): ${flagged
                  .map((f) => `${f.projectNumber} #${f.num} — ${f.reason}`)
                  .join("; ")}`
              );
              await alertSuspiciousLabInvoiceCharges(flagged).catch(() => {});
            }
            continue candidateLoop;
          }

          // Per Tim, 2026-09-04 — after a real "Sales Receipt - Additional
          // Jobs" credit-card-charge email fell through both checks above
          // and got misfiled as a fake lab_report on job 26-0013 (caught
          // only by luck via domain_mismatch): "every single PDF that
          // Crystal Analytical ever sends us should be tracked... and
          // accessible." This template is a third, distinct shape (its own
          // "SALES <n>" numbering, not the weekly summary's per-line Num or
          // the older "Invoice no.:" template) that isLabInvoiceText below
          // doesn't recognize. Filed under every job it covers (see
          // processLabSalesReceiptEmail) — but never counted toward
          // lab_cost_cents, since "the weekly summary is the sole source
          // for lab cost tracking" (below) still holds: this receipt's own
          // "SALES" number is a different namespace than the weekly
          // summary's per-line Num, so counting both risks double-billing
          // the same real charge once it shows up there too.
          if (isLabSalesReceiptText(text)) {
            const { flagged: receiptFlagged } = await processLabSalesReceiptEmail({ messageId: candidate.id, pdfBuffer: data, pdfText: text });
            await addLabelToMessage(accessToken, candidate.id, processedLabelId);
            if (receiptFlagged.length > 0) {
              console.error(`lab-email: sales receipt on message ${candidate.id} had unmatched line(s): ${receiptFlagged.join("; ")}`);
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
          if (projectNumber) lastProjectNumber = projectNumber;
          let job: (Job & { customers: Customer & { companies: Company | null } }) | null = null;
          if (projectNumber) {
            const { data } = await supabase
              .from("jobs")
              .select("*, customers!customer_id(*, companies!company_id(*))")
              .ilike("project_number", projectNumber)
              .maybeSingle();
            job = data as unknown as (Job & { customers: Customer & { companies: Company | null } }) | null;
            // Per Tim, 2026-08-31 — a report's own printed project number is
            // whatever was written on the physical COC form when the sample
            // was submitted, which for a revisit (Tim's own "26-0002.1" for
            // a revisit to "26-0002" — see is_revisit's own comment in
            // types.ts) is often just the base number, not the ".1" suffix.
            // Confirmed live: 26-0002.1's own mold results landed on
            // 26-0002 instead — already fully sent 4 days earlier — which
            // re-triggered a fresh, wrong auto-draft on a job whose story
            // was already over. An exact match that's already closed
            // (report_sent_at set) can't sanely be who new lab data is
            // for, so prefer an open revisit of it when one exists, over
            // the closed exact match.
            if (job?.report_sent_at) {
              const { data: revisit } = await supabase
                .from("jobs")
                .select("*, customers!customer_id(*, companies!company_id(*))")
                .ilike("project_number", `${projectNumber}.%`)
                .is("report_sent_at", null)
                .order("created_at", { ascending: false })
                .limit(1)
                .maybeSingle();
              if (revisit) job = revisit as unknown as (Job & { customers: Customer & { companies: Company | null } });
            }
          }
          // Per Tim, 2026-08-31 — a report never resolving to a match here
          // even with a projectNumber extracted isn't necessarily "no such
          // job": confirmed live on 26-0011 (an FLI Environmental
          // subcontract job, see FLI_ENVIRONMENTAL_COMPANY_ID's own
          // comment) — Crystal Analytical's own "FLI Project#:" field is
          // the same "26-NNNN" shape as this app's own project_number
          // (FLI runs its own numbering the same way), so the generic
          // fallback in extractReportProjectNumber genuinely finds a real
          // number on the report — just FLI's, not this app's, since a
          // report for a job submitted under FLI's own lab account never
          // mentions this app's project number anywhere at all. Falling
          // back to the address match here (not just when no number was
          // found at all) catches that case without needing to first
          // detect "this must be an FLI job" — same address match already
          // used for every other report with no extractable number.
          if (!job) {
            const reportAddress = extractReportProjectAddress(text);
            if (reportAddress) {
              lastReportAddress = reportAddress;
              job = await findJobByReportAddress(supabase, reportAddress);
            }
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

      // Per Tim, 2026-09-17 — 26-0030's real mold report sat unread and
      // unlabeled indefinitely: recognized as a genuine Crystal Analytical
      // report (recognizedAsLabReport) but never matched to a job, this
      // used to just increment `unmatched` and move on with no alert and
      // no read/label, so it was silently re-checked and re-failed on
      // every future run forever. A real report Tim needs to know about
      // now gets a page (same reasoning as alertUnmatchedWeeklySummaryTransactions
      // above) and is marked processed so it doesn't loop — the alert
      // itself is the "handled" outcome now, same as job-intake.ts's own
      // alertOwnerOfIntakeIssue.
      if (recognizedAsLabReport) {
        await alertUnmatchedLabReport({ subject, projectNumber: lastProjectNumber, address: lastReportAddress });
        await markMessageRead(accessToken, candidate.id);
        await addLabelToMessage(accessToken, candidate.id, processedLabelId);
        result.unmatchedLabReports++;
        continue;
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

interface SuspiciousLabInvoiceCharge {
  num: string;
  projectNumber: string;
  reason: string;
}

// Per Tim, 2026-09-04, after the real 26-0015 duplicate-charge incident —
// same "a real dollar figure deserves a page, not a console.error" reasoning
// as alertUnmatchedWeeklySummaryTransactions below, for the other way a
// weekly summary can be wrong: not missing a job, but charging the right
// job an amount that doesn't check out against Crystal's own pricing (see
// lib/lab-pricing.ts). Recorded either way — this is a "look at this,"
// not a silent rejection — the flag also lands on the JobDocument itself
// (lab_invoice_flag) so it's visible on the job later too.
async function alertSuspiciousLabInvoiceCharges(flagged: SuspiciousLabInvoiceCharge[]): Promise<void> {
  if (flagged.length === 0) return;
  await sendEmail({
    to: process.env.OWNER_EMAIL!,
    subject: `Weekly lab summary: ${flagged.length} charge(s) look worth double-checking`,
    html: emailShell(`
      <p style="font-size:15px;">This week's Crystal Analytical weekly summary had charge(s) that didn't check out against their own published pricing, or that repeat the same test type under more than one lab order for the same job:</p>
      <ul>
        ${flagged
          .map((f) => `<li>Job ${escapeHtml(f.projectNumber)}, lab order #${escapeHtml(f.num)} — ${escapeHtml(f.reason)}</li>`)
          .join("")}
      </ul>
      <p>These were still recorded as real lab cost — this is a "worth a look," not something held back. Each one is also flagged on the job's own Lab Invoice document for reference.</p>
    `),
  }).catch(() => {});
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

// Per Tim, 2026-09-17 — a real 26-0030 incident: Crystal Analytical's own
// mold report for the job arrived, but its two-column layout (a
// project-info box beside a full disclaimer paragraph) interleaved badly
// enough in position-ordered text that neither extractReportProjectNumber
// nor extractReportProjectAddress found the number/address actually
// printed on it, so nothing in this system ever connected the report to
// its job. Recognized as a real report at all only via detectLabInfo
// (a much lower bar — just "does the text mention a known lab") rather
// than a project-number/address match, which is exactly the case a plain
// "no match" fallthrough can't tell apart from an ordinary PDF that has
// nothing to do with lab results — see recognizedAsLabReport's own comment.
async function alertUnmatchedLabReport(params: { subject: string; projectNumber: string | null; address: string | null }): Promise<void> {
  await sendEmail({
    to: process.env.OWNER_EMAIL!,
    subject: `A lab report couldn't be matched to a job: ${params.subject}`,
    html: emailShell(`
      <p style="font-size:15px;">A PDF that looks like a real lab report (Crystal Analytical or EMSL) came in but couldn't be matched to any job:</p>
      <p><strong>Subject:</strong> ${escapeHtml(params.subject)}</p>
      <p><strong>What was found on the report itself:</strong> ${
        params.projectNumber
          ? `project number "${escapeHtml(params.projectNumber)}" — doesn't match any job on file`
          : params.address
            ? `address "${escapeHtml(params.address)}" — doesn't match any job on file`
            : "nothing — the report's own project number/address didn't parse out of this PDF at all"
      }</p>
      <p>This report is marked as handled so it won't keep resurfacing, but it still needs to be filed onto the right job by hand from your inbox.</p>
    `),
  }).catch(() => {});
}

// Per Tim, 2026-09-04 — "every single PDF that Crystal Analytical ever
// sends us should be tracked in my admin side and should be accessible."
// Confirmed real: a "Sales Receipt - Additional Jobs" credit-card-charge
// email fell through both isWeeklyLabSummaryText and isLabInvoiceText and
// got misfiled as a fake lab_report on job 26-0013. Files a copy of the
// receipt under every job it covers — but deliberately with
// amount_cents: null (computeLabCostCentsFromDocuments already skips a
// null amount, so this never touches lab_cost_cents), since this
// receipt's own "SALES <n>" number is a different namespace than the
// weekly summary's per-line "Num" — the weekly summary stays the sole
// source for real dollars (see processWeeklyLabSummaryEmail below), this
// is purely for "the actual document should be on the project page."
async function processLabSalesReceiptEmail(params: {
  messageId: string;
  pdfBuffer: Buffer;
  pdfText: string;
}): Promise<{ recorded: { projectNumber: string; jobId: string }[]; flagged: string[] }> {
  const { pdfBuffer, pdfText } = params;
  const supabase = getSupabaseAdmin();
  const salesNumber = extractLabSalesReceiptNumber(pdfText);
  const lines = extractLabSalesReceiptLines(pdfText);
  const contentHash = createHash("sha256").update(pdfBuffer).digest("hex");
  // Prefixed so this can never collide with a bare weekly-summary Num,
  // which lives in its own numbering namespace (see the comment above).
  const labInvoiceNumber = `receipt-${salesNumber ?? contentHash.slice(0, 8)}`;

  const recorded: { projectNumber: string; jobId: string }[] = [];
  const flagged: string[] = [];
  const uploadedStoragePathByJobId = new Map<string, string>();

  for (const line of lines) {
    if (!line.projectNumber) {
      flagged.push(`no project number on line: "${line.testDescription}" (${line.address ?? "no address"})`);
      continue;
    }
    const { data: job } = await supabase.from("jobs").select("*").ilike("project_number", line.projectNumber).maybeSingle();
    if (!job) {
      flagged.push(`no job found for ${line.projectNumber}`);
      continue;
    }

    const existingDocsForNum = ((job.documents ?? []) as JobDocument[]).filter(
      (d) => d.kind === "lab_invoice" && d.lab_invoice_number === labInvoiceNumber
    );
    if (existingDocsForNum.length > 0) continue; // already filed — idempotent reprocessing

    let storagePath = uploadedStoragePathByJobId.get(job.id);
    if (!storagePath) {
      const docId = randomUUID();
      storagePath = `${job.id}/${docId}-lab-sales-receipt.pdf`;
      await supabase.storage.from("job-documents").upload(storagePath, pdfBuffer, { contentType: "application/pdf" });
      uploadedStoragePathByJobId.set(job.id, storagePath);
    }

    const serviceTypeLabels = (job.service_type ?? "").split(",").map((s: string) => s.trim()).filter(Boolean);
    const uploadedAt = new Date().toISOString();
    const newDocuments: JobDocument[] = serviceTypeLabels.map((label: string) => ({
      id: randomUUID(),
      kind: "lab_invoice",
      service_type: label,
      file_name: `lab-sales-receipt-${salesNumber ?? "unknown"}.pdf`,
      storage_path: storagePath as string,
      uploaded_at: uploadedAt,
      project_number_mismatch: null,
      lab_invoice_number: labInvoiceNumber,
      amount_cents: null,
      content_hash: contentHash,
      lab_invoice_flag: `Billing record only (Sales Receipt #${salesNumber ?? "?"}) — not counted toward lab cost.`,
    }));
    const mergedDocuments = replaceLabInvoiceDocumentByNumber(job.documents ?? [], newDocuments, labInvoiceNumber);
    await supabase.from("jobs").update({ documents: mergedDocuments }).eq("id", job.id);
    recorded.push({ projectNumber: job.project_number ?? line.projectNumber, jobId: job.id });
  }

  return { recorded, flagged };
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
interface JobForTransactionMatching {
  projectNumber: string;
  serviceAddress: string;
  company: string | null;
}

async function loadJobsForTransactionMatching(supabase: ReturnType<typeof getSupabaseAdmin>): Promise<JobForTransactionMatching[]> {
  const { data } = await supabase.from("jobs").select("project_number, service_address, customers!customer_id(company)");
  return ((data ?? []) as unknown as { project_number: string | null; service_address: string | null; customers: { company: string | null } | null }[])
    .filter((j) => j.project_number)
    .map((j) => ({ projectNumber: j.project_number!, serviceAddress: j.service_address ?? "", company: j.customers?.company ?? null }));
}

// The street line only ("14 Heather St., Beverley MA" → "14heatherstreet"),
// so a misspelled or missing town/zip can't stop two spellings of the same
// street address matching.
function streetKey(address: string): string {
  return normalizeAddressForMatch(address.split(",")[0]);
}

export function matchTransactionToJobGlobally(address: string | null, jobs: JobForTransactionMatching[]): string | null {
  const trimmed = address?.trim();
  if (!trimmed) return null;
  let matches: JobForTransactionMatching[];
  if (/^\d/.test(trimmed)) {
    const key = streetKey(trimmed);
    if (key.length < 5) return null;
    matches = jobs.filter((j) => streetKey(j.serviceAddress) === key);
  } else {
    const name = trimmed.toLowerCase();
    matches = jobs.filter((j) => j.company && (j.company.toLowerCase().includes(name) || name.includes(j.company.toLowerCase())));
  }
  const projects = new Set(matches.map((j) => j.projectNumber));
  return projects.size === 1 ? [...projects][0] : null;
}

async function processWeeklyLabSummaryEmail(params: {
  accessToken: string;
  messageId: string;
  pdfBuffer: Buffer;
  pdfText: string;
}): Promise<{
  recorded: { projectNumber: string; jobId: string; num: string }[];
  unmatched: UnmatchedWeeklySummaryTransaction[];
  flagged: SuspiciousLabInvoiceCharge[];
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

  // Per Tim, 2026-09-19 — three real Crystal charges (#6723 $504 for 58
  // Parker Rd, #6739 $44 billed to just "Restore to New", #6791 $48 for
  // "14 Heather St., Beverley") never attached to a job: none printed a
  // project number, and the only fallback above needs a sibling line in the
  // SAME report that does. Last resort: look across every job on file —
  // by the street line alone (number + street name, ignoring how the town or
  // zip happens to be spelled), or, when the "address" is really a company
  // name, by that company — and only accept a match that's unambiguous.
  const jobsForMatching = await loadJobsForTransactionMatching(supabase);
  const resolveProjectNumber = (t: { projectNumber: string | null; address: string | null }): string | null =>
    t.projectNumber
    ?? (t.address ? projectByNormalizedAddress.get(normalizeAddressForMatch(t.address)) ?? null : null)
    ?? matchTransactionToJobGlobally(t.address, jobsForMatching);

  const byNum = new Map<string, { transactionType: string; amountCentsByProject: Map<string, number> }>();
  const unmatched: UnmatchedWeeklySummaryTransaction[] = [];
  for (const t of transactions) {
    const resolvedProjectNumber = resolveProjectNumber(t);
    if (!resolvedProjectNumber) {
      unmatched.push({ num: t.num, transactionType: t.transactionType, projectNumber: null, address: t.address });
      continue;
    }
    if (!byNum.has(t.num)) byNum.set(t.num, { transactionType: t.transactionType, amountCentsByProject: new Map() });
    const group = byNum.get(t.num)!;
    group.amountCentsByProject.set(resolvedProjectNumber, (group.amountCentsByProject.get(resolvedProjectNumber) ?? 0) + t.amountCents);
  }

  // Per Tim, 2026-09-04, after a real $405 duplicate charge on 26-0015
  // sailed through unnoticed for a day: two independent checks against
  // Crystal's own published pricing (see lib/lab-pricing.ts, transcribed
  // from the general pricing sheet Tim sent the same day) — (1) does the
  // per-sample rate actually billed match their rate for that test+tier,
  // and (2) did this job get billed the same test family under more than
  // one lab order number IN THIS SAME REPORT (26-0015's actual failure
  // mode: #6593's 30 samples and #6602's 34 samples, both "PLM - Bulk CVE,
  // Per-Layer," when the real delivered report only ever showed one
  // 34-sample batch). Scoped to this one report, not a lookback across
  // every prior week — catching it here at least means it can't sail
  // through silently again, even though it wouldn't have caught 26-0015
  // itself (that already happened before this code existed).
  const flagged: SuspiciousLabInvoiceCharge[] = [];
  const flagReasonByNum = new Map<string, string>();
  const subtypeEntriesByProject = new Map<string, { subtype: string; num: string; quantity: number }[]>();
  for (const t of transactions) {
    const resolvedProjectNumber = resolveProjectNumber(t);
    if (!resolvedProjectNumber || !t.testDescription) continue;

    // Per Tim, 2026-09-04 — keep this short. It shows as a banner on the
    // job's own document card (JobsDashboard's DocumentStation), not just
    // an email — a one-liner, not a paragraph.
    const priceCheck = checkLabInvoiceLineItemPrice(t.testDescription, t.unitPriceCents);
    if (!priceCheck.ok && priceCheck.expectedUnitPriceCents != null) {
      const reason = `Billed ${formatCents(t.unitPriceCents)}/sample, expected ${formatCents(priceCheck.expectedUnitPriceCents)}/sample.`;
      flagged.push({ num: t.num, projectNumber: resolvedProjectNumber, reason });
      flagReasonByNum.set(t.num, reason);
    } else if (priceCheck.expectedUnitPriceCents == null) {
      // "yes" to also flagging what the price check couldn't even verify,
      // not just confirmed mismatches (lib/lab-pricing.ts's
      // identifyTestFamily/identifyTurnaroundTier both came back empty).
      const reason = `Unrecognized test/turnaround — price not verified (billed ${formatCents(t.unitPriceCents)}/sample).`;
      flagged.push({ num: t.num, projectNumber: resolvedProjectNumber, reason });
      flagReasonByNum.set(t.num, reason);
    }

    // Per Tim, 2026-09-18 — found via 26-0002.1 and 26-0032, both falsely
    // flagged: this used to group by priceCheck.family, which is right for
    // price-checking (Direct Examination and Spore Trap price identically)
    // but wrong here — a job legitimately gets billed both as separate,
    // real charges all the time, and that grouping read them as "the same
    // test billed twice." identifyTestSubtype splits them back apart
    // (everything else only has one real subtype today, so it's
    // unaffected) — see its own comment in lib/lab-pricing.ts.
    const subtype = identifyTestSubtype(t.testDescription);
    if (subtype) {
      if (!subtypeEntriesByProject.has(resolvedProjectNumber)) subtypeEntriesByProject.set(resolvedProjectNumber, []);
      subtypeEntriesByProject.get(resolvedProjectNumber)!.push({ subtype, num: t.num, quantity: t.quantity });
    }
  }
  for (const [projectNumber, entries] of subtypeEntriesByProject) {
    const numsBySubtype = new Map<string, Set<string>>();
    for (const e of entries) {
      if (!numsBySubtype.has(e.subtype)) numsBySubtype.set(e.subtype, new Set());
      numsBySubtype.get(e.subtype)!.add(e.num);
    }
    for (const [, nums] of numsBySubtype) {
      if (nums.size < 2) continue;
      const numList = [...nums];
      const reason = `Possible duplicate — same test billed under lab orders #${numList.join(", #")}.`;
      flagged.push({ num: numList.join(", "), projectNumber, reason });
      for (const num of numList) flagReasonByNum.set(num, reason);
    }
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
        // this weekly one. What's still missing on that older case is this
        // report's own report_total_cents/report_date_range (added after
        // that document existed) — BillingView groups "Weekly Reports" by
        // report_date_range specifically, not content_hash (a job's
        // existing document keeps its OWN real PDF's hash, so forcing this
        // report's hash onto it would misattribute which file it actually
        // is), so filling this in is what's needed to recognize this job as
        // part of THIS report. Confirmed live 2026-08-28: without this
        // backfill, 26-0001 through 26-0005's real share of the report
        // showed up as "not linked to a job on file," which is backwards.
        //
        // Per Tim, 2026-09-13 — confirmed live (26-0002.1's own #6568
        // among others): Crystal re-sends this same weekly summary
        // repeatedly as the week goes on, with a growing cumulative total
        // — a job's own charge under a given lab order number can show a
        // LARGER amount on a later resend than what an earlier resend
        // already recorded here. The dedup above only ever checked
        // "does a document for this num already exist," never whether its
        // amount still matches this resend — so a corrected/topped-up
        // charge under the same num was silently kept at its stale,
        // smaller amount forever (confirmed: a real ~$900 gap against
        // QuickBooks traced back to exactly this).
        //
        // Only ever moves the amount UP, never down — messages aren't
        // guaranteed to process in send order (retries, pagination,
        // catching up after downtime), and an out-of-order older resend
        // must never be able to undo a correct, larger amount a later one
        // already recorded. A genuine downward correction from Crystal
        // (rare) won't self-heal this way and would need a manual fix —
        // an accepted tradeoff for never silently losing money instead.
        const existingAmount = existingDocsForNum[0].amount_cents;
        const amountIncreased = amountCents > (existingAmount ?? -Infinity);
        const needsBackfill = existingDocsForNum.some((d) => d.report_date_range == null);
        if (amountIncreased) {
          console.error(
            `lab-email: weekly summary #${num} for ${job.project_number ?? job.id} increased from ${existingAmount == null ? "(unset)" : formatCents(existingAmount)} to ${formatCents(amountCents)} on a resend — updating.`
          );
        }
        if (amountIncreased || needsBackfill) {
          const enriched = (job.documents ?? []).map((d: JobDocument) =>
            d.kind === "lab_invoice" && d.lab_invoice_number === num
              ? {
                  ...d,
                  amount_cents: amountIncreased ? amountCents : d.amount_cents,
                  report_total_cents: amountIncreased ? reportTotalCents : d.report_total_cents ?? reportTotalCents,
                  report_date_range: d.report_date_range ?? reportDateRange,
                }
              : d
          );
          await supabase
            .from("jobs")
            .update({ documents: enriched, lab_cost_cents: computeLabCostCentsFromDocuments(enriched) })
            .eq("id", job.id);
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
        lab_invoice_flag: flagReasonByNum.get(num) ?? null,
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
  return { recorded, unmatched, flagged };
}


/**
 * Re-runs the real weekly-summary pipeline on one specific QuickBooks/Crystal
 * summary email — for a charge that was in the report but never made it onto
 * a job (a parse failure on an earlier pass, or one the matcher couldn't
 * place before matchTransactionToJobGlobally existed). Safe to repeat: a
 * transaction already recorded on its job is left alone (see the
 * existingDocsForNum handling in processWeeklyLabSummaryEmail).
 */
export async function reprocessLabSummaryMessage(messageId: string): Promise<{
  recorded: { projectNumber: string; jobId: string; num: string }[];
  unmatched: UnmatchedWeeklySummaryTransaction[];
  flagged: SuspiciousLabInvoiceCharge[];
}> {
  const accessToken = await getValidAccessToken();
  if (!accessToken) throw new Error("Gmail is not connected");
  const message = await getMessage(accessToken, messageId);
  for (const part of findPdfParts(message.payload)) {
    const data = await getAttachmentData(accessToken, messageId, part.attachmentId);
    const { text } = await parsePdfWithRetry(data, `${messageId}:${part.filename}`, 8);
    if (!isWeeklyLabSummaryText(text)) continue;
    const outcome = await processWeeklyLabSummaryEmail({ accessToken, messageId, pdfBuffer: data, pdfText: text });
    const processedLabelId = await getOrCreateLabelId(accessToken, PROCESSED_LABEL);
    await addLabelToMessage(accessToken, messageId, processedLabelId);
    if (outcome.unmatched.length > 0) await alertUnmatchedWeeklySummaryTransactions(outcome.unmatched).catch(() => {});
    return outcome;
  }
  throw new Error("No weekly lab summary PDF found on that message");
}


export interface LabReconciliationResult {
  summaryEmailsChecked: number;
  unreadableSummaryEmails: number;
  hoursSinceLastReadableSummary: number | null;
  transactionsChecked: number;
  missingCharges: { num: string; expectedCents: number; recordedCents: number; address: string | null; projectNumber: string | null }[];
  totalMismatches: { subject: string; printedCents: number; rowsCents: number }[];
}

/**
 * Per Tim, 2026-09-19 — three real Crystal charges (#6723 $504, #6739 $44,
 * #6791 $48) sat in QuickBooks for a week without ever landing on a job,
 * silently: the QuickBooks summary PDFs fail to read fairly often and the
 * pipeline just retried quietly. Independent of the pipeline's own labels,
 * this re-reads every recent QuickBooks/Crystal summary email itself and
 * checks three things: (1) every charge in them is actually on a job, at the
 * right amount (per receipt number, across all jobs); (2) each report's own
 * printed total equals the sum of the rows this app parsed from it; (3) a
 * readable summary has come in recently. Read-only — reports, never fixes.
 */
export async function runLabReconciliation(): Promise<LabReconciliationResult> {
  const accessToken = await getValidAccessToken();
  if (!accessToken) throw new Error("Gmail is not connected");
  const supabase = getSupabaseAdmin();

  const messages = await listMessagesByQuery(accessToken, `from:quickbooks@notification.intuit.com subject:"Crystal Analytical" subject:Summary newer_than:21d`);
  const result: LabReconciliationResult = {
    summaryEmailsChecked: 0,
    unreadableSummaryEmails: 0,
    hoursSinceLastReadableSummary: null,
    transactionsChecked: 0,
    missingCharges: [],
    totalMismatches: [],
  };

  // Deduped by receipt number + line identity — Crystal re-sends the same
  // report cumulatively, so the same line appears in many emails.
  const linesByKey = new Map<string, WeeklyLabSummaryTransaction>();
  let newestReadableAt = 0;
  for (const m of messages) {
    const message = await getMessage(accessToken, m.id);
    const subject = getHeader(message, "Subject") ?? "";
    const sentAt = Number(message.internalDate ?? 0);
    for (const part of findPdfParts(message.payload)) {
      result.summaryEmailsChecked++;
      let text: string;
      try {
        const data = await getAttachmentData(accessToken, m.id, part.attachmentId);
        text = (await parsePdfWithRetry(data, `${m.id}:${part.filename}`, 8)).text;
      } catch {
        result.unreadableSummaryEmails++;
        continue;
      }
      if (!isWeeklyLabSummaryText(text)) continue;
      newestReadableAt = Math.max(newestReadableAt, sentAt);
      const rows = extractWeeklyLabSummaryTransactions(text);
      const printed = extractWeeklySummaryTotalCents(text);
      const rowsCents = rows.reduce((sum, t) => sum + t.amountCents, 0);
      if (printed != null && printed !== rowsCents) result.totalMismatches.push({ subject, printedCents: printed, rowsCents });
      for (const t of rows) {
        linesByKey.set([t.num, t.date, t.amountCents, t.address, t.testDescription].join("|"), t);
      }
    }
  }
  result.hoursSinceLastReadableSummary = newestReadableAt ? Math.round((Date.now() - newestReadableAt) / 3600000) : null;

  const expectedByNum = new Map<string, { cents: number; address: string | null; projectNumber: string | null }>();
  for (const t of linesByKey.values()) {
    const e = expectedByNum.get(t.num);
    if (e) e.cents += t.amountCents;
    else expectedByNum.set(t.num, { cents: t.amountCents, address: t.address, projectNumber: t.projectNumber });
  }
  result.transactionsChecked = expectedByNum.size;

  const { data: jobs } = await supabase.from("jobs").select("documents");
  const recordedByNum = new Map<string, number>();
  for (const job of (jobs ?? []) as { documents: JobDocument[] | null }[]) {
    const seenForJob = new Map<string, number>();
    for (const d of job.documents ?? []) {
      if (d.kind !== "lab_invoice" || d.amount_cents == null || !d.lab_invoice_number) continue;
      if (!seenForJob.has(d.lab_invoice_number)) seenForJob.set(d.lab_invoice_number, d.amount_cents);
    }
    for (const [num, cents] of seenForJob) recordedByNum.set(num, (recordedByNum.get(num) ?? 0) + cents);
  }
  for (const [num, e] of expectedByNum) {
    const recorded = recordedByNum.get(num) ?? 0;
    if (recorded !== e.cents) {
      result.missingCharges.push({ num, expectedCents: e.cents, recordedCents: recorded, address: e.address, projectNumber: e.projectNumber });
    }
  }
  return result;
}

export async function alertLabReconciliationProblems(result: LabReconciliationResult): Promise<boolean> {
  const stale = result.hoursSinceLastReadableSummary == null || result.hoursSinceLastReadableSummary > 36;
  if (result.missingCharges.length === 0 && result.totalMismatches.length === 0 && !stale) return false;
  const { escapeHtml } = await import("@/lib/html");
  const parts: string[] = [];
  if (result.missingCharges.length > 0) {
    parts.push(`<p style="font-size:15px;"><strong>Crystal charges that aren't (fully) on a job:</strong></p><ul>${result.missingCharges
      .map((c) => `<li>#${escapeHtml(c.num)} — Crystal billed ${formatCents(c.expectedCents)}, recorded ${formatCents(c.recordedCents)}${c.address ? ` (${escapeHtml(c.address)})` : ""}${c.projectNumber ? ` [${escapeHtml(c.projectNumber)}]` : ""}</li>`)
      .join("")}</ul>`);
  }
  if (result.totalMismatches.length > 0) {
    parts.push(`<p style="font-size:15px;"><strong>A report's printed total doesn't match the charges read from it</strong> (a row may have been missed):</p><ul>${result.totalMismatches
      .map((m) => `<li>${escapeHtml(m.subject)} — printed ${formatCents(m.printedCents)}, rows add up to ${formatCents(m.rowsCents)}</li>`)
      .join("")}</ul>`);
  }
  if (stale) {
    parts.push(`<p style="font-size:15px;"><strong>No readable Crystal summary in ${result.hoursSinceLastReadableSummary == null ? "the last 3 weeks" : `the last ${result.hoursSinceLastReadableSummary} hours`}.</strong> ${result.unreadableSummaryEmails} summary PDF(s) failed to read.</p>`);
  }
  await sendEmail({
    to: process.env.OWNER_EMAIL!,
    subject: `Lab costs need a look: ${result.missingCharges.length} unrecorded charge(s)${stale ? ", summaries unreadable" : ""}`,
    html: emailShell(`${parts.join("")}<p style="font-size:13px;color:#64748b;">Checked ${result.transactionsChecked} Crystal receipts from ${result.summaryEmailsChecked} summary emails against what's recorded on jobs. This repeats daily until it's resolved.</p>`),
  }).catch(() => {});
  return true;
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
    // Per Tim, 2026-09-17 — "every mold air sampling or bulk sampling or
    // anything should always just have the findings listed in the
    // discussion of results" — pre-fills each label's OWN Discussion of
    // Results (not the shared Conclusions & Recommendations field this
    // used to write into — see mold_air_discussion's own comment in
    // types.ts for why that's the one that actually renders under each
    // label's own report section) with a plain summary of what that
    // label's own report actually found, always something (an elevated
    // finding, a Trace/Light background note, or "no significant
    // amplification" for air) rather than nothing. Only when the field is
    // still empty — never overwrites an admin's own hand-written notes,
    // same as report_summary's own auto-fill above. One extraction pass
    // per label this report covers, same loop as the counts/results
    // extraction above — a combined air+bulk report fills in both
    // sections' own discussion fields in the same pass.
    if (positionOrderedText) {
      for (const label of domainServiceTypeLabels) {
        const discussionField = moldDiscussionFieldForLabel(label);
        if (!discussionField || job[discussionField]?.trim()) continue;
        let sentences: string[] = [];
        if (/air/i.test(label)) {
          // extractSporeTrapSampleNames reads the raw PDF's own text items
          // directly, anchored to each sample's own field-code column (see
          // its own comment for why that's needed — a wrapped name broke
          // naive same-line reading) — best-effort, since a missing/
          // unresolvable Sample Name row just means the sentence below
          // falls back to "Sample <field code>" instead of a real room name.
          const sampleNames = await extractSporeTrapSampleNames(pdfBuffer).catch(() => null);
          // extractSporeTrapTaxonColumns resolves a taxon's per-column
          // values by their own on-page position — needed whenever a cell
          // is genuinely blank/undetected, which the flattened text alone
          // can't safely attribute to a column (see its own comment and
          // 26-0030's real incident: a taxon undetected in the baseline
          // sample was silently dropped along with a real "Elevated"
          // finding elsewhere in the same row).
          const taxonColumnsByPage = await extractSporeTrapTaxonColumns(pdfBuffer, SPORE_TRAP_KNOWN_TAXA).catch(() => null);
          const sporeTrap = extractMoldSporeTrapFindings(positionOrderedText, sampleNames, taxonColumnsByPage);
          if (sporeTrap) sentences = summarizeMoldSporeTrapFindings(sporeTrap);
        } else {
          const findings = extractMoldDirectAnalysisFindings(positionOrderedText);
          sentences = summarizeMoldDirectAnalysisFindings(findings);
        }
        if (sentences.length > 0) update[discussionField] = sentences.join(" ");
      }
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
      let resultsWithMaterial = sampleResults;
      if (positionOrderedText && labName.includes("crystal analytical")) {
        const materials = extractCrystalAnalyticalMaterialDescriptions(positionOrderedText);
        // Per Tim, 2026-09-01 — "list out ... all the details for each one
        // of them": material is now shown for EVERY sample row (not just
        // positive ones), so it's merged onto sample_results itself here —
        // sample_findings below stays positive-only, it's still just the
        // hand-editable footage estimate for the report's summary table.
        resultsWithMaterial = sampleResults.map((s) => (materials[s.fieldCode] ? { ...s, material: materials[s.fieldCode] } : s));
        const existingByCode = new Map((job.sample_findings ?? []).map((f) => [f.fieldCode, f]));
        const findings = sampleResults
          .filter((s) => /%/.test(s.result))
          .map((s) => {
            const existing = existingByCode.get(s.fieldCode);
            return {
              fieldCode: s.fieldCode,
              material: materials[s.fieldCode] || existing?.material || "",
              estimated_quantity: existing?.estimated_quantity ?? "",
              unit: existing?.unit ?? "sq_ft",
            };
          });
        if (findings.length > 0) update.sample_findings = findings;
      }
      update.sample_results = resultsWithMaterial;

      // Per Tim, 2026-09-11 (26-0026) — "Total Materials Sampled" only
      // counts what's actually logged in the Materials Sampled table, and
      // that table used to require every homogeneous material typed in by
      // hand (15-20+ on a real Full Inspection job). Fills in whatever
      // field codes aren't already covered by an existing (hand-edited)
      // row — see deriveFullInspectionMaterials' own comment.
      if (isFullInspectionAsbestosJob(job.service_type)) {
        update.full_inspection_materials = deriveFullInspectionMaterials(resultsWithMaterial, job.full_inspection_materials ?? []);
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

  // Per Tim, 2026-09-17 — same rule as the manual upload route (see
  // hasAllLabReports' own comment): the automated pipeline landing the
  // last label's own report is just as much "the lab results came in" as
  // an admin uploading it by hand.
  if (job.status === "pending_lab_results" && hasAllLabReports(job.service_type, update.documents as JobDocument[])) {
    update.status = "ready_to_send";
  }

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

    // Per Tim, 2026-08-31 — "if a job includes mold at all, an automatic
    // draft should never be created because there's always manual work
    // that I need to do for mold": mixed or mold-only, no invoice or
    // report auto-drafts here — assertMoldReportReady already blocked the
    // report half (mold_report_notes is never filled in yet at this
    // point), but the invoice half had no such gate and was drafting
    // unconditionally regardless of mold. Just file the results and
    // notify; the manual "Create Invoice Draft"/"Create Report Draft"
    // buttons are the only path to a draft from here for any mold job.
    if (jobReportDomains(updatedJob.service_type).includes("mold")) {
      await sendEmail({
        to: process.env.OWNER_EMAIL!,
        subject: `Lab results landed (mold job — no auto-draft) — ${updatedJob.project_number ?? updatedJob.id}`,
        html: emailShell(`
          <p style="font-size:15px;">Lab results just came in and were filed on this job. No invoice or report was auto-drafted — this job includes mold, which always needs your own Conclusions &amp; Recommendations added by hand first.</p>
          <p>Add that on the job's Final Report tab, then use "Create Invoice Draft" / "Create Report Draft" when it's ready.</p>
        `),
      }).catch(() => {});
      return;
    }

    // Invoice always goes out the moment lab results land — unless it's
    // already paid. Per Tim, 2026-09-02 — an individual/homeowner job can
    // now be invoiced and paid before lab results even exist (manual
    // sample-count entry on the Invoice tab), specifically so the report
    // can go out the moment results land instead of waiting on payment
    // then. A paid job doesn't need a second invoice redrafted/resent, and
    // recomputing invoice_line_items from the just-landed real sample
    // count here would silently drift invoice_total_cents away from what
    // was actually charged — createStripeInvoiceForJob never touches an
    // already-paid Stripe invoice (see its own comment), so redrafting
    // would leave the invoice PDF quoting a different total than what the
    // customer actually paid. Invoice pricing happens inside
    // draftInvoiceEmailForJob — shared with the manual "Create Invoice
    // Draft" button so both paths price and persist the invoice exactly
    // the same way.
    if (updatedJob.status !== "paid") {
      await draftInvoiceEmailForJob({ job: updatedJob, settings, accessToken });
    }
    // The report follows immediately too, unless this job is flagged
    // individual-billed (job.is_individual) and not already paid — those
    // are normally held back until autoDraftReportIfJustPaid releases them
    // once the job is marked Paid, with the customer getting a short
    // notice instead, saying the report is ready and waiting on payment.
    // If it's already paid by the time results land (the early-invoice
    // flow above), release the report right now instead — a stale "pay to
    // receive it" reminder would be wrong for someone who's already paid.
    let draftedWhat: string;
    if (!updatedJob.is_individual || updatedJob.status === "paid") {
      await draftReportEmailForJob({ job: updatedJob, settings, accessToken });
      draftedWhat = updatedJob.status === "paid"
        ? "A report draft was created automatically and is waiting in Gmail"
        : "Invoice and report drafts were created automatically and are waiting in Gmail";
    } else {
      await draftPaymentReminderForIndividual({ job: updatedJob, settings, accessToken });
      draftedWhat = "An invoice draft was created, and a payment-reminder email went out — the report itself stays held until they pay";
    }

    // Per Tim, 2026-09-16 — "some sort of email automation... that tells
    // me when lab results have landed for a single job": the mold branch
    // above already had its own "no auto-draft" version of this; every
    // other job silently drafted and moved on with no notification at
    // all. This is that same notification for the common case, so every
    // job (not just mold) gets a heads-up the moment results land —
    // fires once per job, never a bundled multi-job email, since
    // processMatchedLabEmail itself only ever matches one job per lab
    // results email (Crystal's own multi-job bundling only happens on
    // lab_invoice-kind weekly/daily summary PDFs, handled by a separate
    // path that never reaches this function).
    await sendEmail({
      to: process.env.OWNER_EMAIL!,
      subject: `Lab results landed — ${updatedJob.project_number ?? updatedJob.id}`,
      html: emailShell(`
        <p style="font-size:15px;">Lab results just came in for ${escapeHtml(expandAddress(updatedJob.service_address))} and were filed on this job.</p>
        <p>${draftedWhat}, ready for your review.</p>
      `),
    }).catch(() => {});
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

// Shared by draftInvoiceEmailForJob and draftCombinedEmailForJob below.
// Per Tim, 2026-09-02 — "we shouldn't need this new cell" (re: a
// short-lived separate "Samples Taken" input on the Invoice tab, since
// removed): he can already type a sample count, or add a line item
// entirely by hand — e.g. to invoice a homeowner job before lab results
// even land — directly in the Invoice tab's line-item editor, which
// flips invoice_auto to false the moment he does (see saveInvoice in
// JobsDashboard.tsx). Both callers used to always recompute from
// job.sample_counts and force invoice_auto back to true regardless, which
// silently discarded whatever he'd just typed in the instant either
// drafted. Respecting an existing manual edit here instead — recomputing
// only when the invoice is still on its system-computed default — is what
// actually makes hand-editing the line items a real alternative to a
// dedicated input.
async function priceAndPersistInvoice(
  job: JobWithCustomer,
  settingsRow: { service_types: ServiceType[] | null; pricing_zones: PricingZone[] | null } | null
): Promise<{ lineItems: InvoiceLineItem[]; totalCents: number }> {
  const supabase = getSupabaseAdmin();
  const hasManualLineItems = job.invoice_auto === false && (job.invoice_line_items?.length ?? 0) > 0;
  const lineItems = hasManualLineItems
    ? job.invoice_line_items!
    : defaultInvoiceLineItems(job, settingsRow?.service_types ?? [], settingsRow?.pricing_zones ?? []);
  const totalCents = invoiceLineItemsTotalCents(lineItems);
  await supabase
    .from("jobs")
    .update({
      invoice_line_items: lineItems,
      invoice_total_cents: totalCents,
      ...(hasManualLineItems ? {} : { invoice_auto: true }),
    })
    .eq("id", job.id);
  return { lineItems, totalCents };
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
  const { lineItems, totalCents } = await priceAndPersistInvoice(job as JobWithCustomer, settingsRow);
  const pricedJob = { ...job, invoice_line_items: lineItems, invoice_total_cents: totalCents };

  const customer = withCompanyBillingAddress(pricedJob.customers, pricedJob.customers.companies);
  const { renderInvoicePdf } = await import("@/lib/invoice-pdf");
  const invoicePdf = await renderInvoicePdf({ job: pricedJob, customer, company: pricedJob.customers.companies, settings });

  // Per Tim, 2026-09-03 — "invoice should only send to the emails listed
  // here": used to default to a billing_contact_id override (or the job's
  // own contact) with invoice_emails only ever added as an extra Cc —
  // exactly the "goes to someone different than who's typically listed"
  // confusion he flagged. invoice_emails is now the sole, authoritative
  // recipient list (already defaulted to the job's own contact email at
  // creation — see AddProjectDialog/api/admin/jobs — and editable per job
  // on Project Info), so whoever's listed there is exactly who gets it,
  // nothing implicitly added or substituted. Stripe's own customer record
  // (for payment tracking, not email routing) still uses the job's own
  // contact regardless — that's a separate concern from who the email
  // reaches.
  const invoiceToAddresses = (pricedJob.invoice_emails ?? "")
    .split(",")
    .map((e) => e.trim())
    .filter(Boolean);
  // Should never actually be empty — invoice_emails is defaulted at
  // creation for every job now — but never send a draft with no
  // recipient at all if it somehow is.
  const invoiceTo = (invoiceToAddresses.length > 0 ? invoiceToAddresses : [customer.email]).join(", ");

  // Best-effort: a Stripe hiccup (bad key, network blip) must never block
  // the Gmail draft itself — the draft is the part that matters, the Pay
  // Now link is a bonus when Stripe cooperates. Skipped entirely for a
  // check-paid job (job.payment_type) — no Stripe invoice needed at all.
  let payNowUrl: string | null = null;
  if (pricedJob.payment_type !== "check") {
    try {
      const { hostedInvoiceUrl } = await createStripeInvoiceForJob(pricedJob, customer);
      payNowUrl = hostedInvoiceUrl;
    } catch (e) {
      console.error(`Failed to create Stripe invoice for job ${job.id}:`, e);
    }
  }
  // Per Tim, 2026-09-02 — Newton Fire & Flood: "I still want a normal
  // stripe job to be created for every Newton Fire and Flood job" — he
  // charges the card directly himself, so the Stripe invoice/payment link
  // still gets created exactly as normal above (clarifying an earlier,
  // wrong reading of "we are not going to send a link to pay" as "skip
  // Stripe entirely"). Only the emailed link itself is what he doesn't
  // want — this separate variable keeps payNowUrl's own real value
  // available for the update below while never reaching the email body.
  const payNowUrlForEmail = pricedJob.customers.company_id === NEWTON_FIRE_FLOOD_COMPANY_ID ? null : payNowUrl;

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

  // Per Tim, 2026-09-18 (26-0030, "Burt Condo Trust") — confirmed live
  // that this draft never threaded onto the job's own Gmail conversation
  // at all, unlike draftReportEmailForJob's own copy of this same
  // threadId/headers wiring just above: a job whose invoice actually
  // needed to land as a reply in an ongoing back-and-forth (not a fresh
  // top-level email) always got a brand-new, disconnected thread instead.
  // Subject stays fixed per Tim's own 2026-08-27 note below — only the
  // threading itself was missing.
  const existingThreadIds: string[] = Array.isArray(job.email_thread_message_ids) ? job.email_thread_message_ids : [];
  const draft = await createDraft(accessToken, {
    to: invoiceTo,
    // Per Tim, 2026-08-27 — always exactly this, regardless of service
    // type(s) on the job.
    subject: `Inspection Invoice - ${expandAddress(pricedJob.service_address)}`,
    headers: threadHeaders(existingThreadIds),
    threadId: job.email_gmail_thread_id ?? undefined,
    bodyHtml: invoiceDraftBodyHtml(pricedJob, settings, payNowUrlForEmail),
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
}): Promise<{ messageId: string }> {
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
      // Per Tim, 2026-09-16 — same "contact me, not our office" wording fix
      // reportDraftBodyHtml/combinedDraftBodyHtml already got on 2026-08-26
      // (see REVIEW_LINK_LINE's own comment above), missed on this template
      // at the time since the payment-reminder note is a separate body.
      `Should you have any questions, please contact Tim at <span style="white-space:nowrap;">${escapeHtml(settings.business_phone)}</span>.`,
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

  return { messageId: draft.messageId };
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

// Per Tim, 2026-09-09 (26-0019, an asbestos+lead job) — a combined draft
// went out with the lead report still unfinished: lead_report_summary was
// completely empty, so nothing here caught that the lead side wasn't
// filled in at all. Originally also rejected the two canned positive/
// negative Overall Findings sentences verbatim (picking one from the
// admin UI's Result box sets lead_report_summary to literal
// LEAD_POSITIVE_REMARK/LEAD_NEGATIVE_REMARK text — see report-pdf.tsx's
// own comment), on the theory that a canned sentence meant it hadn't
// really been reviewed. Per Tim, 2026-09-12 — that was one check too far:
// picking Negative or Positive from the Result box IS the review: it's a
// deliberate choice, not an untouched default the field just happens to
// start with. Reverted to just requiring a summary be set at all.
function assertLeadReportReady(job: Job): void {
  if (!jobReportDomains(job.service_type).includes("lead")) return;
  const summary = job.lead_report_summary?.trim();
  if (!summary) {
    throw new Error(
      "Lead report is missing its Overall Findings sentence (lead_report_summary) — add that on the job's Final Report tab before creating a report draft."
    );
  }
}

// Per Tim, 2026-09-11 (26-0026) — "a draft should not be auto made for an
// asbestos inspection when there is a positive result as i will always
// have to go back in and add the square footage": a positive result only
// tells you a sample tested positive, never the material's actual extent
// in the building — only Tim, looking at the site, can estimate that. A
// negative-only asbestos job has nothing to add here and drafts normally.
// Same two places that square footage/quantity actually lives as the
// "Total Materials Sampled" gap this same incident surfaced (see
// report-pdf.tsx materials.length) — full_inspection_materials for a Full
// Inspection job (Pre-Renovation/Pre-Demolition), sample_findings for
// every other (Limited) asbestos job.
function assertAsbestosReportReady(job: Job): void {
  if (!jobReportDomains(job.service_type).includes("asbestos")) return;
  if (job.asbestos_result !== "positive") return;
  if (isFullInspectionAsbestosJob(job.service_type)) {
    if ((job.full_inspection_materials ?? []).length === 0) {
      throw new Error(
        "Asbestos report is positive but the Materials Sampled table is still empty — add the identified material(s) and square/linear footage on the job's Asbestos Report tab before creating a report draft."
      );
    }
    return;
  }
  const findings = job.sample_findings ?? [];
  const incomplete = findings.length === 0 || findings.some((f) => !f.material?.trim() || !f.estimated_quantity?.trim());
  if (incomplete) {
    throw new Error(
      "Asbestos report is positive but at least one positive sample is still missing its material/footage — add that on the job's Asbestos Report tab before creating a report draft."
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
  assertLeadReportReady(job);
  assertAsbestosReportReady(job);
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
  //
  // Subject reuses email_thread_subject (the real subject captured once,
  // the moment this thread was actually established — see its own comment
  // in schema.sql) rather than recomputing threadSubject() fresh here:
  // Gmail's API requires a message's Subject to match the thread's real
  // subject for threadId to actually attach it, and threadSubject() drifts
  // the moment service_address/service_type are edited after intake —
  // confirmed live 2026-09-14 on a Boston Harbor Water Restoration job
  // (wrong unit number fixed, draft regenerated, landed as an unthreaded
  // new draft instead of a reply). Falls back to the live computation only
  // for a job created before this column existed.
  const existingThreadIds: string[] = Array.isArray(job.email_thread_message_ids) ? job.email_thread_message_ids : [];
  const draft = await createDraft(accessToken, {
    to: [...new Set(recipients)].join(", "),
    subject: job.email_thread_subject ?? threadSubject(job.service_address, job.service_type),
    headers: threadHeaders(existingThreadIds),
    threadId: job.email_gmail_thread_id ?? undefined,
    bodyHtml: reportDraftBodyHtml(job, settings),
    attachments: reportPackets.map(({ domain, buffer }) => ({
      filename: reportEmailAttachmentFilename(job, job.id, domain),
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
  // report_draft_domains — always every domain on the job here (this path
  // always builds every domain's packet, see buildAllFinalReportPackets
  // above with no domains filter); checkDraftSentStatus reads it back to
  // know which domain(s) this draft's eventual sent confirmation covers.
  await updateJobToleratingMissingColumns(supabase, job.id, {
    report_drafted_at: new Date().toISOString(),
    report_draft_gmail_id: draft.id,
    report_draft_gmail_message_id: draft.messageId,
    report_draft_domains: jobReportDomains(job.service_type),
  }, ["report_draft_domains"]);

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
  assertLeadReportReady(job);
  assertAsbestosReportReady(job);
  const supabase = getSupabaseAdmin();

  const { data: settingsRow } = await supabase.from("settings").select("service_types, pricing_zones").eq("id", 1).single();
  const { lineItems, totalCents } = await priceAndPersistInvoice(job as JobWithCustomer, settingsRow);
  const pricedJob = { ...job, invoice_line_items: lineItems, invoice_total_cents: totalCents };

  const customer = withCompanyBillingAddress(pricedJob.customers, pricedJob.customers.companies);

  const { renderInvoicePdf } = await import("@/lib/invoice-pdf");
  const invoicePdf = await renderInvoicePdf({ job: pricedJob, customer, company: pricedJob.customers.companies, settings });

  const { buildAllFinalReportPackets } = await import("@/lib/report-packet");
  // One PDF per domain on the job — combined with the invoice below into
  // this same single draft.
  const reportPackets = await buildAllFinalReportPackets(pricedJob, customer, settings);

  // Per Tim, 2026-09-03 — "invoice should only send to the emails listed
  // here": same reasoning as the standalone invoice draft (see its own
  // comment) — this one email covers both the report and invoice, but
  // still only goes out to invoice_emails, nothing implicitly substituted
  // or added from a billing-contact override.
  const invoiceToAddresses = (pricedJob.invoice_emails ?? "")
    .split(",")
    .map((e) => e.trim())
    .filter(Boolean);
  const invoiceTo = (invoiceToAddresses.length > 0 ? invoiceToAddresses : [customer.email]).join(", ");

  // Best-effort, same as the standalone invoice draft — a Stripe hiccup
  // must never block the Gmail draft itself. Skipped entirely for a
  // check-paid job (job.payment_type) — no Stripe invoice needed at all.
  let payNowUrl: string | null = null;
  if (pricedJob.payment_type !== "check") {
    try {
      const { hostedInvoiceUrl } = await createStripeInvoiceForJob(pricedJob, customer);
      payNowUrl = hostedInvoiceUrl;
    } catch (e) {
      console.error(`Failed to create Stripe invoice for job ${job.id}:`, e);
    }
  }
  // Newton Fire & Flood — see draftInvoiceEmailForJob's own comment: the
  // Stripe invoice/link still gets created normally above, only the emailed
  // link itself is withheld.
  const payNowUrlForEmail = pricedJob.customers.company_id === NEWTON_FIRE_FLOOD_COMPANY_ID ? null : payNowUrl;

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
  //
  // Subject reuses email_thread_subject rather than recomputing
  // threadSubject() fresh — see draftReportEmailForJob's own comment on
  // why: Gmail requires a matching Subject for threadId to actually
  // attach, and the live recomputation drifts the moment the job's
  // address/service type are edited after intake.
  const existingThreadIds: string[] = Array.isArray(pricedJob.email_thread_message_ids) ? pricedJob.email_thread_message_ids : [];
  const draft = await createDraft(accessToken, {
    to: invoiceTo,
    subject: pricedJob.email_thread_subject ?? threadSubject(pricedJob.service_address, pricedJob.service_type),
    headers: threadHeaders(existingThreadIds),
    threadId: pricedJob.email_gmail_thread_id ?? undefined,
    bodyHtml: combinedDraftBodyHtml(pricedJob, settings, totalCents, payNowUrlForEmail),
    attachments: [
      ...reportPackets.map(({ domain, buffer }) => ({
        filename: reportEmailAttachmentFilename(pricedJob, job.id, domain),
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
  // report_draft_domains — same reasoning as draftReportEmailForJob above:
  // this path also always builds every domain's packet.
  await updateJobToleratingMissingColumns(supabase, job.id, {
    invoice_drafted_at: draftedAt,
    invoice_draft_gmail_id: draft.id,
    invoice_draft_gmail_message_id: draft.messageId,
    report_drafted_at: draftedAt,
    report_draft_gmail_id: draft.id,
    report_draft_gmail_message_id: draft.messageId,
    report_draft_domains: jobReportDomains(pricedJob.service_type),
  }, ["report_draft_domains"]);

  return { messageId: draft.messageId };
}

// Per Tim, 2026-09-04 — "these buttons are bad i just need an email tab
// with a checklist that i can do": backs the Email tab's checklist
// (Report per domain / Invoice / Moisture Mapping Report, any combo),
// replacing the old fixed report-only/invoice-only/combined trio with one
// à la carte builder. Still only ever produces one Gmail draft and still
// only ever writes to the existing report_*/invoice_* column pairs
// (moisture mapping rides along as an extra attachment on whichever of
// those is also selected, rather than getting its own tracked "sent"
// state — there's no moisture_mapping_sent_at column, and adding one
// would also mean teaching checkDraftSentStatus/the check-sent-drafts
// cron/checkForBouncedSends about a third kind) — see draftCombinedEmailForJob
// above for why pointing both column pairs at the same draft id is safe.
// Selecting neither a report domain nor Invoice (moisture mapping alone)
// still writes the report column pair, the closest existing "non-invoice
// document" slot — no dedicated tracking, but nothing else breaks either.
async function draftSelectedEmailForJob(params: {
  job: Job & { customers: Customer & { companies: Company | null } };
  settings: Settings;
  accessToken: string;
  domains: ReportDomain[];
  includeInvoice: boolean;
  includeMoistureMapping: boolean;
  /** Per Tim, 2026-09-04 — the Email tab's editable subject field; falls
      back to the same computed default the tab itself shows when omitted
      or blank. */
  subject?: string;
}): Promise<{ messageId: string }> {
  const { job, settings, accessToken, domains, includeInvoice, includeMoistureMapping, subject: customSubject } = params;
  if (domains.includes("mold")) assertMoldReportReady(job);
  if (domains.includes("lead")) assertLeadReportReady(job);
  if (domains.includes("asbestos")) assertAsbestosReportReady(job);
  const supabase = getSupabaseAdmin();

  let pricedJob = job;
  let totalCents = job.invoice_total_cents ?? 0;
  let payNowUrlForEmail: string | null = null;
  if (includeInvoice) {
    const { data: settingsRow } = await supabase.from("settings").select("service_types, pricing_zones").eq("id", 1).single();
    const { lineItems, totalCents: freshTotalCents } = await priceAndPersistInvoice(job as JobWithCustomer, settingsRow);
    pricedJob = { ...job, invoice_line_items: lineItems, invoice_total_cents: freshTotalCents };
    totalCents = freshTotalCents;
  }
  const customer = withCompanyBillingAddress(pricedJob.customers, pricedJob.customers.companies);

  const { buildAllFinalReportPackets, buildMoistureMappingReportBuffer } = await import("@/lib/report-packet");
  const reportPackets = domains.length > 0 ? await buildAllFinalReportPackets(pricedJob, customer, settings, domains) : [];
  const moistureMappingBuffer = includeMoistureMapping ? await buildMoistureMappingReportBuffer(pricedJob, customer, settings) : null;

  let invoicePdf: Buffer | null = null;
  if (includeInvoice) {
    const { renderInvoicePdf } = await import("@/lib/invoice-pdf");
    invoicePdf = await renderInvoicePdf({ job: pricedJob, customer, company: pricedJob.customers.companies, settings });
    if (pricedJob.payment_type !== "check") {
      try {
        const { hostedInvoiceUrl } = await createStripeInvoiceForJob(pricedJob, customer);
        payNowUrlForEmail = pricedJob.customers.company_id === NEWTON_FIRE_FLOOD_COMPANY_ID ? null : hostedInvoiceUrl;
      } catch (e) {
        console.error(`Failed to create Stripe invoice for job ${job.id}:`, e);
      }
    }
  }

  // Same "invoice_emails only when the invoice is actually included, else
  // fall back to report_emails/customer.email" split the three older
  // functions each hard-coded separately.
  let recipients: string;
  if (includeInvoice) {
    const invoiceToAddresses = (pricedJob.invoice_emails ?? "").split(",").map((e) => e.trim()).filter(Boolean);
    recipients = (invoiceToAddresses.length > 0 ? invoiceToAddresses : [customer.email]).join(", ");
  } else {
    recipients = [...new Set(
      [customer.email, ...(job.report_emails?.split(",") ?? [])]
        .map((e) => e.trim().toLowerCase())
        .filter(Boolean)
    )].join(", ");
  }

  const staleDraftIds = new Set(
    [
      (domains.length > 0 || includeMoistureMapping) ? job.report_draft_gmail_id : null,
      includeInvoice ? job.invoice_draft_gmail_id : null,
    ].filter((id): id is string => Boolean(id))
  );
  for (const id of staleDraftIds) {
    try {
      await deleteDraft(accessToken, id);
    } catch (e) {
      console.error(`Failed to delete previous draft ${id} for job ${job.id}:`, e);
    }
  }

  // Body copy: reuses the three existing templates rather than writing a
  // fourth — closest match to what's actually attached. Per Tim,
  // 2026-09-11 (26-0019) — passes the caller-selected `domains` through
  // explicitly now, not just whatever the job's own service_type implies,
  // so unchecking a domain here (e.g. sending only the asbestos report off
  // a mixed asbestos+lead job) can't leave the body text claiming a
  // report that isn't actually attached.
  const bodyHtml = includeInvoice
    ? (domains.length > 0 ? combinedDraftBodyHtml(pricedJob, settings, totalCents, payNowUrlForEmail, domains) : invoiceDraftBodyHtml(pricedJob, settings, payNowUrlForEmail))
    : reportDraftBodyHtml(pricedJob, settings, domains);

  // Boston Harbor Water Restoration: per Tim, 2026-09-08 — the people on
  // the original job-intake thread are the fieldworkers, not whoever
  // actually pays, so an invoice must never land as a reply in that
  // thread even when sent through this checklist path. Every other
  // company still threads normally (an invoice reply staying in the same
  // conversation as the report is the desired, existing behavior there).
  const threadOntoOriginal = !(
    includeInvoice && pricedJob.customers.company_id === BOSTON_HARBOR_WATER_RESTORATION_COMPANY_ID
  );
  const existingThreadIds: string[] = Array.isArray(pricedJob.email_thread_message_ids) ? pricedJob.email_thread_message_ids : [];
  // The report/report+invoice branch reuses email_thread_subject rather
  // than recomputing threadSubject() fresh — see draftReportEmailForJob's
  // own comment on why. The invoice-only branch is left as its own fixed
  // subject, unchanged: for Boston Harbor specifically it never threads
  // anyway (threadOntoOriginal above), and for every other company that
  // combination is an existing, separate gap (draftInvoiceEmailForJob's
  // own standalone path never threads either) — not part of this fix.
  const subject = customSubject?.trim() || (includeInvoice && domains.length === 0
    ? `Inspection Invoice - ${expandAddress(pricedJob.service_address)}`
    : (pricedJob.email_thread_subject ?? threadSubject(pricedJob.service_address, pricedJob.service_type)));
  const draft = await createDraft(accessToken, {
    to: recipients,
    subject,
    headers: threadOntoOriginal ? threadHeaders(existingThreadIds) : undefined,
    threadId: threadOntoOriginal ? (pricedJob.email_gmail_thread_id ?? undefined) : undefined,
    bodyHtml,
    attachments: [
      ...reportPackets.map(({ domain, buffer }) => ({
        filename: reportEmailAttachmentFilename(pricedJob, job.id, domain),
        mimeType: "application/pdf",
        content: buffer,
      })),
      ...(moistureMappingBuffer
        ? [{
            filename: `${pricedJob.project_number ?? job.id} Moisture Mapping Report.pdf`,
            mimeType: "application/pdf",
            content: moistureMappingBuffer,
          }]
        : []),
      ...(invoicePdf
        ? [{ filename: `${pricedJob.project_number ?? job.id} Invoice.pdf`, mimeType: "application/pdf", content: invoicePdf }]
        : []),
    ],
  });

  const draftedAt = new Date().toISOString();
  const update: Record<string, unknown> = {};
  const toleratedColumns: string[] = [];
  if (domains.length > 0 || includeMoistureMapping) {
    update.report_drafted_at = draftedAt;
    update.report_draft_gmail_id = draft.id;
    update.report_draft_gmail_message_id = draft.messageId;
    // Only when a report domain was actually picked — moisture-mapping-only
    // has no report domain of its own to attribute a later "sent" to.
    if (domains.length > 0) {
      update.report_draft_domains = domains;
      toleratedColumns.push("report_draft_domains");
    }
  }
  if (includeInvoice) {
    update.invoice_drafted_at = draftedAt;
    update.invoice_draft_gmail_id = draft.id;
    update.invoice_draft_gmail_message_id = draft.messageId;
  }
  if (Object.keys(update).length > 0) {
    await updateJobToleratingMissingColumns(supabase, job.id, update, toleratedColumns);
  }

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
  const settings = await getSettingsFresh();

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

/** Manual "Send Payment Reminder" button on the Email tab (individual/homeowner jobs only) — same draft-creation path the automatic lab-results-landing path uses, callable on demand any time results are ready but payment isn't in yet. Returns the new draft's own Gmail message id so a caller can jump straight to it, same as the other create*DraftForJob functions. */
export async function createPaymentReminderDraftForJob(jobId: string): Promise<{ messageId: string }> {
  return draftPaymentReminderForIndividual(await loadJobForDraft(jobId));
}

/** The Email tab's one "View Draft" button — final report + invoice as two attachments on a single Gmail draft, with a payment link. Returns the new draft's own Gmail message id so the caller can jump straight to it. */
export async function createCombinedDraftForJob(jobId: string): Promise<{ messageId: string }> {
  return draftCombinedEmailForJob(await loadJobForDraft(jobId));
}

/** The Email tab's checklist button — any combination of report domain(s)/Invoice/Moisture Mapping Report as one Gmail draft. */
export async function createSelectedDraftForJob(
  jobId: string,
  selection: { domains: ReportDomain[]; includeInvoice: boolean; includeMoistureMapping: boolean; subject?: string }
): Promise<{ messageId: string }> {
  return draftSelectedEmailForJob({ ...(await loadJobForDraft(jobId)), ...selection });
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
  const { data } = await supabase.from("jobs").select("report_drafted_at, documents, service_type").eq("id", jobId).maybeSingle();
  if (data?.report_drafted_at) return;
  // Per Tim, 2026-09-02 — an individual/homeowner job can now be invoiced
  // and paid before the lab results even land (manual sample-count entry
  // on the Invoice tab, so the invoice is ready to go out the moment
  // results come in). buildFinalReportPacket doesn't error on a missing
  // lab_report document — it just silently omits it — so drafting here
  // without this check would ship an incomplete report (no lab results
  // pages, no real findings) and permanently block the real one, since
  // report_drafted_at above would already be set by then. Skip for now;
  // processMatchedLabEmail's own is_individual+paid branch drafts the real
  // report the moment results actually land.
  if (data && !hasLabReportForEveryDomain(data)) return;

  try {
    await createReportDraftForJob(jobId);
  } catch (e) {
    console.error(`autoDraftReportIfJustPaid: failed to auto-draft report for job ${jobId}:`, e);
  }
}

// Shared by autoDraftReportIfJustPaid above — mirrors buildFinalReportPacket's
// own per-domain document filtering (report-packet.ts) so this check can
// never disagree with what that function would actually find.
export function hasLabReportForEveryDomain(job: { documents: JobDocument[] | null; service_type: string | null }): boolean {
  const domains = jobReportDomains(job.service_type);
  const documents = job.documents ?? [];
  return domains.every((domain) =>
    documents.some((d) => d.kind === "lab_report" && domainForServiceTypeLabel(d.service_type) === domain)
  );
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
  await sendJobPaidNotification(jobId).catch((e) =>
    console.error(`markJobPaid: failed to send paid notification for job ${jobId}:`, e)
  );
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
