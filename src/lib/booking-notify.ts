import { sendEmail, emailShell } from "@/lib/email";
import { getAppUrl } from "@/lib/app-url";
import { escapeHtml } from "@/lib/html";
import { expandAddress } from "@/lib/address";
import { formatDateMDY, formatRequestedTime, formatRequestedTimeWindow } from "@/lib/date-format";
import { getSupabaseAdmin } from "@/lib/supabase";
import { threadSubject, sendThreadedEmail } from "@/lib/email-thread";

/**
 * Every new booking — anonymous (/api/book) or portal (/api/portal/book) —
 * lands as a request (status "needs_scheduling"), not an auto-confirmed
 * job; nothing becomes a real confirmed_date/confirmed_time until the
 * owner deliberately sets one from the admin dashboard. This is what tells
 * them a request is sitting there waiting on that decision.
 */
export async function sendNewBookingRequestEmail(params: {
  jobId: string;
  projectNumber: string | null;
  customerName: string;
  company?: string | null;
  address: string;
  serviceLabel: string;
  requestedDate: string | null;
  requestedTime?: string | null;
  scheduleViaContact?: boolean;
  scopeOfWork?: string | null;
  notes?: string | null;
  siteContactName?: string | null;
  siteContactPhone?: string | null;
}): Promise<void> {
  const appUrl = getAppUrl();
  const jobUrl = appUrl ? `${appUrl}/admin/dashboard?jobId=${params.jobId}` : null;

  const whenLine = params.scheduleViaContact
    ? "To be scheduled with the job site contact"
    : [formatDateMDY(params.requestedDate), params.requestedTime].filter(Boolean).join(" — ") || "No date preference given";

  const rows = [
    ["Customer", params.company ? `${params.customerName} (${params.company})` : params.customerName],
    ["Service", params.serviceLabel],
    ["Requested", whenLine],
    ["Address", expandAddress(params.address)],
  ];
  if (params.siteContactName || params.siteContactPhone) {
    rows.push(["Site contact", [params.siteContactName, params.siteContactPhone].filter(Boolean).join(" — ")]);
  }
  if (params.scopeOfWork) rows.push(["Scope of work", params.scopeOfWork]);
  if (params.notes) rows.push(["Notes", params.notes]);

  const tableRows = rows
    .map(
      ([label, value]) =>
        `<tr><td style="padding:4px 8px 4px 0; color:#64748b; white-space:nowrap; vertical-align:top;">${escapeHtml(label)}</td><td style="white-space:pre-wrap; overflow-wrap:anywhere;">${escapeHtml(value)}</td></tr>`
    )
    .join("");

  await sendEmail({
    to: process.env.OWNER_EMAIL!,
    subject: `New booking request${params.projectNumber ? ` — ${params.projectNumber}` : ""}`,
    html: emailShell(`
      <p style="font-size:15px;">A new booking request came in — nothing is scheduled yet, it's waiting on you.</p>
      <table style="width:100%; font-size:14px; color:#16213a;">${tableRows}</table>
      ${jobUrl ? `<p style="margin-top:16px;"><a href="${jobUrl}" style="display:inline-block; background:#193466; color:#fff; padding:10px 16px; border-radius:8px; text-decoration:none; font-size:14px;">Review and confirm</a></p>` : ""}
    `),
  });
}

/**
 * Auto-sent to the customer the moment they submit a request — added
 * 2026-08-15 per explicit owner request, a deliberate addition to the
 * small set of emails this app is allowed to auto-send (previously just
 * portal invites, signup confirmation, password reset).
 * Confirms receipt only — nothing is actually scheduled yet.
 *
 * Also the root of this job's email thread (see lib/email-thread.ts) — it
 * sends through Gmail (gmail.send, a deliberately narrow exception — see
 * lib/gmail.ts's SCOPES comment) rather than Resend specifically so the
 * later "confirmed" email, and eventually the final report/invoice Gmail
 * draft, can join it as real replies in the same conversation instead of
 * three separate emails. Falls back to Resend if Gmail isn't connected —
 * the customer still gets the email either way, just not threaded that time.
 */
