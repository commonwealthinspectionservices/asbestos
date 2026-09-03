import { NextRequest, NextResponse } from "next/server";
import { withApiErrors } from "@/lib/api-handler";
import { sendEmail, emailShell } from "@/lib/email";
import { escapeHtml } from "@/lib/html";
import { getSupabaseAdmin } from "@/lib/supabase";

const MAX_RESUME_BYTES = 8 * 1024 * 1024; // 8MB — keep in sync with CareerInterestForm's client-side cap

// The public /careers page's interest form — same "internal-only owner
// notification, no auto-reply, admin follows up manually" pattern as
// api/contact/route.ts. Also persists the submission (career_interest_
// submissions table) so nothing is lost if the notification email itself
// fails to send. The resume, if any, is only ever attached to the
// notification email — not stored — so there's no file storage/bucket to
// provision for this.
export const POST = withApiErrors(async (req: NextRequest) => {
  const body = await req.json().catch(() => null);
  const name = body?.name?.trim();
  const email = body?.email?.trim();
  const phone = body?.phone?.trim();
  const location = body?.location?.trim() || null;
  const isFirefighter = Boolean(body?.isFirefighter);
  const firefighterDepartment = body?.firefighterDepartment?.trim() || null;
  const availabilityNotes = body?.availabilityNotes?.trim() || null;
  const extraNotes = body?.extraNotes?.trim() || null;
  const resumeFilename = body?.resumeFilename?.trim() || null;
  const resumeBase64 = typeof body?.resumeBase64 === "string" ? body.resumeBase64 : null;
  // Honeypot — same convention as the Contact form (see its own comment).
  const website = body?.website?.trim();

  if (!name || !email || !phone) {
    return NextResponse.json({ error: "Name, email, and phone are required" }, { status: 400 });
  }
  if (website) {
    return NextResponse.json({ ok: true });
  }

  let resumeBuffer: Buffer | null = null;
  if (resumeFilename && resumeBase64) {
    resumeBuffer = Buffer.from(resumeBase64, "base64");
    if (resumeBuffer.length > MAX_RESUME_BYTES) {
      return NextResponse.json({ error: "That resume is too large (8MB max)" }, { status: 400 });
    }
  }

  const supabase = getSupabaseAdmin();
  const { error: insertError } = await supabase.from("career_interest_submissions").insert({
    name,
    email,
    phone,
    location,
    is_firefighter: isFirefighter,
    firefighter_department: firefighterDepartment,
    availability_notes: availabilityNotes,
    extra_notes: extraNotes,
    resume_filename: resumeFilename,
  });
  if (insertError) {
    console.error("Failed to save career interest submission:", insertError);
  }

  const rows = [
    ["Name", name],
    ["Email", email],
    ["Phone", phone],
    ...(location ? [["Location", location]] : []),
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
      ${extraNotes ? `<p style="margin-top:12px; font-size:14px; color:#16213a;"><strong>Anything else:</strong></p><p style="font-size:14px; color:#16213a; white-space:pre-wrap;">${escapeHtml(extraNotes)}</p>` : ""}
      ${resumeBuffer ? `<p style="margin-top:12px; font-size:14px; color:#16213a;">Resume attached: ${escapeHtml(resumeFilename!)}</p>` : ""}
    `),
    ...(resumeBuffer ? { attachments: [{ filename: resumeFilename!, content: resumeBuffer }] } : {}),
  });

  return NextResponse.json({ ok: true });
});
