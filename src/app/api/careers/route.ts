import { NextRequest, NextResponse } from "next/server";
import { withApiErrors } from "@/lib/api-handler";
import { sendEmail, emailShell } from "@/lib/email";
import { escapeHtml } from "@/lib/html";
import { getSupabaseAdmin } from "@/lib/supabase";

// The public /careers page's interest form — same "internal-only owner
// notification, no auto-reply, admin follows up manually" pattern as
// api/contact/route.ts. Also persists the submission (career_interest_
// submissions table) so nothing is lost if the notification email itself
// fails to send.
export const POST = withApiErrors(async (req: NextRequest) => {
  const body = await req.json().catch(() => null);
  const name = body?.name?.trim();
  const email = body?.email?.trim();
  const phone = body?.phone?.trim();
  const isFirefighter = Boolean(body?.isFirefighter);
  const firefighterDepartment = body?.firefighterDepartment?.trim() || null;
  const availabilityNotes = body?.availabilityNotes?.trim() || null;
  // Honeypot — same convention as the Contact form (see its own comment).
  const website = body?.website?.trim();

  if (!name || !email || !phone) {
    return NextResponse.json({ error: "Name, email, and phone are required" }, { status: 400 });
  }
  if (website) {
    return NextResponse.json({ ok: true });
  }

  const supabase = getSupabaseAdmin();
  const { error: insertError } = await supabase.from("career_interest_submissions").insert({
    name,
    email,
    phone,
    is_firefighter: isFirefighter,
    firefighter_department: firefighterDepartment,
    availability_notes: availabilityNotes,
  });
  if (insertError) {
    console.error("Failed to save career interest submission:", insertError);
  }

  const rows = [
    ["Name", name],
    ["Email", email],
    ["Phone", phone],
    ["Firefighter?", isFirefighter ? "Yes" : "No"],
    ...(isFirefighter && firefighterDepartment ? [["Department", firefighterDepartment]] : []),
  ];
  const tableRows = rows
    .map(
      ([label, value]) =>
        `<tr><td style="padding:4px 8px 4px 0; color:#64748b; white-space:nowrap; vertical-align:top;">${escapeHtml(label)}</td><td>${escapeHtml(value)}</td></tr>`
    )
    .join("");

  await sendEmail({
    to: process.env.OWNER_EMAIL!,
    subject: `New careers interest form from ${name}`,
    html: emailShell(`
      <p style="font-size:15px;">Someone submitted the Careers page's interest form.</p>
      <table style="width:100%; font-size:14px; color:#16213a;">${tableRows}</table>
      ${availabilityNotes ? `<p style="margin-top:12px; font-size:14px; color:#16213a;"><strong>Availability/schedule notes:</strong></p><p style="font-size:14px; color:#16213a; white-space:pre-wrap;">${escapeHtml(availabilityNotes)}</p>` : ""}
    `),
  });

  return NextResponse.json({ ok: true });
});
