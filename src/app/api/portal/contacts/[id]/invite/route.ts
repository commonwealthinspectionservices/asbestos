import { NextRequest, NextResponse } from "next/server";
import { requireContractorApi } from "@/lib/contractor-api";
import { getSupabaseAdmin } from "@/lib/supabase";
import { withApiErrors } from "@/lib/api-handler";
import { sendEmail, emailShell } from "@/lib/email";
import { getSettings } from "@/lib/settings";
import { escapeHtml } from "@/lib/html";

// Invites an existing contact (added via "Add contact" — a directory entry
// with no login of its own, see /api/portal/contacts) to set up their own
// portal login under this same company. The self-service counterpart to
// the admin's own Invite button — a real send rather than a Gmail draft,
// since there's no admin standing by to review it first.
export const POST = withApiErrors(async (
  req: NextRequest,
  { params }: { params: { id: string } }
) => {
  const auth = await requireContractorApi();
  if (auth.error) return auth.error;

  if (!auth.customer.company_id) {
    return NextResponse.json({ error: "Your account isn't linked to a company yet" }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  const { data: contact } = await supabase
    .from("customers")
    .select("id, name, email, auth_user_id, company_id")
    .eq("id", params.id)
    .maybeSingle();

  if (!contact || contact.company_id !== auth.customer.company_id) {
    return NextResponse.json({ error: "Contact not found" }, { status: 404 });
  }
  if (contact.auth_user_id) {
    return NextResponse.json({ error: "This contact already has a portal login" }, { status: 400 });
  }
  if (!contact.email) {
    return NextResponse.json({ error: "This contact has no email on file" }, { status: 400 });
  }

  const { data, error } = await supabase.auth.admin.generateLink({
    type: "invite",
    email: contact.email,
    options: {
      // Matches the admin's own Invite flow — pre-fills account_type so
      // OnboardingForm doesn't ask again, and /api/portal/profile's
      // existing-row lookup (matched by email) preserves this contact's
      // already-set company_id instead of re-deriving it from scratch.
      data: { account_type: "company" },
      // Without an explicit redirectTo, Supabase falls back to the bare
      // Site URL instead of carrying the invite into onboarding.
      redirectTo: `${req.nextUrl.origin}/portal/confirm`,
    },
  });
  if (error) {
    // Most common failure: an auth account with this email already exists
    // (e.g. they signed up on their own already).
    const alreadyExists = /already registered|already exists/i.test(error.message);
    return NextResponse.json(
      { error: alreadyExists ? "An account with this email already exists." : error.message },
      { status: 400 }
    );
  }

  const inviteLink = data.properties.action_link;
  const settings = await getSettings();
  const firstName = contact.name?.split(" ")[0] || "there";
  const inviterName = auth.customer.name || "A teammate";
  const companyName = auth.customer.company || "your company";

  await sendEmail({
    to: contact.email,
    subject: `${inviterName} invited you to ${settings.business_name}'s client portal`,
    html: emailShell(`
      <p style="font-size:15px;">Hi ${escapeHtml(firstName)},</p>
      <p>${escapeHtml(inviterName)} added you as a contact for ${escapeHtml(companyName)} on ${escapeHtml(settings.business_name)}'s client portal — set up your own login to track projects, view reports and invoices, and book new inspections.</p>
      <p style="margin-top:20px;">
        <a href="${inviteLink}" style="display:inline-block; background:#193466; color:#fff; padding:10px 16px; border-radius:8px; text-decoration:none; font-size:14px;">Set up your login</a>
      </p>
    `),
  });

  // Internal owner alert — a client-to-client invite creates a new portal
  // account without the owner ever clicking anything themselves, unlike
  // the admin's own Invite button. Best-effort, matches the same alert
  // fired from self-signup (see signup-notify/route.ts) — this and that
  // are the two paths that create a login the owner didn't initiate.
  await sendEmail({
    to: process.env.OWNER_EMAIL!,
    subject: `New portal signup: ${contact.email}`,
    html: emailShell(`
      <p style="font-size:15px;">${escapeHtml(inviterName)} (${escapeHtml(companyName)}) invited a teammate to the portal.</p>
      <table style="width:100%; font-size:14px; color:#16213a;">
        <tr><td style="padding:4px 8px 4px 0; color:#64748b; white-space:nowrap;">Name</td><td>${escapeHtml(contact.name)}</td></tr>
        <tr><td style="padding:4px 8px 4px 0; color:#64748b; white-space:nowrap;">Email</td><td>${escapeHtml(contact.email)}</td></tr>
        <tr><td style="padding:4px 8px 4px 0; color:#64748b; white-space:nowrap;">Company</td><td>${escapeHtml(companyName)}</td></tr>
      </table>
    `),
  });

  return NextResponse.json({ ok: true });
});
