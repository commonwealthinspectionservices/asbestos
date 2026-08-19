import { sendEmail, emailShell } from "@/lib/email";
import { escapeHtml } from "@/lib/html";
import { formatDateMDY } from "@/lib/date-format";
import { getSupabaseAdmin } from "@/lib/supabase";
import { getSettings } from "@/lib/settings";
import { nowInTimeZone, addDaysIso } from "@/lib/tz";
import { threadSubject, threadHeaders } from "@/lib/email-thread";

// "24 hours before" is treated as "the day before" — a fixed-time daily
// cron (see api/cron/job-reminders) rather than a precise to-the-minute
// countdown, matching how appointment reminders normally work (and far
// simpler than polling for confirmed_time - 24h, which would need a much
// tighter cron interval for no real benefit — the owner is a single person,
// not a same-day-dispatch operation). Runs every day, including weekends,
// since a Monday job's reminder needs to go out on Sunday.
export function formatConfirmedWhen(confirmedTime: string | null, window: string | null): string {
  if (confirmedTime) {
    const [h, m] = confirmedTime.split(":").map(Number);
    if (!Number.isNaN(h) && !Number.isNaN(m)) {
      const period = h >= 12 ? "PM" : "AM";
      const hour12 = h % 12 || 12;
      return `${hour12}:${String(m).padStart(2, "0")} ${period}`;
    }
  }
  if (window === "AM") return "in the morning";
  if (window === "PM") return "in the afternoon";
  return "";
}

export function buildReminderEmailHtml(params: {
  customerName: string;
  businessName: string;
  businessPhone: string;
  serviceAddress: string;
  confirmedDate: string | null;
  confirmedTime: string | null;
  window: string | null;
}): string {
  const firstName = params.customerName?.split(" ")[0] || "there";
  const datePart = formatDateMDY(params.confirmedDate);
  const timePart = formatConfirmedWhen(params.confirmedTime, params.window);
  const whenLine = datePart && timePart
    ? (params.confirmedTime ? `${datePart} at ${timePart}` : `${datePart}, ${timePart}`)
    : datePart || timePart || "tomorrow";
  return emailShell(`
    <p style="font-size:15px;">Hi ${escapeHtml(firstName)},</p>
    <p style="font-size:15px;">Just a reminder — your inspection with ${escapeHtml(params.businessName)} is coming up ${escapeHtml(whenLine)} at ${escapeHtml(params.serviceAddress)}.</p>
    <p style="font-size:15px;">Questions or need to reschedule? Call us at ${escapeHtml(params.businessPhone)}.</p>
  `);
}

export async function sendJobReminders(): Promise<{ sent: number; failed: number }> {
  const supabase = getSupabaseAdmin();
  const settings = await getSettings();
  const tomorrow = addDaysIso(nowInTimeZone(settings.timezone).dateIso, 1);

  const { data: jobs } = await supabase
    .from("jobs")
    .select("id, project_number, service_address, service_type, confirmed_date, confirmed_time, window, customer_id, email_thread_message_ids, email_gmail_thread_id")
    .eq("status", "scheduled")
    .eq("confirmed_date", tomorrow)
    .is("reminder_sent_at", null)
    // email_intake jobs (see lib/job-intake.ts) get no automated sends at
    // all — see sendJobConfirmedEmailIfDue's own comment for why. The
    // owner's own manual thread with the client is the only place these
    // reminders would need to go anyway, which this cron has no way to do.
    .neq("source", "email_intake");

  let sent = 0;
  let failed = 0;

  for (const job of jobs ?? []) {
    const { data: customer } = await supabase.from("customers").select("name, email").eq("id", job.customer_id).maybeSingle();
    if (!customer?.email) continue;

    const html = buildReminderEmailHtml({
      customerName: customer.name,
      businessName: settings.business_name,
      businessPhone: settings.business_phone,
      serviceAddress: job.service_address,
      confirmedDate: job.confirmed_date,
      confirmedTime: job.confirmed_time,
      window: job.window,
    });

    const existingIds: string[] = Array.isArray(job.email_thread_message_ids) ? job.email_thread_message_ids : [];

    // Best-effort, same as every other automated job email — a failed send
    // shouldn't block the rest of the day's reminders. Sent through Resend
    // (not sendThreadedEmail/Gmail) since this is a one-off heads-up, not
    // part of the reply chain the way the request/confirmation emails are —
    // still threaded via In-Reply-To/References when a thread already
    // exists, just without needing Gmail's own send API for it.
    const ok = await sendEmail({
      to: customer.email,
      subject: threadSubject(job.service_address, job.project_number),
      html,
      headers: threadHeaders(existingIds),
    });

    if (ok) {
      sent++;
      await supabase.from("jobs").update({ reminder_sent_at: new Date().toISOString() }).eq("id", job.id);
    } else {
      failed++;
    }
  }

  return { sent, failed };
}
