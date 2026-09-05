// Automated intake for repeat commercial clients who start a job by email
// instead of booking through the portal — Boston Harbor Water Restoration's
// "ACM Order" emails (see parse-job-intake.ts) are the first, and so far
// only, sender this is built for. Deliberately narrow (a small hardcoded
// list, same shape as parse-lab-report.ts's KNOWN_LABS) rather than a
// general "detect any company's freeform job request" system — a wrong
// guess here creates a real job with a wrong address, a much worse failure
// than a lab report's blank sample count, so this only ever acts on a
// sender/format combination that's actually been confirmed against real
// emails.
import { getSupabaseAdmin, getSupabaseAdminFresh } from "@/lib/supabase";
import { getSettings } from "@/lib/settings";
import { geocodeAddress, GeocodeError, isWithinServiceStates } from "@/lib/geocode";
import { generateProjectNumber } from "@/lib/project-number";
import { resolveServiceSelection } from "@/lib/portal-booking";
import { parseAcmOrderEmail, type ParsedJobIntake } from "@/lib/parse-job-intake";
import { sendEmail, emailShell } from "@/lib/email";
import { escapeHtml } from "@/lib/html";
import { formatDateMDY } from "@/lib/date-format";
import { formatPhoneNumber } from "@/lib/phone";
import {
  getValidAccessToken,
  listMessagesByQuery,
  getMessage,
  getHeader,
  getMessageBodyText,
  markMessageRead,
  getOrCreateLabelId,
  addLabelToMessage,
  type GmailMessage,
} from "@/lib/gmail";
import type { Settings } from "@/lib/types";
import {
  BOSTON_HARBOR_WATER_RESTORATION_COMPANY_ID,
  BOSTON_HARBOR_WATER_RESTORATION_REPORT_CONTACT_ID,
  BOSTON_HARBOR_WATER_RESTORATION_INVOICE_EMAILS,
} from "@/lib/report-findings";

// Applied to every message this pipeline actually processes (success or
// alerted failure) — see getOrCreateLabelId's own comment for why this,
// not is:unread, is what candidacy is filtered on below. Per Tim,
// 2026-09-02 — "name them what they are": nested under a "Processed"
// parent label (Gmail treats "/" as a folder separator) instead of the
// old flat "cis-job-intake-processed" name, so it reads clearly and
// groups with the other two processed-labels in the sidebar instead of
// three separate cryptic entries.
const PROCESSED_LABEL = "Processed/Job Requests";
// Confirmed live 2026-09-02: renaming PROCESSED_LABEL above (from the old
// "cis-job-intake-processed") silently broke the "already handled this
// one" check for every message processed under the old name — the
// `-label:` search excludes by the CURRENT name only, so a real 8/25 order
// email, already turned into job 26-0006 weeks earlier, matched as a fresh
// candidate again and created a duplicate job (26-0015). Still excluding
// the legacy name too keeps any future rename from doing this again —
// this is the last time a rename here should need code changes, since old
// AND new are both always checked from now on.
const LEGACY_PROCESSED_LABEL = "cis-job-intake-processed";

interface JobIntakeSender {
  /**
   * Matched case-insensitively against the message's own From header, or —
   * for an email the owner forwarded on to the connected inbox himself —
   * the original sender embedded in Gmail's forward boilerplate (see
   * stripGmailForwardBoilerplate below).
   */
  domain: string;
  companyName: string;
  serviceTypeKey: string;
  /**
   * Gmail search term — OR'd with `from:domain` below, not used alone.
   * Matching on subject text alone silently missed a real order whose
   * subject didn't contain this exact phrase (confirmed live 2026-08-24 —
   * nothing was created and no alert fired, since the email never even
   * became a search candidate). The real content check (parseAcmOrderEmail)
   * is what actually decides whether something's a job, so casting a wider
   * net here and letting a mismatch fall through to alertOwnerOfIntakeIssue
   * is safer than a narrow subject filter silently dropping real orders.
   */
  subjectHint: string;
}

const KNOWN_SENDERS: JobIntakeSender[] = [
  { domain: "bostonharborwater.com", companyName: "Boston Harbor Water Restoration", serviceTypeKey: "asbestos_bulk", subjectHint: "ACM Order" },
];

export interface JobIntakeResult {
  checked: number;
  created: { projectNumber: string; jobId: string }[];
  unmatched: number;
}

