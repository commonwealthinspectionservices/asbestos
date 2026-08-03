import { NextRequest, NextResponse } from "next/server";
import { requireContractorApi } from "@/lib/contractor-api";
import { getSupabaseAdmin } from "@/lib/supabase";
import { withApiErrors } from "@/lib/api-handler";

// Ongoing edits from the portal's My Account page — distinct from
// /api/portal/profile, which only ever runs once, right after signup, to
// create the customers row in the first place.
export const PATCH = withApiErrors(async (req: NextRequest) => {
  const auth = await requireContractorApi();
  if (auth.error) return auth.error;

  const body = await req.json().catch(() => null);
  const patch: Record<string, unknown> = {};
  if (typeof body?.name === "string") patch.name = body.name.trim();
  if (typeof body?.phone === "string") patch.phone = body.phone.trim();
  if (typeof body?.company === "string") patch.company = body.company.trim() || null;
  if (typeof body?.billingAddress === "string") patch.billing_address = body.billingAddress.trim() || null;

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }
  if ("name" in patch && !patch.name) {
    return NextResponse.json({ error: "Name is required" }, { status: 400 });
  }
  if ("phone" in patch && !patch.phone) {
    return NextResponse.json({ error: "Phone is required" }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  const { data: customer, error } = await supabase
    .from("customers")
    .update(patch)
    .eq("id", auth.customer.id)
    .select("*")
    .single();

  if (error || !customer) {
    throw new Error(`Failed to update account: ${error?.message}`);
  }
  return NextResponse.json({ customer });
});
