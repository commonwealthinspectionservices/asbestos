import { sendEmail, emailShell } from "@/lib/email";
import { getAppUrl } from "@/lib/app-url";
import { escapeHtml } from "@/lib/html";
import { formatDateDMY, formatRequestedTime, formatRequestedTimeWindow } from "@/lib/date-format";
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
    : [formatDateDMY(params.requestedDate), params.requestedTime].filter(Boolean).join(" — ") || "No date preference given";

  const rows = [
    ["Customer", params.company ? `${params.customerName} (${params.company})` : params.customerName],
    ["Service", params.serviceLabel],
    ["Requested", whenLine],
    ["Address", params.address],
  ];
  if (params.siteContactName || params.siteContactPhone) {
    rows.push(["Site contact", [params.siteContactName, params.siteContactPhone].filter(Boolean).join(" — ")]);
  }
  if (params.scopeOfWork) rows.push(["Scope of work", params.scopeOfWork]);
  if (params.notes) rows.push(["Notes", params.notes]);

  const tableRows = rows
    .map(
      ([label, value]) =>
        `<tr><td style="padding:4px 8px 4px 0; color:#64748b; white-space:nowrap; vertical-align:top;">${escapeHtml(label)}</td><td>${escapeHtml(value)}</td></tr>`
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
 * chat replies, portal invites, signup confirmation, password reset).
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
  businessName: string;
  businessPhone: string;
  projectNumber: string | null;
  serviceLabel: string;
  address: string;
  requestedDate: string | null;
  requestedTime?: string | null;
  scheduleViaContact?: boolean;
}): Promise<void> {
  const firstName = params.customerName?.split(" ")[0] || "there";
  const exactTime = params.requestedTime ? formatRequestedTime(params.requestedTime) : null;
  const timeWindow = params.requestedTime ? formatRequestedTimeWindow(params.requestedTime) : null;
  const whenLine = params.scheduleViaContact
    ? "We'll reach out to your job site contact to schedule"
    : [formatDateDMY(params.requestedDate), exactTime].filter(Boolean).join(" at ") || "No specific date preference given";

  const rows = [
    ["Service", params.serviceLabel],
    ["Address", params.address],
    ["Requested", whenLine],
  ];
  if (params.projectNumber) rows.unshift(["Project #", params.projectNumber]);

  const tableRows = rows
    .map(
      ([label, value]) =>
        `<tr><td style="padding:4px 8px 4px 0; color:#64748b; white-space:nowrap; vertical-align:top;">${escapeHtml(label)}</td><td>${escapeHtml(value)}</td></tr>`
    )
    .join("");

  const result = await sendThreadedEmail({
    to: params.customerEmail,
    subject: threadSubject(params.address, params.projectNumber),
    existingMessageIds: [],
    gmailThreadId: null,
    html: emailShell(`
      <p style="font-size:15px;">Hi ${escapeHtml(firstName)},</p>
      <p style="font-size:15px;">Thanks for requesting an inspection with ${escapeHtml(params.businessName)}. Here's what you requested:</p>
      <table style="width:100%; font-size:14px; color:#16213a;">${tableRows}</table>
      ${timeWindow ? `<p style="font-size:12px; color:#94a3b8; margin-top:6px;">The time above is approximate, and we'll confirm the exact date and time when we're in touch.</p>` : ""}
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
    .select("id, project_number, service_address, service_type, confirmed_date, confirmed_time, confirmation_sent_at, email_thread_message_ids, email_gmail_thread_id, customer_id")
    .eq("id", jobId)
    .maybeSingle();
  if (!job || !job.confirmed_date || job.confirmation_sent_at) return;

  const { data: customer } = await supabase.from("customers").select("name, email").eq("id", job.customer_id).maybeSingle();
  if (!customer?.email) return;

  const { getSettings } = await import("@/lib/settings");
  const settings = await getSettings();

  const firstName = customer.name?.split(" ")[0] || "there";
  const whenLine = job.confirmed_time
    ? `${formatDateDMY(job.confirmed_date)} at ${job.confirmed_time}`
    : formatDateDMY(job.confirmed_date) ?? "";

  const rows = [
    ["Service", job.service_type ?? ""],
    ["Address", job.service_address],
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
    subject: threadSubject(job.service_address, job.project_number),
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