export async function sendCustomerBookingReceivedEmail(params: {
  jobId: string;
  customerEmail: string;
  customerName: string;
  businessPhone: string;
  projectNumber: string | null;
  serviceLabel: string;
  address: string;
  requestedDate: string | null;
  requestedTime?: string | null;
  scheduleViaContact?: boolean;
  scopeOfWork?: string | null;
  siteContactName?: string | null;
  siteContactPhone?: string | null;
  notes?: string | null;
}): Promise<void> {
  const firstName = params.customerName?.split(" ")[0] || "there";
  const exactTime = params.requestedTime ? formatRequestedTime(params.requestedTime) : null;
  const timeWindow = params.requestedTime ? formatRequestedTimeWindow(params.requestedTime) : null;

  // Requested date/time are their own rows (not one combined "Requested"
  // line) so the approximate-time disclaimer below can sit directly under
  // the actual time it's talking about, rather than trailing the whole
  // table after Scope of work/Notes.
  const topRows: [string, string][] = [
    ["Service", params.serviceLabel],
    ["Address", expandAddress(params.address)],
  ];
  if (params.scheduleViaContact) {
    topRows.push(["Requested", "We'll reach out to your job site contact to schedule"]);
  } else {
    topRows.push(["Requested date", formatDateMDY(params.requestedDate) ?? "No specific date preference given"]);
    topRows.push(["Requested time", exactTime ?? "No preference"]);
  }
  if (params.projectNumber) topRows.unshift(["Project #", params.projectNumber]);

  const bottomRows: [string, string][] = [];
  if (params.scopeOfWork) bottomRows.push(["Scope of work", params.scopeOfWork]);
  // Only shown when it's someone other than the requester themselves — an
  // individual booking for their own home already sees their own name at
  // the top of this email, so repeating it here as "Job site contact"
  // would just be noise. A company's job site contact is a genuinely
  // different person worth confirming back to them.
  if (params.siteContactName && params.siteContactName !== params.customerName) {
    bottomRows.push(["Job site contact", [params.siteContactName, params.siteContactPhone].filter(Boolean).join(" — ")]);
  }
  if (params.notes) bottomRows.push(["Notes", params.notes]);

  // Fixed label-column width, not left to each <table> to auto-size —
  // topRows/bottomRows render as two separate tables (see below) so the
  // approximate-time note can sit between them, and two tables auto-sizing
  // independently would misalign their value columns against each other.
  const renderRows = (rows: [string, string][]) =>
    rows
      .map(
        ([label, value]) =>
          `<tr><td style="width:130px; padding:4px 8px 4px 0; color:#64748b; white-space:nowrap; vertical-align:top;">${escapeHtml(label)}</td><td style="white-space:pre-wrap; overflow-wrap:anywhere;">${escapeHtml(value)}</td></tr>`
      )
      .join("");

  const result = await sendThreadedEmail({
    to: params.customerEmail,
    subject: threadSubject(params.address, params.serviceLabel),
    existingMessageIds: [],
    gmailThreadId: null,
    html: emailShell(`
      <p style="font-size:15px;">Hi ${escapeHtml(firstName)},</p>
      <p style="font-size:15px;">Thanks for requesting an inspection — here's a summary of your request:</p>
      <table style="width:100%; font-size:14px; color:#16213a;">${renderRows(topRows)}</table>
      ${timeWindow ? `<p style="font-size:12px; color:#94a3b8; margin-top:6px;">The time above is approximate, and we'll confirm the exact date and time when we're in touch.</p>` : ""}
      ${bottomRows.length > 0 ? `<table style="width:100%; font-size:14px; color:#16213a; margin-top:6px;">${renderRows(bottomRows)}</table>` : ""}
      <p style="font-size:15px; margin-top:16px;">We'll be in touch shortly to confirm an exact date and time.</p>
      <p style="font-size:15px;">Questions in the meantime? Call us at ${escapeHtml(params.businessPhone)}.</p>
    `),
  });
  if (result.ok) {
    await getSupabaseAdmin()
      .from("jobs")
      .update({
        email_thread_message_ids: result.messageId ? [result.messageId] : [],
        email_gmail_thread_id: result.gmailThreadId,
      })
      .eq("id", params.jobId);
  }
}

