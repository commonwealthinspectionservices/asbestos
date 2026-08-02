import { NextRequest, NextResponse } from "next/server";
import { getContractorSession } from "@/lib/contractor-api";
import { getSupabaseAdmin } from "@/lib/supabase";
import { withApiErrors } from "@/lib/api-handler";

// Called once, right after signup/first login, to link (or create) the
// customers row for this account. Not gated by requireContractorApi()
// since that requires a customer profile to already exist — this route is
// what creates it, so it only needs a valid auth session.
export const POST = withApiErrors(async (req: NextRequest) => {
  const session = await getContractorSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const name = body?.name?.trim();
  const phone = body?.phone?.trim();
  const company = body?.company?.trim() || null;
  const billingAddress = body?.billingAddress?.trim() || null;
  const accountType = body?.accountType;
  const isHomeowner = accountType === "homeowner";

  if (!name || !phone || (!isHomeowner && !company)) {
    return NextResponse.json({ error: "Name and phone are required" }, { status: 400 });
  }

  const email = (session.email ?? "").toLowerCase();
  if (!email) {
    return NextResponse.json({ error: "Account has no email on file" }, { status: 400 });
  }

  const admin = getSupabaseAdmin();

  // A contractor may already have a customers row from a prior anonymous
  // booking — link that one rather than creating a duplicate, so their
  // existing project history shows up under the new account.
  const { data: existing } = await admin
    .from("customers")
    .select("id")
    .eq("email", email)
    .maybeSingle();

  const patch = {
    auth_user_id: session.authUserId,
    name,
    company,
    phone,
    billing_address: billingAddress,
    is_homeowner: isHomeowner,
  };

  const { data: customer, error } = existing
    ? await admin.from("customers").update(patch).eq("id", existing.id).select("*").single()
    : await admin.from("customers").insert({ ...patch, email }).select("*").single();

  if (error || !customer) {
    throw new Error(`Failed to save profile: ${error?.message}`);
  }

  return NextResponse.json({ customer });
});