// Gmail's own "Forward" action: "---------- Forwarded message ---------".
// Outlook/Exchange's (confirmed against a real email — the owner's day job
// at FLI Environmental uses Outlook): a bare line of underscores, no text.
const GMAIL_FORWARD_MARKER = /^-{2,}\s*forwarded message\s*-{2,}\s*$/i;
const OUTLOOK_FORWARD_MARKER = /^_{10,}$/;

// The owner doesn't always receive these directly at the connected inbox —
// he sometimes forwards a real order email he got elsewhere (including from
// his day-job Outlook address) on to it. A forward's own From header is the
// owner's own address, not the sender's, so the plain from-header check
// below can't see through it. Both Gmail's and Outlook's "Forward" actions
// prepend a fixed boilerplate block ahead of the original body — same shape
// either way, just a different marker line and a couple of extra header
// lines (Outlook adds Sent:/Cc: alongside From/Subject):
//
//   ---------- Forwarded message ---------      (Gmail)
//   ________________________________            (Outlook)
//   From: Name <email@domain>
//   Date: / Sent: ...
//   To: ...
//   Cc: ...
//   Subject: ...
//
//   [original body]
//
// This pulls the embedded original From out of that block (so the real
// sender can still be checked against KNOWN_SENDERS) and strips the whole
// block from the body, so parseAcmOrderEmail sees the same clean
// line-by-line template it would if the email had arrived unforwarded.
// Returns null for originalFrom (and the body untouched) when there's no
// such block — the common case for an email that arrived directly.
export function stripGmailForwardBoilerplate(bodyText: string): { originalFrom: string | null; body: string } {
  // Outlook sends CRLF ("\r\n") line endings — normalize before splitting
  // so no line carries a trailing "\r" that would silently break exact-end
  // regex matches like the From: extraction below (confirmed live: a real
  // Outlook-forwarded email stripped its boilerplate correctly, since the
  // marker/blank-line checks below already .trim(), but originalFrom came
  // back null because the From: line's untrimmed "\r" broke the match).
  const lines = bodyText.replace(/\r\n/g, "\n").split("\n");
  const markerIndex = lines.findIndex((l) => {
    const trimmed = l.trim();
    return GMAIL_FORWARD_MARKER.test(trimmed) || OUTLOOK_FORWARD_MARKER.test(trimmed);
  });
  if (markerIndex === -1) return { originalFrom: null, body: bodyText };

  let i = markerIndex + 1;
  let originalFrom: string | null = null;
  while (i < lines.length && lines[i].trim() !== "") {
    const match = lines[i].match(/^from:\s*(.+)$/i);
    if (match) originalFrom = match[1].trim();
    i++;
  }
  if (i < lines.length && lines[i].trim() === "") i++;

  return { originalFrom, body: lines.slice(i).join("\n") };
}

// Everyone who was actually on the original order email (sender + To + Cc),
// minus the owner's own inbox — becomes the job's report_emails, so the
// results email that auto-drafts once lab results land (draftReportEmailForJob
// in lib/lab-email.ts) comes pre-addressed to the real team on that thread
// instead of just the one billing contact on file for the company. Confirmed
// live 2026-08-24: a real order's report_emails had only ended up as the
// billing contact (whoever createJobFromIntake resolved as customer_id),
// even though that person is the one who receives invoices, not who should
// be getting results — the actual team is whoever was in To/Cc.
export function extractOtherRecipients(message: GmailMessage): string[] {
  const ownerEmail = (process.env.OWNER_EMAIL ?? "").toLowerCase();
  const headerValues = [getHeader(message, "From"), getHeader(message, "To"), getHeader(message, "Cc")].filter(
    (v): v is string => Boolean(v)
  );

  const emails = new Set<string>();
  for (const value of headerValues) {
    for (const part of value.split(",")) {
      const match = part.match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
      const email = match?.[0]?.toLowerCase();
      if (email && email !== ownerEmail) emails.add(email);
    }
  }
  return [...emails];
}

