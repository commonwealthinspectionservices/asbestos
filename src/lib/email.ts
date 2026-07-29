import { Resend } from "resend";
import { getAppUrl } from "@/lib/app-url";

let resendClient: Resend | null = null;

function getResend(): Resend {
  if (resendClient) return resendClient;
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error("Missing RESEND_API_KEY env var");
  resendClient = new Resend(key);
  return resendClient;
}

const FROM = "Commonwealth Inspection Services <booking@commonwealthinspection.com>";

export async function sendEmail(opts: {
  to: string | string[];
  subject: string;
  html: string;
}) {
  // Email delivery failures — including a missing/misconfigured API key —
  // shouldn't take down a booking or cron run that already succeeded on
  // the side that matters (the DB write). Log and continue rather than
  // throwing, for every failure mode, not just the ones Resend reports
  // via its `error` return value.
  try {
    const resend = getResend();
    const { error } = await resend.emails.send({
      from: FROM,
      to: opts.to,
      subject: opts.subject,
      html: opts.html,
    });
    if (error) {
      console.error("Resend send failed:", error);
    }
  } catch (err) {
    console.error("sendEmail failed:", err);
  }
}

export function emailShell(bodyHtml: string): string {
  const appUrl = getAppUrl();
  const logoImg = appUrl
    ? `<img src="${appUrl}/logo.png" width="32" height="32" alt="" style="display:block; border-radius:50%;" />`
    : "";

  return `<!doctype html>
<html>
  <body style="font-family: -apple-system, Segoe UI, Roboto, sans-serif; background:#f4f6fb; margin:0; padding:24px;">
    <table role="presentation" width="100%" style="max-width:560px; margin:0 auto; background:#ffffff; border-radius:12px; overflow:hidden; border:1px solid #e2e8f0;">
      <tr>
        <td style="background:#193466; padding:20px 24px;">
          <table role="presentation"><tr>
            ${logoImg ? `<td style="padding-right:10px;">${logoImg}</td>` : ""}
            <td><span style="color:#ffffff; font-size:16px; font-weight:600;">Commonwealth Inspection Services, LLC.</span></td>
          </tr></table>
        </td>
      </tr>
      <tr>
        <td style="padding:24px;">
          ${bodyHtml}
        </td>
      </tr>
    </table>
  </body>
</html>`;
}
