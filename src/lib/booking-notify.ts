import { sendEmail, emailShell } from "@/lib/email";
import { getAppUrl } from "@/lib/app-url";
import { escapeHtml } from "@/lib/html";

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
    : [params.requestedDate, params.requestedTime].filter(Boolean).join(" — ") || "No date preference given";

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
