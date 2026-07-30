import { NextRequest, NextResponse } from "next/server";
import { requireContractorApi } from "@/lib/contractor-api";
import { getSupabaseAdmin } from "@/lib/supabase";
import { withApiErrors } from "@/lib/api-handler";

async function ownedContact(companyId: string | null, contactId: string) {
  if (!companyId) return null;
  const supabase = getSupabaseAdmin();
  const { data } = await supabase.from("customers").select("id, company_id").eq("id", contactId).maybeSingle();
  if (!data || data.company_id !== companyId) return null;
  return data;
}

export const PATCH = withApiErrors(async (
  req: NextRequest,
  { params }: { params: { id: string } }
) => {
  const auth = await requireContractorApi();
  if (auth.error) return auth.error;

  const owned = await ownedContact(auth.customer.company_id, params.id);
  if (!owned) return NextResponse.json({ error: "Contact not found" }, { status: 404 });

  const body = await req.json().catch(() => null);
  const supabase = getSupabaseAdmin();

  // Billing contact lives on companies (one designated contact for the
  // whole account), not on the contact row itself — a separate action from
  // editing name/email.
  if (body?.isBillingContact) {
    const { error } = await supabase
      .from("companies")
      .update({ billing_contact_id: params.id })
      .eq("id", auth.customer.company_id);
    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true });
  }

  const patch: Record<string, unknown> = {};
  if (typeof body?.name === "string" && body.name.trim()) patch.name = body.name.trim();
  if (typeof body?.email === "string" && body.email.trim()) patch.email = body.email.trim().toLowerCase();
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "No editable fields provided" }, { status: 400 });
  }

  const { error } = await supabase.from("customers").update(patch).eq("id", params.id);
  if (error) {
    if (error.code === "23505") {
      return NextResponse.json({ error: "This email is already associated with another account." }, { status: 400 });
    }
    throw new Error(error.message);
  }
  return NextResponse.json({ ok: true });
});

export const DELETE = withApiErrors(async (
  req: NextRequest,
  { params }: { params: { id: string } }
) => {
  const auth = await requireContractorApi();
  if (auth.error) return auth.error;

  if (params.id === auth.customer.id) {
    return NextResponse.json({ error: "You can't remove yourself" }, { status: 400 });
  }
  const owned = await ownedContact(auth.customer.company_id, params.id);
  if (!owned) return NextResponse.json({ error: "Contact not found" }, { status: 404 });

  const supabase = getSupabaseAdmin();
  // Clear the billing-contact designation first if this contact was it —
  // otherwise the delete would leave companies.billing_contact_id dangling.
  await supabase
    .from("companies")
    .update({ billing_contact_id: null })
    .eq("id", auth.customer.company_id)
    .eq("billing_contact_id", params.id);

  const { error } = await supabase.from("customers").delete().eq("id", params.id);
  if (error) throw new Error(error.message);
  return NextResponse.json({ ok: true });
});
