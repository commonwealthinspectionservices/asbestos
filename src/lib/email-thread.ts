// Shared helpers for keeping a job's whole customer-facing email history
// (request received -> confirmed -> final report/invoice draft) in one
// real Gmail thread. Originally tried doing this purely through Resend
// with a self-assigned Message-ID, but Resend (backed by Amazon SES)
// silently overwrites Message-ID with its own on every send and never
// exposes what it actually used — confirmed by a real test send, not
// assumed. That makes correct In-Reply-To/References impossible to build
// through Resend at all, for any link in the chain.
//
// So the two thread-anchor emails (request received, confirmed) send
// through Gmail instead (gmail.send — see the SCOPES comment in
// lib/gmail.ts for why that's a deliberate, narrow exception), using a
// mailbox this app actually owns. That means, unlike Resend, we can read
// back the real Message-ID Gmail assigned after sending rather than
// guessing at it — and pass Gmail's own threadId along too, so the final
// report/invoice draft can join the exact same thread via createDraft.
//
// Falls back to Resend (see lib/email.ts) whenever Gmail isn't connected,
// so these emails still send even if the Gmail connection is down — just
// without joining the thread that time.
import { sendEmail, FROM } from "@/lib/email";
import { getValidAccessToken, sendMessage, getMessageIdHeader, getThreadParticipants } from "@/lib/gmail";
import { inspectionReportSubjectPrefix, jobReportDomains, type ReportDomain } from "@/lib/report-findings";
import { expandAddress } from "@/lib/address";

// "Asbestos Inspection Report - 36 Drummer Road, Acton, MA" — kept stable
// across the whole chain (request received -> confirmed -> final report
// draft) so every email in a job's thread shares one subject, per Tim.
// serviceType drives the domain prefix; omitted (or empty) falls back to
// the bare address rather than guessing a domain that isn't known yet. Per
// Tim, 2026-08-31 — the prefix and address must be separated by " - ", not
// just a space. expandAddress — per Tim, no abbreviation ("St", "Dr",
// "Rd", ...) anywhere on the system.
export function threadSubject(address: string, serviceType: string | null | undefined): string {
  const fullAddress = expandAddress(address);
  if (!serviceType) return fullAddress;
  return `${inspectionReportSubjectPrefix(serviceType)} - ${fullAddress}`;
}

// Per Tim, 2026-09-11 — booking-notify.ts's "This job is now scheduled"
// email (sendJobScheduledNotification/sendJobCreatedScheduledNotification)
// fires before any report exists — no findings, no lab results, nothing
// to report yet — so it can't honestly share threadSubject's "...Report -
// <address>" phrasing the way every later email in the thread does. Own,
// stable subject for just that one email; every other email in the chain
// still shares threadSubject as before (per that function's own comment).
// Per Tim, 2026-09-15 — "instead of saying inspection confirmed... just
// say service type", then the same day: "any type of mold service type
// should be mold inspection and any type of asbestos service type
// should be asbestos inspection" — not job.service_type verbatim (which
// can be a specific label like "Pre-Renovation Asbestos Inspection" or
// "Mold Bulk Sampling"), but the same domain-normalized "Asbestos" /
// "Mold" / "Lead" naming inspectionReportSubjectPrefix already uses for
// every later email in this same thread, just without its "Report"
// suffix (nothing's been reported on yet at this stage either — same
// reasoning as this function's own history above). Fixed Asbestos/Mold/
// Lead order, matching inspectionReportSubjectPrefix's own — "Asbestos +
// Mold Inspection", never "Mold + Asbestos Inspection" for the same job.
const SCHEDULED_SUBJECT_DOMAIN_ORDER: ReportDomain[] = ["asbestos", "mold", "lead"];
const SCHEDULED_SUBJECT_DOMAIN_LABEL: Record<ReportDomain, string> = { asbestos: "Asbestos", mold: "Mold", lead: "Lead" };
export function scheduledNotificationSubject(address: string, serviceType: string | null | undefined): string {
  const present = new Set(jobReportDomains(serviceType));
  const labels = SCHEDULED_SUBJECT_DOMAIN_ORDER.filter((d) => present.has(d)).map((d) => SCHEDULED_SUBJECT_DOMAIN_LABEL[d]);
  const prefix = labels.length > 0 ? `${labels.join(" + ")} Inspection` : "Inspection";
  return `${prefix} - ${expandAddress(address)}`;
}

