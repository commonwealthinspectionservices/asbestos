import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { requireAdminApi } from "@/lib/admin-api";
import { withApiErrors } from "@/lib/api-handler";
import { upsertCompany } from "@/lib/companies";

// Backs the Company dropdown in Add Project — the single source of truth
// for "which companies exist" so the picker can't create near-duplicate
// spellings of the same company.
export const GET = withApiErrors(async (req: NextRequest) => {
  const unauthorized = requireAdminApi(req);
  if (unauthorized) return unauthorized;

  const q = new URL(req.url).searchParams.get("q")?.trim();

  const supabase = getSupabaseAdmin();
  let query = supabase.from("companies").select("*").order("name", { ascending: true });
  if (q) {
    query = query.ilike("name", `%${q}%`);
  }
  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ companies: data });
});

export const POST = withApiErrors(async (req: NextRequest) => {
  const unauthorized = requireAdminApi(req);
  if (unauthorized) return unauthorized;

  const body = await req.json().catch(() => null);
  const name = body?.name?.trim();
  if (!name) {
    return NextResponse.json({ error: "Name is required" }, { status: 400 });
  }

  const company = await upsertCompany(name, {
    billingAddress: body?.billingAddress?.trim(),
    phone: body?.phone?.trim(),
    email: body?.email?.trim(),
  });
  return NextResponse.json({ company });
});
