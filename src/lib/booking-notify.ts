import { sendEmail, emailShell } from "@/lib/email";
import { getAppUrl } from "@/lib/app-url";
import { escapeHtml } from "@/lib/html";
import { formatDateDMY } from "@/lib/date-format";

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
 */
export async function sendCustomerBookingReceivedEmail(params: {
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
  const whenLine = params.scheduleViaContact
    ? "We'll reach out to your job site contact to schedule"
    : [formatDateDMY(params.requestedDate), params.requestedTime].filter(Boolean).join(" at ") || "No specific date preference given";

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

  await sendEmail({
    to: params.customerEmail,
    subject: `We received your request${params.projectNumber ? ` — ${params.projectNumber}` : ""}`,
    html: emailShell(`
      <p style="font-size:15px;">Hi ${escapeHtml(firstName)},</p>
      <p style="font-size:15px;">Thanks for requesting an inspection with ${escapeHtml(params.businessName)}. We've received your request:</p>
      <table style="width:100%; font-size:14px; color:#16213a;">${tableRows}</table>
      <p style="font-size:15px; margin-top:16px;">We'll follow up shortly to confirm a date and time.</p>
      <p style="font-size:15px;">Questions in the meantime? Call us at ${escapeHtml(params.businessPhone)}.</p>
    `),
  });
}
