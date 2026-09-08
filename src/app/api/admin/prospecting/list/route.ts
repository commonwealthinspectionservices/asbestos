import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-api";
import { withApiErrors } from "@/lib/api-handler";
import { getSupabaseAdminFresh } from "@/lib/supabase";

// Read side of the sourcing route (source/route.ts) — lists what's been
// found so far. Flags a possibleExistingCustomer match by loose
// lowercased-name comparison against the real companies table, rather
// than silently excluding it: companies has no website/domain column to
// match on, so a name-only heuristic can miss real matches or false-
// positive on a common word — surfacing the flag for a human to confirm
// is safer than either silently hiding a real prospect or silently
// re-pitching an existing customer.
export const GET = withApiErrors(async (req: NextRequest) => {
  const unauthorized = requireAdminApi(req);
  if (unauthorized) return unauthorized;

  const supabase = getSupabaseAdminFresh();
  const status = req.nextUrl.searchParams.get("status");

  let query = supabase.from("prospects").select("*").order("discovered_at", { ascending: false });
  if (status) query = query.eq("status", status);
  const { data: prospects, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const { data: companies } = await supabase.from("companies").select("name");
  const companyNames = (companies ?? []).map((c: { name: string }) => c.name.toLowerCase().trim());

  const normalize = (s: string) =>
    s.toLowerCase().replace(/[.,]/g, "").replace(/\b(llc|inc|corp|co)\b/g, "").trim();

  const result = (prospects ?? []).map((p: { company_name: string }) => {
    const normalizedProspect = normalize(p.company_name);
    return {
      ...p,
      possibleExistingCustomer:
        normalizedProspect.length > 0 &&
        companyNames.some((n) => {
          const normalizedCompany = normalize(n);
          return (
            normalizedCompany.length > 0 &&
            (normalizedCompany === normalizedProspect || normalizedCompany.includes(normalizedProspect))
          );
        }),
    };
  });

  return NextResponse.json({ ok: true, count: result.length, prospects: result });
});