// Per Tim, 2026-09-12 — sendCustomerBookingReceivedEmail (the very first
// email in a job's thread, always sent with existingMessageIds: []) was
// sharing threadSubject's "...Report - <address>" phrasing too, same
// problem as scheduledNotificationSubject above: nothing has been
// inspected yet, so "Report" doesn't fit. Own, stable subject just for
// that one email; every later email in the chain still shares
// threadSubject as before.
export function bookingRequestSubject(address: string): string {
  return `Inspection Request - ${expandAddress(address)}`;
}

// In-Reply-To is just the immediately previous message; References is the
// full chain, oldest first — standard RFC 5322 convention. Exported for
// lab-email.ts's report/invoice draft, which builds its own headers
// directly (createDraft, unlike the two auto-sent emails, doesn't go
// through sendThreadedEmail below).
export function threadHeaders(existingIds: string[]): Record<string, string> {
  if (existingIds.length === 0) return {};
  return {
    "In-Reply-To": existingIds[existingIds.length - 1],
    References: existingIds.join(" "),
  };
}

export interface ThreadSendResult {
  ok: boolean;
  // Real Message-ID Gmail assigned, if this went through Gmail — feed it
  // into the next call's existingMessageIds. Null when it fell back to
  // Resend (no way to know what Message-ID that used).
  messageId: string | null;
  // Gmail's own thread id, if this went through Gmail — pass it to the
  // next call so the whole chain stays one thread even if a middle link
  // (like this one) had no prior messageId to reply to.
  gmailThreadId: string | null;
}

// Bare address out of FROM ("Commonwealth Inspection Services <tim@...>") —
// used below to keep replyAllFromThread from Cc'ing our own mailbox back to
// itself.
const OWN_ADDRESS = FROM.match(/<([^<>]+)>/)?.[1] ?? FROM;

export async function sendThreadedEmail(params: {
  to: string;
  subject: string;
  html: string;
  existingMessageIds: string[];
  gmailThreadId: string | null;
  // Per Tim, 2026-09-02 — "just make it a reply all": every other
  // From/To/Cc address already on the Gmail thread goes straight into `to`
  // alongside the one on-file address, not split off into Cc — one flat
  // recipient list, no To-vs-Cc distinction to second-guess. Only ever
  // passed true by an admin-initiated, reviewed send (see
  // sendJobScheduledNotification's own comment) — left off by default so
  // the fully-automatic booking-received/confirmed emails keep their
  // existing "no reliable distribution list to auto-reply to" behavior.
  replyAllFromThread?: boolean;
}): Promise<ThreadSendResult> {
  const accessToken = await getValidAccessToken();
  if (accessToken) {
    try {
      let to = params.to;
      if (params.replyAllFromThread && params.gmailThreadId) {
        const participants = await getThreadParticipants(accessToken, params.gmailThreadId);
        const extra = participants.filter(
          (addr) => addr.toLowerCase() !== params.to.toLowerCase() && addr.toLowerCase() !== OWN_ADDRESS.toLowerCase()
        );
        if (extra.length > 0) to = [params.to, ...extra].join(", ");
      }
      const sent = await sendMessage(accessToken, {
        to,
        subject: params.subject,
        bodyHtml: params.html,
        headers: threadHeaders(params.existingMessageIds),
        threadId: params.gmailThreadId ?? undefined,
      });
      const messageId = await getMessageIdHeader(accessToken, sent.id);
      return { ok: true, messageId, gmailThreadId: sent.threadId };
    } catch (err) {
      console.error("sendThreadedEmail: Gmail send failed, falling back to Resend:", err);
    }
  }

  // No Gmail connection, or the send itself failed — the customer should
  // still get the email even though it won't join the thread this time.
  const sentViaResend = await sendEmail({
    to: params.to,
    bcc: process.env.OWNER_EMAIL,
    subject: params.subject,
    html: params.html,
  });
  return { ok: sentViaResend, messageId: null, gmailThreadId: null };
}
