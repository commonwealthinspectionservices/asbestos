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
    .select("id, name, email, auth_user_id, is_individual")
    .eq("id", params.id)
    .single();
  if (customerError || !customer) {
    return NextResponse.json({ error: "Contact not found" }, { status: 404 });
  }
  if (customer.auth_user_id) {
    return NextResponse.json({ error: "This contact already has a portal login" }, { status: 400 });
  }
  if (!customer.email) {
    return NextResponse.json({ error: "This contact has no email on file" }, { status: 400 });
  }

  const accessToken = await getValidAccessToken();
  if (!accessToken) {
    return NextResponse.json({ error: "Gmail is not connected — connect it in Settings first" }, { status: 400 });
  }

  const { data, error } = await supabase.auth.admin.generateLink({
    type: "invite",
    email: customer.email,
    options: {
      // Without this, the invited contact lands on /portal/onboarding with
      // no account_type in their auth metadata — OnboardingForm then
      // defaults to showing the Company field even for an actual
      // individual contact, since it only hides Company when
      // account_type === "individual".
      data: { account_type: customer.is_individual ? "individual" : "company" },
      // Without an explicit redirectTo, Supabase falls back to the bare
      // Site URL (the marketing homepage) instead of carrying the invite
      // into onboarding — req.nextUrl.origin rather than a hardcoded
      // domain so this also works from a local/preview deployment.
      redirectTo: `${req.nextUrl.origin}/portal/confirm`,
    },
  });
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
  const firstName = customer.name?.split(" ")[0] || "there";

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
