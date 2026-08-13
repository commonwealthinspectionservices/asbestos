import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { withApiErrors } from "@/lib/api-handler";
import { sendEmail, emailShell } from "@/lib/email";
import { escapeHtml } from "@/lib/html";

// Internal-only alert to the owner whenever someone self-signs up for a
// portal account (see /portal/signup) — fired right after
// signInWithOtp() succeeds, before they've even confirmed their email.
// Admin-initiated invites don't hit this route at all — the admin
// already knows about those, since they're the one who just clicked
// Invite — this is specifically for people showing up on their own.
//
// Unauthenticated by necessity (called mid-signup, before any session
// exists), so it's guarded against being used to spam the owner's inbox:
// it only sends if a real auth.users account with that exact email was
// actually just created, verified here with the service-role key rather
// than trusting the request body.
export const POST = withApiErrors(async (req: NextRequest) => {
  const body = await req.json().catch(() => null);
  const email = body?.email?.trim().toLowerCase();
  if (!email) {
    return NextResponse.json({ error: "Missing email" }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  const { data: usersData } = await supabase.auth.admin.listUsers();
  const match = (usersData?.users ?? []).find((u) => (u.email ?? "").toLowerCase() === email);
  if (!match) {
    // Nothing to report — the request didn't correspond to a real signup.
    return NextResponse.json({ ok: true });
  }

  const accountType = (match.user_metadata as { account_type?: string } | null)?.account_type ?? "unknown";

  await sendEmail({
    to: process.env.OWNER_EMAIL!,
    subject: `New portal signup: ${email}`,
    html: emailShell(`
      <p style="font-size:15px;">Someone just signed up for a portal account.</p>
      <table style="width:100%; font-size:14px; color:#16213a;">
        <tr><td style="padding:4px 8px 4px 0; color:#64748b; white-space:nowrap;">Email</td><td>${escapeHtml(email)}</td></tr>
        <tr><td style="padding:4px 8px 4px 0; color:#64748b; white-space:nowrap;">Account type</td><td>${escapeHtml(accountType)}</td></tr>
      </table>
      <p style="margin-top:12px; font-size:13px; color:#64748b;">They still need to confirm their email and complete onboarding before this shows up as a contact in the Directory.</p>
    `),
  });

  return NextResponse.json({ ok: true });
});
