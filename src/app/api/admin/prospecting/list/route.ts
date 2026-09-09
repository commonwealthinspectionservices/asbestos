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

const VALID_STATUSES = ["new", "contacted", "not_a_fit", "converted"];

// Lets the review page (ProspectingView.tsx) mark one or many prospects
// as worked — contacted, not a fit, or converted — without that status
// ever being touched by a rerun of the sourcing sweep (source/route.ts
// deliberately excludes status from its upsert payload, so this is the
// only place it ever changes). Per Tim, 2026-09-08 — cleanup here means
// marking "not a fit" in bulk (companies he already works with, or
// definitely won't), not deleting, so this takes an ids[] array rather
// than one id at a time.
export const PATCH = withApiErrors(async (req: NextRequest) => {
  const unauthorized = requireAdminApi(req);
  if (unauthorized) return unauthorized;

  const body = await req.json().catch(() => null);
  const ids: string[] = Array.isArray(body?.ids) ? body.ids : [];
  const status = body?.status;
  if (ids.length === 0) return NextResponse.json({ error: "ids[] required" }, { status: 400 });
  if (typeof status !== "string" || !VALID_STATUSES.includes(status)) {
    return NextResponse.json({ error: `status must be one of: ${VALID_STATUSES.join(", ")}` }, { status: 400 });
  }

  const supabase = getSupabaseAdminFresh();
  const { error } = await supabase.from("prospects").update({ status, updated_at: new Date().toISOString() }).in("id", ids);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, updated: ids.length });
});

// Cleanup for a sourcing sweep run with a category that turned out not to
// be a real target — e.g. "asbestos abatement contractor" (per Tim,
// 2026-09-08: this sells to restoration companies, not abatement
// contractors, even though the pitch would technically fit either).
// Scoped to a single category on purpose, so this can't accidentally
// wipe the whole table.
export const DELETE = withApiErrors(async (req: NextRequest) => {
  const unauthorized = requireAdminApi(req);
  if (unauthorized) return unauthorized;

  const category = req.nextUrl.searchParams.get("category");
  if (!category) return NextResponse.json({ error: "category query param required" }, { status: 400 });

  const supabase = getSupabaseAdminFresh();
  const { error, count } = await supabase.from("prospects").delete({ count: "exact" }).eq("category", category);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, deleted: count });
});
