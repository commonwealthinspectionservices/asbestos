import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { requireAdminApi } from "@/lib/admin-api";
import { withApiErrors } from "@/lib/api-handler";

// Backs the Company Card: a company's own fields plus every contact at
// that company and every job booked by any of them, aggregated — a job
// belongs to one contact (customer_id), not the company directly, so
// "this company's jobs" means every job across all of its contacts.
export const GET = withApiErrors(async (
  req: NextRequest,
  { params }: { params: { id: string } }
) => {
  const unauthorized = requireAdminApi(req);
  if (unauthorized) return unauthorized;

  const supabase = getSupabaseAdmin();
  const { data: company, error } = await supabase
    .from("companies")
    .select("*")
    .eq("id", params.id)
    .single();
  if (error || !company) {
    return NextResponse.json({ error: "Company not found" }, { status: 404 });
  }

  const { data: contacts } = await supabase
    .from("customers")
    .select("*")
    .eq("company_id", params.id)
    .order("name", { ascending: true });

  const contactIds = (contacts ?? []).map((c) => c.id);
  const { data: jobs } = contactIds.length
    ? await supabase
        .from("jobs")
        .select("id, project_number, service_address, requested_date, status, invoice_total_cents, customer_id")
        .in("customer_id", contactIds)
        .order("requested_date", { ascending: false })
    : { data: [] };

  return NextResponse.json({ company, contacts: contacts ?? [], jobs: jobs ?? [] });
});

export const PATCH = withApiErrors(async (
  req: NextRequest,
  { params }: { params: { id: string } }
) => {
  const unauthorized = requireAdminApi(req);
  if (unauthorized) return unauthorized;

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const patch: Record<string, unknown> = {};
  if (typeof body.name === "string") patch.name = body.name.trim();
  if ("billing_address" in body) patch.billing_address = body.billing_address || null;
  if ("phone" in body) patch.phone = body.phone || null;
  if ("email" in body) patch.email = body.email || null;
  if ("billing_contact_id" in body) patch.billing_contact_id = body.billing_contact_id || null;
  if ("invoice_cc_contact_ids" in body) patch.invoice_cc_contact_ids = Array.isArray(body.invoice_cc_contact_ids) ? body.invoice_cc_contact_ids : [];

  const supabase = getSupabaseAdmin();
  const { data: company, error } = await supabase
    .from("companies")
    .update(patch)
    .eq("id", params.id)
    .select("*")
    .single();

  if (error || !company) {
    return NextResponse.json({ error: error?.message ?? "Failed to update company" }, { status: 500 });
  }

  // customers.company is a denormalized display copy of the company's name
  // (used directly in report/invoice recipient blocks) — keep every contact
  // at this company in sync rather than leaving stale names behind after a
  // rename.
  if (typeof patch.name === "string") {
    await supabase.from("customers").update({ company: patch.name }).eq("company_id", params.id);
  }

  return NextResponse.json({ company });
});

// Contacts reference their company via customers.company_id with no ON
// DELETE clause (defaults to NO ACTION), so the DB would already refuse
// this if contacts exist — checking first gives a clear message instead of
// a raw FK-violation error, and makes the required cleanup order (delete
// contacts, then the company) explicit to the admin.
export const DELETE = withApiErrors(async (
  req: NextRequest,
  { params }: { params: { id: string } }
) => {
  const unauthorized = requireAdminApi(req);
  if (unauthorized) return unauthorized;

  const supabase = getSupabaseAdmin();

  const { count } = await supabase
    .from("customers")
    .select("id", { count: "exact", head: true })
    .eq("company_id", params.id);
  if (count && count > 0) {
    return NextResponse.json(
      { error: `Cannot delete — ${count} contact${count === 1 ? "" : "s"} still belong to this company.` },
      { status: 400 }
    );
  }

  const { error } = await supabase.from("companies").delete().eq("id", params.id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
});