// A candidate email that matched the sender/subject search but couldn't
// become a job — a parse failure, a state-license mismatch, a likely
// duplicate, a missing company/contact, etc. Previously these just
// incremented `unmatched` and left the email sitting unread with no other
// signal; the ONLY way the owner would ever learn an order was missed was
// noticing old unread mail by hand. Now every one of these sends a real,
// immediate alert instead — see alertOwnerOfIntakeIssue below.
async function alertOwnerOfIntakeIssue(params: {
  sender: JobIntakeSender;
  from: string;
  subject: string;
  reason: string;
  bodyExcerpt: string;
}): Promise<void> {
  try {
    await sendEmail({
      to: process.env.OWNER_EMAIL!,
      subject: `Action needed: couldn't auto-create a job from ${params.sender.companyName}'s email`,
      html: emailShell(`
        <p style="font-size:15px;">An email from <strong>${escapeHtml(params.from)}</strong> matched ${escapeHtml(params.sender.companyName)}'s job-intake pattern but couldn't be turned into a job automatically.</p>
        <p><strong>Subject:</strong> ${escapeHtml(params.subject)}</p>
        <p><strong>Reason:</strong> ${escapeHtml(params.reason)}</p>
        <p>Check your inbox and enter this job manually if it's real — it's been marked read so this alert won't repeat for the same email.</p>
        <p style="margin-top:16px; white-space:pre-wrap; font-size:13px; color:#555; border-top:1px solid #e2e8f0; padding-top:12px;">${escapeHtml(params.bodyExcerpt.slice(0, 1000))}</p>
      `),
    });
  } catch (err) {
    // Best-effort in the sense that a failed alert shouldn't crash the
    // whole cron run — but this is the last line of defense against a
    // silently missed order, so it's still logged loudly.
    console.error("alertOwnerOfIntakeIssue: failed to send alert email:", err);
  }
}

export async function checkForJobIntakeEmails(): Promise<JobIntakeResult> {
  const accessToken = await getValidAccessToken();
  if (!accessToken) throw new Error("Gmail is not connected");

  const settings = await getSettings();
  const result: JobIntakeResult = { checked: 0, created: [], unmatched: 0 };
  const processedLabelId = await getOrCreateLabelId(accessToken, PROCESSED_LABEL);

  for (const sender of KNOWN_SENDERS) {
    // Per Tim, 2026-09-05 — "when these kinds of emails come in, they need
    // to auto label as Boston Harbor water restoration": his own existing
    // Gmail label, matched by exact name (confirmed live against his real
    // label list) so this reuses it instead of creating a near-duplicate.
    // Applied alongside PROCESSED_LABEL below on every real candidate from
    // this sender, regardless of outcome — a duplicate-thread skip or a
    // parse failure still deserves filing under the sender's own folder.
    const senderLabelId = await getOrCreateLabelId(accessToken, sender.companyName);
    const labelCandidate = (messageId: string) =>
      Promise.all([addLabelToMessage(accessToken, messageId, processedLabelId), addLabelToMessage(accessToken, messageId, senderLabelId)]);
    // subject OR from:domain, not subject alone — a from:-only filter would
    // miss a forwarded order (the owner's own From header, not the
    // sender's), and a subject-only filter missed a real order whose
    // subject didn't happen to contain the hint (see subjectHint's own
    // comment). Sender identity is still verified below against either the
    // direct From header or, for a forward, the original sender embedded
    // in Gmail's forward boilerplate — this query only decides candidacy.
    //
    // -label:PROCESSED_LABEL, not is:unread — confirmed live 2026-08-24
    // that the inbox owner reads/replies to these order emails himself
    // right away, often before the next poll, which silently made
    // is:unread drop a message this pipeline had never actually gotten to.
    // PROCESSED_LABEL is only ever set by this pipeline (see below), so it
    // can't be defeated by the owner's own reading habits. Also excludes
    // LEGACY_PROCESSED_LABEL — see its own comment. Quoted: a label name
    // with a space (like "Processed/Job Requests") needs quotes in Gmail's
    // search syntax, or "Requests" gets parsed as a separate bare search
    // term instead of part of the label name.
    const query = `newer_than:14d -label:"${PROCESSED_LABEL}" -label:${LEGACY_PROCESSED_LABEL} (subject:"${sender.subjectHint}" OR from:${sender.domain})`;
    const candidates = await listMessagesByQuery(accessToken, query);

    for (const candidate of candidates) {
      result.checked++;
      const message = await getMessage(accessToken, candidate.id);
      const from = getHeader(message, "From") ?? "";
      const subject = getHeader(message, "Subject") ?? "(no subject)";
      const rawBodyText = getMessageBodyText(message);

      const directMatch = from.toLowerCase().includes(sender.domain);
      const { originalFrom, body: strippedBody } = stripGmailForwardBoilerplate(rawBodyText);
      const forwardMatch = !directMatch && (originalFrom?.toLowerCase().includes(sender.domain) ?? false);

      if (!directMatch && !forwardMatch) {
        // Some other unread email that happens to share the subject hint —
        // not a real client order, so no owner alert (would just be
        // noise), but still left unread since it's genuinely not this
        // pipeline's to touch.
        result.unmatched++;
        continue;
      }

      // A job already exists for this exact Gmail thread — this candidate
      // is an old order this pipeline already handled once, resurfacing
      // because -label:PROCESSED_LABEL only guards messages processed
      // *after* that label started existing (2026-08-24). Every order from
      // before then still lacks it, so without this check the very first
      // run under the new query re-created a duplicate of an existing job
      // from its original source email (confirmed live — see project
      // 26-0001 vs. the accidental 26-0062/26-0003). Checked directly
      // against the jobs table, not just re-applying the label speculatively,
      // so this is authoritative regardless of whether the label ever got
      // backfilled onto old messages.
      // Fresh, not the shared cached client — a stale "no job found" read
      // here would defeat the entire point of this check (see the shared
      // client's own comment about Next's fetch Data Cache silently
      // caching Supabase reads).
      const supabase = getSupabaseAdminFresh();
      const { data: existingJob } = await supabase
        .from("jobs")
        .select("project_number")
        .eq("email_gmail_thread_id", message.threadId)
        .maybeSingle();
      if (existingJob) {
        await markMessageRead(accessToken, candidate.id);
        await labelCandidate(candidate.id);
        result.unmatched++;
        continue;
      }

      const bodyText = forwardMatch ? strippedBody : rawBodyText;

      try {
        const parsed = parseAcmOrderEmail(bodyText);
        if (!parsed) {
          await alertOwnerOfIntakeIssue({
            sender, from, subject,
            reason: "Didn't match the expected order template (name/address/phone/date/scope lines) — could be off-format, a reply, or a forward.",
            bodyExcerpt: bodyText,
          });
          await markMessageRead(accessToken, candidate.id);
          await labelCandidate(candidate.id);
          result.unmatched++;
          continue;
        }

        const rfcMessageId = getHeader(message, "Message-ID");
        const job = await createJobFromIntake({ sender, parsed, settings, message, rfcMessageId });
        // No acknowledgment reply here on purpose — per explicit owner
        // instruction, the only automated thing for this intake channel is
        // the final report draft (see draftReportEmailForJob's own
        // threading, lib/lab-email.ts), once lab results actually land.
        // Everything else in this conversation — including the initial
        // reply to the client — stays manual, same as it already is today.
        await markMessageRead(accessToken, candidate.id);
        await labelCandidate(candidate.id);
        result.created.push({ projectNumber: job.projectNumber, jobId: job.jobId });
      } catch (err) {
        console.error(`checkForJobIntakeEmails: failed to process message ${candidate.id}:`, err);
        await alertOwnerOfIntakeIssue({
          sender, from, subject,
          reason: err instanceof Error ? err.message : "Unknown error while creating the job.",
          bodyExcerpt: bodyText,
        });
        await markMessageRead(accessToken, candidate.id);
        await labelCandidate(candidate.id);
        result.unmatched++;
      }
    }
  }

  return result;
}

