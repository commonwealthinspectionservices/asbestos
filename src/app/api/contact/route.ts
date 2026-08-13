import { NextRequest, NextResponse } from "next/server";
import { withApiErrors } from "@/lib/api-handler";
import { sendEmail, emailShell } from "@/lib/email";
import { escapeHtml } from "@/lib/html";

// The public Contact page's inquiry form — internal-only notification to
// the owner, same as every other admin alert (booking-notify.ts,
// route-runner.ts, area-health.ts). Never auto-replies to the sender, per
// the client-email allowlist: the owner follows up manually.
export const POST = withApiErrors(async (req: NextRequest) => {
  const body = await req.json().catch(() => null);
  const name = body?.name?.trim();
  const email = body?.email?.trim();
  const phone = body?.phone?.trim();
  const message = body?.message?.trim();
  // Honeypot — a real visitor never sees or fills this field (hidden via
  // CSS in ContactForm), so a non-empty value here means a bot filled
  // every field it could find. Silently accept without emailing rather
  // than error, so the bot gets no signal to adapt to.
  const website = body?.website?.trim();

  if (!name || !email || !message) {
    return NextResponse.json({ error: "Name, email, and message are required" }, { status: 400 });
  }
  if (website) {
    return NextResponse.json({ ok: true });
  }

  const rows = [
    ["Name", name],
    ["Email", email],
    ...(phone ? [["Phone", phone]] : []),
  ];
  const tableRows = rows
    .map(
      ([label, value]) =>
        `<tr><td style="padding:4px 8px 4px 0; color:#64748b; white-space:nowrap; vertical-align:top;">${escapeHtml(label)}</td><td>${escapeHtml(value)}</td></tr>`
    )
    .join("");

  await sendEmail({
    to: process.env.OWNER_EMAIL!,
    subject: `New contact form message from ${name}`,
    html: emailShell(`
      <p style="font-size:15px;">Someone submitted the Contact page's inquiry form.</p>
      <table style="width:100%; font-size:14px; color:#16213a;">${tableRows}</table>
      <p style="margin-top:12px; font-size:14px; color:#16213a; white-space:pre-wrap;">${escapeHtml(message)}</p>
    `),
  });

  return NextResponse.json({ ok: true });
});
