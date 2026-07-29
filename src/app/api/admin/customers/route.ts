import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { requireAdminApi } from "@/lib/admin-api";
import { withApiErrors } from "@/lib/api-handler";
import { upsertCompany } from "@/lib/companies";

// A directory of every individual contact — a standalone client (e.g. a
// homeowner) or someone affiliated with a company (e.g. an employee of
// Boston Harbor Water Restoration), distinguished by company_id. Backs the
// "Contacts" tab and the existing-contact picker in Add Project.
export const GET = withApiErrors(async (req: NextRequest) => {
  const unauthorized = requireAdminApi(req);
  if (unauthorized) return unauthorized;

  const url = new URL(req.url);
  const q = url.searchParams.get("q")?.trim();
  // Looking up the known contacts under one company (Add Project's Contact
  // name dropdown) rather than a fuzzy search.
  const companyId = url.searchParams.get("companyId")?.trim();
  const company = url.searchParams.get("company")?.trim();

  const supabase = getSupabaseAdmin();
  let query = supabase.from("customers").select("*").order("name", { ascending: true });
  if (companyId) {
    query = query.eq("company_id", companyId);
  } else if (company) {
    query = query.eq("company", company);
  } else if (q) {
    query = query.or(`name.ilike.%${q}%,company.ilike.%${q}%,email.ilike.%${q}%`);
  }

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ customers: data });
});

export const POST = withApiErrors(async (req: NextRequest) => {
  const unauthorized = requireAdminApi(req);
  if (unauthorized) return unauthorized;

  const body = await req.json().catch(() => null);
  const name = body?.name?.trim();
  const email = body?.email?.trim();
  if (!name || !email) {
    return NextResponse.json({ error: "Name and email are required" }, { status: 400 });
  }

  const companyId = body?.companyId?.trim() || null;
  const companyName = body?.company?.trim() || null;
  const billingAddress = body?.billingAddress?.trim() || null;

  const supabase = getSupabaseAdmin();

  // An exact companyId (e.g. picked from a dropdown) skips the name-based
  // dedup lookup entirely — it's already resolved to a specific company.
  let company = null;
  if (companyId) {
    const { data } = await supabase.from("companies").select("*").eq("id", companyId).single();
    company = data ?? null;
  } else if (companyName) {
    company = await upsertCompany(companyName, { billingAddress });
  }

  const { data, error } = await supabase
    .from("customers")
    .upsert(
      {
        name,
        company: company?.name ?? null,
        company_id: company?.id ?? null,
        email: email.toLowerCase(),
        phone: body?.phone?.trim() || "",
        billing_address: company?.billing_address ?? billingAddress,
      },
      { onConflict: "email" }
    )
    .select("*")
    .single();

  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? "Failed to save customer" }, { status: 500 });
  }
  return NextResponse.json({ customer: data });
});
