import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { requireAdminApi } from "@/lib/admin-api";
import { withApiErrors } from "@/lib/api-handler";

// Links an already-existing portal login (auth.users account) to this
// contact by email match — the admin-side counterpart to onboarding's own
// by-email linking (POST /api/portal/profile). For when someone signed up
// and confirmed their email but never finished onboarding, so their
// customers row (created here manually, or from a prior anonymous
// booking) never got auth_user_id set. See ContactDetailDialog's "Link
// existing portal account" button, shown when GET .../customers/[id]
// reports hasUnlinkedAuthAccount.
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

  const { data: usersData, error: usersError } = await supabase.auth.admin.listUsers();
  if (usersError) {
    return NextResponse.json({ error: usersError.message }, { status: 500 });
  }
  const match = (usersData?.users ?? []).find(
    (u) => (u.email ?? "").toLowerCase() === customer.email.toLowerCase()
  );
  if (!match) {
    return NextResponse.json({ error: "No portal login found for this contact's email" }, { status: 404 });
  }

  // .is("auth_user_id", null) guards against a race where the contact
  // linked themselves (via onboarding) between the GET check and this
  // click — auth_user_id is also unique at the DB level, so a match
  // already claimed by a different customers row fails cleanly here too.
  const { data: updated, error: updateError } = await supabase
    .from("customers")
    .update({ auth_user_id: match.id })
    .eq("id", customer.id)
    .is("auth_user_id", null)
    .select("*")
    .single();
  if (updateError || !updated) {
    return NextResponse.json({ error: updateError?.message ?? "Failed to link account" }, { status: 500 });
  }

  return NextResponse.json({ customer: updated });
});
