import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { requireAdminApi } from "@/lib/admin-api";
import { withApiErrors } from "@/lib/api-handler";
import { getValidAccessToken, createDraft } from "@/lib/gmail";
import { getSettings } from "@/lib/settings";

// Generates a one-time portal signup link for an existing contact who
// doesn't have a login yet, and drafts (never sends — same as every other
// Gmail draft this app creates) an email with it addressed to them. The
// admin reviews it in their own Drafts folder and hits send themselves,
// same as the invoice/report drafts. When the contact clicks the link and
// sets a password, they land in onboarding under this exact email;
// /api/portal/profile then links their new auth account to THIS existing
// customers row (matched by email) instead of creating a duplicate.
export const POST = withApiErrors(async (
  req: NextRequest,
  { params }: { params: { id: string } }
) => {
  const unauthorized = requireAdminApi(req);
  if (unauthorized) return unauthorized;

  const supabase = getSupabaseAdmin();
  const { data: customer, error: customerError } = await supabase
    .from("customers")
    .select("id, name, email, auth_user_id, onboarding_completed_at, is_individual")
    .eq("id", params.id)
    .single();
  if (customerError || !customer) {
    return NextResponse.json({ error: "Contact not found" }, { status: 404 });
  }
  // Supabase creates the auth account the instant the first invite link is
  // generated, not when the contact actually finishes setting a password
  // (see on_auth_user_created in schema.sql) — so auth_user_id alone isn't
  // "already has a working login." Only block when onboarding is actually
  // done; otherwise this call re-generates a fresh link for the same
  // still-unfinished account, same as generateLink already does for a
  // repeat invite to an existing unconfirmed user.
  if (customer.auth_user_id && customer.onboarding_completed_at) {
    return NextResponse.json({ error: "This contact already has a portal login" }, { status: 400 });
  }
  if (!customer.email) {
    return NextResponse.json({ error: "This contact has no email on file" }, { status: 400 });
  }
  // An invite link's whole purpose is bringing someone onto a team — an
  // individual has no team to join, so this stays company-only even if
  // called directly rather than through the (already-hidden-for-
  // individuals) UI button. See ContactDetailDialog.tsx.
  if (customer.is_individual) {
    return NextResponse.json({ error: "Individuals sign up on their own — they aren't invited" }, { status: 400 });
  }

  const accessToken = await getValidAccessToken();
  if (!accessToken) {
    return NextResponse.json({ error: "Gmail is not connected — connect it in Settings first" }, { status: 400 });
  }

  // Supabase's "invite" link type only works for an email with no auth
  // account yet — it errors ("already been registered") the moment one
  // exists, even if they never finished onboarding. For a resend
  // (auth_user_id already set), "recovery" is the correct type instead —
  // same as the portal's own "Forgot password?" link, which the
  // onboarding_completed_at gate (see /api/portal/profile) already routes
  // back into finishing the profile form rather than letting them skip
  // it. account_type metadata only needs setting on the original invite;
  // it's already on the user from then.
  const { data, error } = await supabase.auth.admin.generateLink(
    customer.auth_user_id
      ? {
          type: "recovery",
          email: customer.email,
          options: { redirectTo: `${req.nextUrl.origin}/portal/confirm` },
        }
      : {
          type: "invite",
          email: customer.email,
          options: {
            // Always "company" — this route is company-contact-only (see
            // the is_individual guard above), and OnboardingForm needs it
            // set to show the Company field.
            data: { account_type: "company" },
            // Without an explicit redirectTo, Supabase falls back to the
            // bare Site URL (the marketing homepage) instead of carrying
            // the invite into onboarding — req.nextUrl.origin rather than
            // a hardcoded domain so this also works from a local/preview
            // deployment.
            redirectTo: `${req.nextUrl.origin}/portal/confirm`,
          },
        }
  );
  if (error) {
    // Most common failure: an auth account with this email already exists
    // (e.g. they signed up on their own already) — steer toward the merge
    // tool instead of surfacing a raw Supabase error.
    const alreadyExists = /already registered|already exists/i.test(error.message);
    return NextResponse.json(
      {
        error: alreadyExists
          ? "An account with this email already exists — if they signed up separately, use Merge instead of Invite."
          : error.message,
      },
      { status: 400 }
    );
  }

  const inviteLink = data.properties.action_link;
  const settings = await getSettings();
  // A brand-new contact invited by email only (see /api/admin/customers)
  // has name === email as a sentinel for "not actually known yet" — using
  // it here would greet them with their own email address instead of a name.
  const firstName = customer.name && customer.name !== customer.email ? customer.name.split(" ")[0] : "there";

  const draft = await createDraft(accessToken, {
    to: customer.email,
    subject: `Set up your ${settings.business_name} client portal login`,
    bodyText: [
      `Hi ${firstName},`,
      "",
      "You can now track your projects, view reports and invoices, and book new inspections online.",
      "",
      `Click here to set up your login: ${inviteLink}`,
      "",
      `Should you have any questions, please contact our office at ${settings.business_phone}.`,
    ].join("\n"),
    attachments: [],
  });

  return NextResponse.json({ draftId: draft.id });
});