/**
 * The second link in a job's email thread (see sendCustomerBookingReceivedEmail
 * above) — fires once, the moment a job's confirmed_date first goes from
 * empty to set (see the PATCH route's own trigger logic), which is
 * mechanically the same moment schedule_visible_to_customer turns on (a
 * job's confirmed_date/time only ever reach a real value once that's true
 * — see api/admin/jobs/[id]/route.ts). Re-fetches everything itself rather
 * than trusting caller-supplied data, matching autoDraftReportIfJustPaid's
 * own pattern — this runs as a best-effort side effect of a PATCH the
 * caller already committed, so a stale read here should never be able to
 * corrupt that already-successful save.
 */
export async function sendJobConfirmedEmailIfDue(jobId: string): Promise<void> {
  const supabase = getSupabaseAdmin();
  const { data: job } = await supabase
    .from("jobs")
    .select("id, project_number, service_address, service_type, confirmed_date, confirmed_time, confirmation_sent_at, email_thread_message_ids, email_gmail_thread_id, customer_id, source")
    .eq("id", jobId)
    .maybeSingle();
  if (!job || !job.confirmed_date || job.confirmation_sent_at) return;
  // email_intake jobs (see lib/job-intake.ts) are threaded into a
  // conversation a real client started, with a real distribution list
  // (whoever they CC'd) this app has no reliable way to reconstruct —
  // sending an auto-generated reply there, to just the one on-file company
  // contact, isn't the same manual back-and-forth the owner actually wants
  // for this intake channel. No automated sends at all for these; every
  // reply is manual, same as the existing process.
  if (job.source === "email_intake") return;
  // Same reasoning as email_intake above — the "customer" on file for a
  // subcontracted job is the subcontracting company's own contact (e.g.
  // Fast Mold Testing), who already knows the schedule through their own
  // system. A generated "your inspection is confirmed" email to them reads
  // as a stray, out-of-context system message, not a real client update —
  // confirmed the hard way when AcceptScheduleControl's subcontractor path
  // (source !== "portal_booking"/"email_intake" was the only guard here)
  // sent exactly that to a real contact. schedule_visible_to_customer being
  // false doesn't prevent this either — this trigger only checks whether
  // confirmed_date just went from empty to set, independent of visibility.
  if (job.source === "subcontractor") return;

  const { data: customer } = await supabase.from("customers").select("name, email, is_individual").eq("id", job.customer_id).maybeSingle();
  if (!customer?.email) return;
  // Same reasoning again, one level down: a company customer already knows
  // its own schedule — it's either who set it, or a contact who negotiated
  // it directly, same as the subcontractor case above. Only individual
  // homeowners get this.
  if (!customer.is_individual) return;

  const { getSettings } = await import("@/lib/settings");
  const settings = await getSettings();

  const firstName = customer.name?.split(" ")[0] || "there";
  const whenLine = job.confirmed_time
    ? `${formatDateMDY(job.confirmed_date)} at ${formatRequestedTime(job.confirmed_time)}`
    : formatDateMDY(job.confirmed_date) ?? "";

  const rows = [
    ["Service", job.service_type ?? ""],
    ["Address", expandAddress(job.service_address)],
    ["Confirmed", whenLine],
  ];
  if (job.project_number) rows.unshift(["Project #", job.project_number]);

  const tableRows = rows
    .map(
      ([label, value]) =>
        `<tr><td style="padding:4px 8px 4px 0; color:#64748b; white-space:nowrap; vertical-align:top;">${escapeHtml(label)}</td><td>${escapeHtml(value ?? "")}</td></tr>`
    )
    .join("");

  const existingIds: string[] = Array.isArray(job.email_thread_message_ids) ? job.email_thread_message_ids : [];
  const result = await sendThreadedEmail({
    to: customer.email,
    subject: threadSubject(job.service_address, job.service_type),
    existingMessageIds: existingIds,
    gmailThreadId: job.email_gmail_thread_id,
    html: emailShell(`
      <p style="font-size:15px;">Hi ${escapeHtml(firstName)},</p>
      <p style="font-size:15px;">Your inspection with ${escapeHtml(settings.business_name)} is confirmed:</p>
      <table style="width:100%; font-size:14px; color:#16213a;">${tableRows}</table>
      <p style="font-size:15px; margin-top:16px;">Questions in the meantime? Call us at ${escapeHtml(settings.business_phone)}.</p>
    `),
  });
  if (result.ok) {
    await supabase
      .from("jobs")
      .update({
        email_thread_message_ids: result.messageId ? [...existingIds, result.messageId] : existingIds,
        email_gmail_thread_id: result.gmailThreadId ?? job.email_gmail_thread_id,
        confirmation_sent_at: new Date().toISOString(),
      })
      .eq("id", job.id);
  }
}

