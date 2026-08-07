import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { requireAdminApi } from "@/lib/admin-api";
import { withApiErrors } from "@/lib/api-handler";
import { upsertCompany } from "@/lib/companies";

const EDITABLE_FIELDS = ["name", "company", "email", "phone", "billing_address", "is_individual"] as const;

export const GET = withApiErrors(async (
  req: NextRequest,
  { params }: { params: { id: string } }
) => {
  const unauthorized = requireAdminApi(req);
  if (unauthorized) return unauthorized;

  const supabase = getSupabaseAdmin();
  const { data: customer, error } = await supabase
    .from("customers")
    .select("*")
    .eq("id", params.id)
    .single();
  if (error || !customer) {
    return NextResponse.json({ error: "Customer not found" }, { status: 404 });
  }

  const { data: jobs } = await supabase
    .from("jobs")
    .select("id, project_number, service_address, requested_date, status, invoice_total_cents")
    .eq("customer_id", params.id)
    .order("requested_date", { ascending: false });

  return NextResponse.json({ customer, jobs: jobs ?? [] });
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
  for (const field of EDITABLE_FIELDS) {
    if (field in body) patch[field] = body[field];
  }
  if (typeof patch.email === "string") patch.email = patch.email.toLowerCase();

  const supabase = getSupabaseAdmin();

  // companyId takes precedence when present: it means the caller already
  // resolved an exact existing company (e.g. picked from a dropdown), so
  // skip the name-based dedup lookup and just point at it directly.
  if ("companyId" in body) {
    if (body.companyId) {
      const { data: company } = await supabase.from("companies").select("*").eq("id", body.companyId).single();
      if (company) {
        patch.company = company.name;
        patch.company_id = company.id;
      }
    } else if (typeof patch.company === "string" && patch.company.trim()) {
      const company = await upsertCompany(patch.company.trim(), {
        billingAddress: typeof patch.billing_address === "string" ? patch.billing_address : undefined,
      });
      patch.company = company.name;
      patch.company_id = company.id;
    } else {
      patch.company = null;
      patch.company_id = null;
    }
  } else if (typeof patch.company === "string" && patch.company.trim()) {
    const company = await upsertCompany(patch.company.trim(), {
      billingAddress: typeof patch.billing_address === "string" ? patch.billing_address : undefined,
    });
    patch.company = company.name;
    patch.company_id = company.id;
  }

  const { data, error } = await supabase
    .from("customers")
    .update(patch)
    .eq("id", params.id)
    .select("*")
    .single();

  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? "Failed to update customer" }, { status: 500 });
  }
  return NextResponse.json({ customer: data });
});

// jobs.customer_id is `on delete cascade` at the DB level — deleting a
// contact with real project history would silently wipe those projects
// too. Block it explicitly instead and make the admin deal with the jobs
// first, rather than relying on a destructive cascade nobody asked for.
export const DELETE = withApiErrors(async (
  req: NextRequest,
  { params }: { params: { id: string } }
) => {
  const unauthorized = requireAdminApi(req);
  if (unauthorized) return unauthorized;

  const supabase = getSupabaseAdmin();

  const { count } = await supabase
    .from("jobs")
    .select("id", { count: "exact", head: true })
    .eq("customer_id", params.id);
  if (count && count > 0) {
    return NextResponse.json(
      { error: `Cannot delete — ${count} project${count === 1 ? "" : "s"} still reference this contact.` },
      { status: 400 }
    );
  }

  const { data: billedCompany } = await supabase
    .from("companies")
    .select("name")
    .eq("billing_contact_id", params.id)
    .maybeSingle();
  if (billedCompany) {
    return NextResponse.json(
      { error: `Cannot delete — this contact is set as the billing contact for ${billedCompany.name}.` },
      { status: 400 }
    );
  }

  const { error } = await supabase.from("customers").delete().eq("id", params.id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
});
