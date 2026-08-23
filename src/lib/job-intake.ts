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
import { getSupabaseAdmin } from "@/lib/supabase";
import { getSettings } from "@/lib/settings";
import { geocodeAddress, GeocodeError, isWithinServiceStates } from "@/lib/geocode";
import { generateProjectNumber } from "@/lib/project-number";
import { resolveServiceSelection } from "@/lib/portal-booking";
import { parseAcmOrderEmail, type ParsedJobIntake } from "@/lib/parse-job-intake";
import { sendNewBookingRequestEmail } from "@/lib/booking-notify";
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
  type GmailMessage,
} from "@/lib/gmail";
import type { Settings } from "@/lib/types";

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
  /** Gmail search term — narrows candidates before the real content check (parseAcmOrderEmail) decides. */
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

  for (const sender of KNOWN_SENDERS) {
    // No `from:` filter here — a real order the owner forwarded on to this
    // inbox himself carries his own From header, not the sender's, so a
    // from:-filtered search would never even see it. The subject hint
    // still does the real narrowing; sender identity is checked below
    // against either the direct From header or, for a forward, the
    // original sender embedded in Gmail's forward boilerplate.
    const query = `is:unread subject:"${sender.subjectHint}" newer_than:14d`;
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
        result.created.push({ projectNumber: job.projectNumber, jobId: job.jobId });
      } catch (err) {
        console.error(`checkForJobIntakeEmails: failed to process message ${candidate.id}:`, err);
        await alertOwnerOfIntakeIssue({
          sender, from, subject,
          reason: err instanceof Error ? err.message : "Unknown error while creating the job.",
          bodyExcerpt: bodyText,
        });
        await markMessageRead(accessToken, candidate.id);
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
  // first," which has no ordering guarantee at all.
  const customer = contacts.find((c) => c.id === company.billing_contact_id) ?? contacts[0];

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
  // reason to resend "just in case." Same address + same requested date
  // for this company within the last few days is treated as a likely
  // duplicate rather than silently creating a second identical job.
  const contactIds = contacts.map((c) => c.id);
  const { data: possibleDuplicate } = await supabase
    .from("jobs")
    .select("project_number")
    .in("customer_id", contactIds)
    .eq("requested_date", parsed.requestedDate)
    .eq("service_address", formattedAddress)
    .gte("created_at", new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString())
    .limit(1)
    .maybeSingle();
  if (possibleDuplicate) {
    throw new Error(
      `Looks like a duplicate of ${possibleDuplicate.project_number} — same address and requested date, created in the last 3 days.`
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
      requested_date: parsed.requestedDate,
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
      // Seeds this job's own email thread with the client's original
      // message, so the later confirmed/reminder/report emails (see
      // lib/booking-notify.ts, lib/job-reminders.ts) all join the exact
      // same conversation Boston Harbor started, not a new one the app
      // started — the whole point of this feature.
      email_gmail_thread_id: message.threadId,
      email_thread_message_ids: rfcMessageId ? [rfcMessageId] : [],
    })
    .select("id")
    .single();

  if (error || !job) {
    throw new Error(`Failed to create job from email intake: ${error?.message}`);
  }

  try {
    await sendNewBookingRequestEmail({
      jobId: job.id,
      projectNumber,
      customerName: parsed.homeownerName,
      company: sender.companyName,
      address: formattedAddress,
      serviceLabel: serviceTypeLabel,
      requestedDate: parsed.requestedDate,
      requestedTime: null,
      scopeOfWork: parsed.scopeOfWork,
      notes: `Requested by ${parsed.companyContactName} (${formatPhoneNumber(parsed.companyContactPhone)})`,
      siteContactName: parsed.homeownerName,
      siteContactPhone: parsed.homeownerPhone,
    });
  } catch (err) {
    console.error(`createJobFromIntake: owner alert failed for job ${job.id}:`, err);
  }

  return { jobId: job.id, projectNumber, serviceLabel: serviceTypeLabel, address: formattedAddress };
}