/**
 * Per Tim, 2026-08-30 — "when I move it from To Be Scheduled to Scheduled
 * officially, it should ask me, would you like to send them an email
 * notification" — the email_intake counterpart to
 * sendJobConfirmedEmailIfDue above, which deliberately skips this source
 * (see its own comment: no reliable distribution list to auto-reply to).
 * This one is never automatic — only ever called when the admin explicitly
 * opts in via that prompt, so the "who's really on this thread" concern
 * doesn't apply the same way: it's a deliberate, reviewed decision each
 * time, not a blind auto-send. Reuses confirmation_sent_at as the same
 * "already notified" marker sendJobConfirmedEmailIfDue uses, so the
 * existing "Confirmation sent {date}" tracking text picks it up too.
 *
 * Per Tim, 2026-09-02 — "just make it a reply all": replyAllFromThread adds
 * every other address already on the thread (see sendThreadedEmail's own
 * comment) into `to`, not just the one on-file customer.email — the same
 * "deliberate, reviewed send" reasoning above is exactly why this is the
 * one place that's safe to turn on.
 */
// Per Tim, 2026-09-02 — "when i enter in a job myself i want it to give me
// the same option of sending email notification but show me what it'd
// say": the HTML-building split out from sendJobScheduledNotification below
// so a preview endpoint (see /api/admin/preview-scheduled-email) can render
// the exact same markup the real send would use, from the Add Project
// form's own in-progress values — no separate, driftable copy of this
// markup anywhere else.
export function buildJobScheduledEmailHtml(params: {
  jobId?: string | null;
  projectNumber: string | null;
  serviceAddress: string;
  confirmedDate: string;
  confirmedTime: string | null;
}): string {
  // Per Tim, 2026-08-30 (follow-up, after seeing a preview) — "delete the
  // line with service... list it out as scheduled date on one line and
  // scheduled time on the next line below it. Also, delete the part where
  // it says let us know if anything changes, and also delete my
  // information at the bottom": wants this one genuinely tiny, not the
  // fuller confirmation-email format sendJobConfirmedEmailIfDue uses.
  const rows = [
    ["Address", expandAddress(params.serviceAddress)],
    ["Scheduled date", formatDateMDY(params.confirmedDate) ?? ""],
    ["Scheduled time", (params.confirmedTime ? formatRequestedTime(params.confirmedTime) : "") ?? ""],
  ];
  if (params.projectNumber) rows.unshift(["Project #", params.projectNumber]);

  const tableRows = rows
    .map(
      ([label, value]) =>
        `<tr><td style="padding:4px 8px 4px 0; color:#64748b; white-space:nowrap; vertical-align:top;">${escapeHtml(label)}</td><td>${escapeHtml(value ?? "")}</td></tr>`
    )
    .join("");

  // Per Tim, 2026-09-02 — "it should also give them a link to view the job
  // in their client portal": mirrors sendNewBookingRequestEmail's own
  // "Review and confirm" button, pointed at the customer-facing
  // /portal/dashboard?jobId= deep link (see ProjectsList.tsx) instead of
  // the admin one. No jobId (e.g. this preview being built from Add
  // Project's in-progress form, before the job exists) just omits it.
  const appUrl = getAppUrl();
  const portalUrl = appUrl && params.jobId ? `${appUrl}/portal/dashboard?jobId=${params.jobId}` : null;

  return emailShell(
    `
      <p style="font-size:15px;">This job is now scheduled:</p>
      <table style="width:100%; font-size:14px; color:#16213a;">${tableRows}</table>
      ${portalUrl ? `<p style="margin-top:16px;"><a href="${portalUrl}" style="display:inline-block; background:#193466; color:#fff; padding:10px 16px; border-radius:8px; text-decoration:none; font-size:14px;">View in your client portal</a></p>` : ""}
    `,
    { signature: false }
  );
}

