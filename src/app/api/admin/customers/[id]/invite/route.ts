import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { requireAdminApi } from "@/lib/admin-api";
import { withApiErrors } from "@/lib/api-handler";

// Generates a one-time portal signup link for an existing contact who
// doesn't have a login yet — handed to them directly (text, email,
// whatever) rather than relying on Supabase's own rate-limited email
// sender to deliver it. When they click it and set a password, they land
// in onboarding under this exact email; /api/portal/profile then links
// their new auth account to THIS existing customers row (matched by
// email) instead of creating a duplicate.
export const POST = withApiErrors(async (
  req: NextRequest,
  { params }: { params: { id: string } }
) => {
  const unauthorized = requireAdminApi(req);
  if (unauthorized) return unauthorized;

  const supabase = getSupabaseAdmin();
  const { data: customer, error: customerError } = await supabase
    .from("customers")
    .select("id, email, auth_user_id")
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

  const { data, error } = await supabase.auth.admin.generateLink({
    type: "invite",
    email: customer.email,
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

  return NextResponse.json({ inviteLink: data.properties.action_link });
});
