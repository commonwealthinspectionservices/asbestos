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

// jobs.customer_id is `on delete cascade` at the DB level — deleting a
// contact with real project history would silently wipe those projects
// too. Block it explicitly instead, same as the admin's own delete route
// (src/app/api/admin/customers/[id]/route.ts) — any teammate at a company
// can see and remove any other teammate here, so without this guard one
// person clicking "Remove" on a colleague could silently wipe every job
// that colleague ever booked.
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

  const { count } = await supabase
    .from("jobs")
    .select("id", { count: "exact", head: true })
    .eq("customer_id", params.id);
  if (count && count > 0) {
    return NextResponse.json(
      { error: `Can't remove — ${count} project${count === 1 ? "" : "s"} are booked under this teammate. Ask the office to reassign them first.` },
      { status: 400 }
    );
  }

  const { count: billingCount } = await supabase
    .from("jobs")
    .select("id", { count: "exact", head: true })
    .eq("billing_contact_id", params.id);
  if (billingCount && billingCount > 0) {
    return NextResponse.json(
      { error: `Can't remove — this teammate is set as the invoice recipient on ${billingCount} project${billingCount === 1 ? "" : "s"}. Change that on the project first.` },
      { status: 400 }
    );
  }

  // Clear the company-level billing-contact designation first if this
  // contact was it — otherwise the delete would leave
  // companies.billing_contact_id dangling.
  await supabase
    .from("companies")
    .update({ billing_contact_id: null })
    .eq("id", auth.customer.company_id)
    .eq("billing_contact_id", params.id);

  const { error } = await supabase.from("customers").delete().eq("id", params.id);
  if (error) throw new Error(error.message);
  return NextResponse.json({ ok: true });
});
