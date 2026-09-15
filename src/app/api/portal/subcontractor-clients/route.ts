import { NextRequest, NextResponse } from "next/server";
import { requireContractorApi } from "@/lib/contractor-api";
import { getSupabaseAdmin } from "@/lib/supabase";
import { withApiErrors } from "@/lib/api-handler";
import type { SubcontractorSavedClient } from "@/lib/types";
import { upsertSubcontractorSavedClient } from "@/lib/subcontractor-clients";

// A subcontracting company's own saved roster of end clients — see
// companies.subcontractor_saved_clients's own comment in schema.sql.
// Scoped strictly to the logged-in account's own company_id; never reads
// or writes another company's list.
export const GET = withApiErrors(async () => {
  const auth = await requireContractorApi();
  if (auth.error) return auth.error;
  if (!auth.customer.company_id) return NextResponse.json({ clients: [] });

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("companies")
    .select("subcontractor_saved_clients")
    .eq("id", auth.customer.company_id)
    .single();
  if (error) throw new Error(error.message);

  return NextResponse.json({ clients: (data?.subcontractor_saved_clients as SubcontractorSavedClient[]) ?? [] });
});

// Upserts one client — see upsertSubcontractorSavedClient's own comment.
// Called both from the portal's explicit "Save this client" action and
// automatically after a successful booking (/api/portal/book).
export const POST = withApiErrors(async (req: NextRequest) => {
  const auth = await requireContractorApi();
  if (auth.error) return auth.error;
  if (!auth.customer.company_id) {
    return NextResponse.json({ error: "This account has no company on file" }, { status: 400 });
  }

  const body = await req.json().catch(() => null);
  const company = body?.company?.trim();
  if (!company) return NextResponse.json({ error: "Company name is required" }, { status: 400 });

  const entry: Omit<SubcontractorSavedClient, "id"> = {
    company,
    street: body?.street?.trim() || "",
    unit: body?.unit?.trim() || "",
    city: body?.city?.trim() || "",
    state: body?.state?.trim() || "",
    zip: body?.zip?.trim() || "",
    contactFirstName: body?.contactFirstName?.trim() || "",
    contactLastName: body?.contactLastName?.trim() || "",
    contactPhone: body?.contactPhone?.trim() || "",
    contactEmail: body?.contactEmail?.trim() || "",
  };

  const supabase = getSupabaseAdmin();
  const clients = await upsertSubcontractorSavedClient(supabase, auth.customer.company_id, entry);
  return NextResponse.json({ clients });
});