export async function sendJobScheduledNotification(jobId: string): Promise<void> {
  const supabase = getSupabaseAdmin();
  const { data: job } = await supabase
    .from("jobs")
    .select("id, project_number, service_address, service_type, confirmed_date, confirmed_time, email_thread_message_ids, email_gmail_thread_id, customer_id")
    .eq("id", jobId)
    .maybeSingle();
  if (!job || !job.confirmed_date) return;

  const { data: customer } = await supabase.from("customers").select("email").eq("id", job.customer_id).maybeSingle();
  if (!customer?.email) return;

  const existingIds: string[] = Array.isArray(job.email_thread_message_ids) ? job.email_thread_message_ids : [];
  const result = await sendThreadedEmail({
    to: customer.email,
    subject: threadSubject(job.service_address, job.service_type),
    existingMessageIds: existingIds,
    gmailThreadId: job.email_gmail_thread_id,
    replyAllFromThread: true,
    html: buildJobScheduledEmailHtml({
      jobId: job.id,
      projectNumber: job.project_number,
      serviceAddress: job.service_address,
      confirmedDate: job.confirmed_date,
      confirmedTime: job.confirmed_time,
    }),
  });
  if (result.ok) {
    await supabase
      .from("jobs")
      .update({
        email_thread_message_ids: result.messageId ? [...existingIds, result.messageId] : existingIds,
        email_gmail_thread_id: result.gmailThreadId ?? job.email_gmail_thread_id,
        confirmation_sent_at: new Date().toISOString(),
      })
      .eq("id", job.id);
  }
}

/**
 * Per Tim, 2026-09-02 — "when i enter in a job myself i want it to give me
 * the same option of sending email notification": the Add Project
 * counterpart to sendJobScheduledNotification above, for a job the admin
 * is entering with a "Scheduled" starting status (fieldwork already
 * arranged, e.g. over the phone) rather than moving there later from "To
 * Be Scheduled". Reads requested_date/requested_time, not
 * confirmed_date/confirmed_time — the create route (api/admin/jobs)
 * deliberately leaves confirmed_date/confirmed_time null at creation
 * regardless of starting status (see its own comment), so
 * sendJobScheduledNotification's confirmed_date requirement would never
 * be satisfied here. Same underlying email (buildJobScheduledEmailHtml),
 * same "deliberate, reviewed send" reasoning for replyAllFromThread — the
 * admin is choosing to send this right now, same as the other one.
 */
export async function sendJobCreatedScheduledNotification(jobId: string): Promise<void> {
  const supabase = getSupabaseAdmin();
  const { data: job } = await supabase
    .from("jobs")
    .select("id, project_number, service_address, service_type, requested_date, requested_time, email_thread_message_ids, email_gmail_thread_id, customer_id")
    .eq("id", jobId)
    .maybeSingle();
  if (!job || !job.requested_date) return;

  const { data: customer } = await supabase.from("customers").select("email").eq("id", job.customer_id).maybeSingle();
  if (!customer?.email) return;

  const existingIds: string[] = Array.isArray(job.email_thread_message_ids) ? job.email_thread_message_ids : [];
  const result = await sendThreadedEmail({
    to: customer.email,
    subject: threadSubject(job.service_address, job.service_type),
    existingMessageIds: existingIds,
    gmailThreadId: job.email_gmail_thread_id,
    replyAllFromThread: true,
    html: buildJobScheduledEmailHtml({
      jobId: job.id,
      projectNumber: job.project_number,
      serviceAddress: job.service_address,
      confirmedDate: job.requested_date,
      confirmedTime: job.requested_time,
    }),
  });
  if (result.ok) {
    await supabase
      .from("jobs")
      .update({
        email_thread_message_ids: result.messageId ? [...existingIds, result.messageId] : existingIds,
        email_gmail_thread_id: result.gmailThreadId ?? job.email_gmail_thread_id,
        confirmation_sent_at: new Date().toISOString(),
      })
      .eq("id", job.id);
  }
}