// "Email received 8/18/2026 2:41 PM from Jack Cook (555-123-4567), Boston
// Harbor Water Restoration. Order requested for 8/20/2026." — these jobs
// carry no requested_date/requested_time of their own (see JobsDashboard's
// email_intake handling), so this note is the only place either fact is
// recorded. internalDate is Gmail's own received-at timestamp, not the
// sender's claimed send time, so it can't be spoofed by a wrong clock.
function buildEmailIntakeNote(sender: JobIntakeSender, parsed: ParsedJobIntake, message: GmailMessage): string {
  const receivedAtMs = message.internalDate ? Number(message.internalDate) : NaN;
  const receivedLabel = Number.isFinite(receivedAtMs)
    ? new Date(receivedAtMs).toLocaleString("en-US", {
        month: "numeric", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit",
      })
    : null;
  const requestedLabel = formatDateMDY(parsed.requestedDate) ?? parsed.requestedDate;
  return `Email received${receivedLabel ? ` ${receivedLabel}` : ""} from ${parsed.companyContactName} (${formatPhoneNumber(parsed.companyContactPhone)}), ${sender.companyName}. Order requested for ${requestedLabel}.`;
}

// Exported so it's independently testable without needing a real inbound
// Gmail message — every real caller reaches this through
// checkForJobIntakeEmails above.
export async function createJobFromIntake(params: {
  sender: JobIntakeSender;
  parsed: ParsedJobIntake;
  settings: Settings;
  message: GmailMessage;
  rfcMessageId: string | null;
}): Promise<{ jobId: string; projectNumber: string; serviceLabel: string; address: string }> {
  const { sender, parsed, settings, message, rfcMessageId } = params;
  const supabase = getSupabaseAdmin();

  const { data: company } = await supabase
    .from("companies")
    .select("id, billing_contact_id")
    .ilike("name", sender.companyName)
    .maybeSingle();
  if (!company) {
    throw new Error(`No company on file matching "${sender.companyName}" — add it in the Directory first`);
  }

  const { data: contacts } = await supabase
    .from("customers")
    .select("id, email")
    .eq("company_id", company.id)
    .order("created_at", { ascending: true });
  if (!contacts || contacts.length === 0) {
    throw new Error(`Company "${sender.companyName}" has no contact on file to bill this job to`);
  }
  // The company's designated billing contact (see companies.billing_contact_id
  // — the same mechanism lab-email.ts already resolves for invoices) if one's
  // set, else whichever contact has been on file longest — an explicit,
  // deterministic fallback rather than "whichever row Postgres returns
  // first," which has no ordering guarantee at all. Boston Harbor Water
  // Restoration overrides this: its billing contact (Nazli, who typically
  // sends these intake emails) is a distinct role from who results go to
  // (always Joe Kline, per Tim — see the constant's own comment), so this
  // job's own contact is set directly to him rather than inheriting the
  // billing default the report-rendering override elsewhere only patches
  // at display time.
  const defaultContactId = company.id === BOSTON_HARBOR_WATER_RESTORATION_COMPANY_ID
    ? BOSTON_HARBOR_WATER_RESTORATION_REPORT_CONTACT_ID
    : company.billing_contact_id;
  const customer = contacts.find((c) => c.id === defaultContactId) ?? contacts[0];

  // An explicit out-of-state town (the town line carried a state code that
  // isn't MA) is rejected before even attempting to geocode — cheaper, and
  // catches the mistake regardless of whether Google can resolve the address.
  if (parsed.stateHint && !isWithinServiceStates(parsed.stateHint, settings.service_states)) {
    throw new Error(
      `Job site is in ${parsed.stateHint}, outside the licensed service area (${settings.service_states.join(", ")}).`
    );
  }

  // Geocoded first so resolveServiceSelection's own pricing-zone lookup
  // (matched by town name, see its own comment) sees the full address, not
  // just the bare street — a street-only string can't match a zone at all.
  const fullAddress = `${parsed.streetAddress}, ${parsed.town}, ${parsed.stateHint ?? "MA"}`;
  let lat: number | null = null;
  let lng: number | null = null;
  let formattedAddress = fullAddress;
  let resolvedState: string | null = null;
  try {
    const geo = await geocodeAddress(fullAddress);
    lat = geo.lat;
    lng = geo.lng;
    formattedAddress = geo.formattedAddress;
    resolvedState = geo.state;
  } catch (err) {
    // Best-effort — an ambiguous or unrecognized address shouldn't block
    // the job from being created; it just won't have a map pin until the
    // admin edits it. GeocodeError has its own status field worth logging
    // distinctly from a generic failure.
    console.error(`createJobFromIntake: geocoding failed for "${fullAddress}":`, err instanceof GeocodeError ? err.status : err);
  }

  // Safety net for the no-stateHint case (the common one, since the real
  // template rarely carries a state) — if Google itself resolves the
  // address to a state we're not licensed in, don't silently create the
  // job anyway just because the geocode technically "succeeded."
  if (resolvedState && !isWithinServiceStates(resolvedState, settings.service_states)) {
    throw new Error(
      `Geocoded to ${resolvedState}, outside the licensed service area (${settings.service_states.join(", ")}) — check "${fullAddress}" manually.`
    );
  }

  // Same zone-aware pricing every other job (portal or admin-entered) gets
  // — no special-cased flat rate for this sender.
  const resolved = resolveServiceSelection([sender.serviceTypeKey], formattedAddress, settings);
  if ("error" in resolved) throw new Error(resolved.error);
  const { serviceTypeLabel, baseFeeCents, perSampleCents } = resolved;

  // Boston Harbor sends no acknowledgment (by design — see the comment in
  // checkForJobIntakeEmails), so from their side a real order that failed
  // to process looks identical to one that succeeded, and they have every
  // reason to resend "just in case." Same address for this company within
  // the last few days is treated as a likely duplicate rather than
  // silently creating a second identical job. Used to also require a
  // matching requested_date, but that column is no longer populated for
  // this company at all (see the insert below, requested_date) — address +
  // recency alone is still a strong signal on its own for a company whose
  // jobs never repeat the same address within days under normal use.
  const contactIds = contacts.map((c) => c.id);
  const { data: possibleDuplicate } = await supabase
    .from("jobs")
    .select("project_number")
    .in("customer_id", contactIds)
    .eq("service_address", formattedAddress)
    .gte("created_at", new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString())
    .limit(1)
    .maybeSingle();
  if (possibleDuplicate) {
    throw new Error(
      `Looks like a duplicate of ${possibleDuplicate.project_number} — same address, created in the last 3 days.`
    );
  }

  const projectNumber = await generateProjectNumber();

  const { data: job, error } = await supabase
    .from("jobs")
    .insert({
      project_number: projectNumber,
      customer_id: customer.id,
      service_address: formattedAddress,
      lat, lng,
      site_contact_name: parsed.homeownerName,
      site_contact_phone: parsed.homeownerPhone,
      service_type: serviceTypeLabel,
      base_fee_cents: baseFeeCents,
      per_sample_cents: perSampleCents,
      // Per Tim, 2026-08-28 — Boston Harbor never actually requests a
      // specific date/time, they just send a request and Tim schedules it
      // himself; the date this email named is already the only thing
      // buildEmailIntakeNote records it for (see that function's own
      // comment) — it was never meant to land on the job's own
      // requested_date column too. left null rather than parsed.requestedDate.
      requested_date: company.id === BOSTON_HARBOR_WATER_RESTORATION_COMPANY_ID ? null : parsed.requestedDate,
      window: "ANY",
      status: "needs_scheduling",
      source: "email_intake",
      scope_of_work: parsed.scopeOfWork,
      // The actual person who emailed this in — not a customers row of
      // their own, since no email address for them is ever given in these
      // messages (only the on-file company contact's). Kept as plain,
      // visible text on the job rather than guessed at. Includes exactly
      // when the order email arrived and the date it named, since neither
      // is tracked anywhere else — these jobs never carry a real requested
      // date/time on the job itself (see JobsDashboard's email_intake
      // handling), so this note is the only record of what was actually asked.
      notes: buildEmailIntakeNote(sender, parsed, message),
      disclaimer_ack: true,
      is_individual: false,
      // The actual team on the original order email (see
      // extractOtherRecipients's own comment) — not the resolved billing
      // contact (customer.id above), who's who invoices go to, not
      // necessarily who should be getting results.
      report_emails: extractOtherRecipients(message).join(",") || null,
      // Per Tim, 2026-09-03 — invoice_emails is now the literal, sole
      // recipient list every invoice draft sends to (see
      // draftInvoiceEmailForJob in lab-email.ts); Boston Harbor's own
      // standing three (see the constant's own comment) needs setting
      // here at creation, same as every other company now gets its own
      // contact's email defaulted in (AddProjectDialog/api/admin/jobs).
      invoice_emails: company.id === BOSTON_HARBOR_WATER_RESTORATION_COMPANY_ID
        ? BOSTON_HARBOR_WATER_RESTORATION_INVOICE_EMAILS
        : null,
      // Seeds this job's own email thread with the client's original
      // message, so the later confirmed/report emails (see
      // lib/booking-notify.ts) all join the exact same conversation
      // Boston Harbor started, not a new one the app started — the whole
      // point of this feature.
      email_gmail_thread_id: message.threadId,
      email_thread_message_ids: rfcMessageId ? [rfcMessageId] : [],
    })
    .select("id")
    .single();

  if (error || !job) {
    throw new Error(`Failed to create job from email intake: ${error?.message}`);
  }

  // Per Tim, 2026-09-05 — "I don't really need a notification when Boston
  // Harbor water restoration books a job because I already get the email
  // from them": unlike a portal booking (no natural "here's the request"
  // email — see book/book-guest routes, which still send this), the
  // client's own original order email IS the notification here, and this
  // job's own thread is seeded from it (email_gmail_thread_id above) for
  // exactly this reason — "the whole point of this feature." A second,
  // separate owner-notification email would be a second thread for the
  // same job, working against "one email chain per job."

  return { jobId: job.id, projectNumber, serviceLabel: serviceTypeLabel, address: formattedAddress };
}
