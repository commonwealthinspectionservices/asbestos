import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { requireAdminApi } from "@/lib/admin-api";
import { withApiErrors } from "@/lib/api-handler";
import { normalizeMaterialName } from "@/lib/rays-library-normalize";

// "Ray's Library" — a reference-only catalog of materials/locations/results
// seen across real past full-inspection asbestos reports (all inspected by
// Raymond Leger at the owner's prior company). Deliberately not wired into
// any data-entry workflow — a full-inspection job's own materials
// (jobs.full_inspection_materials) are entered fresh per job.
export const GET = withApiErrors(async (req: NextRequest) => {
  const unauthorized = requireAdminApi(req);
  if (unauthorized) return unauthorized;

  const url = new URL(req.url);
  const q = url.searchParams.get("q")?.trim();

  const supabase = getSupabaseAdmin();
  let query = supabase.from("rays_library").select("*").order("material", { ascending: true });
  if (q) {
    query = query.or(`material.ilike.%${q}%,notes.ilike.%${q}%,source_address.ilike.%${q}%`);
  }

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ entries: data });
});

export const POST = withApiErrors(async (req: NextRequest) => {
  const unauthorized = requireAdminApi(req);
  if (unauthorized) return unauthorized;

  const body = await req.json().catch(() => null);
  const materialRaw = body?.material?.trim();
  if (!materialRaw) {
    return NextResponse.json({ error: "Material is required" }, { status: 400 });
  }
  const material = normalizeMaterialName(materialRaw);
  const locations = Array.isArray(body?.locations)
    ? body.locations.filter((l: unknown): l is string => typeof l === "string" && l.trim().length > 0).map((l: string) => l.trim())
    : [];
  const isAcm = body?.is_acm === true ? true : body?.is_acm === false ? false : null;

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("rays_library")
    .insert({
      material,
      locations,
      is_acm: isAcm,
      source_project_number: body?.source_project_number?.trim() || null,
      source_address: body?.source_address?.trim() || null,
      notes: body?.notes?.trim() || null,
    })
    .select("*")
    .single();

  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? "Failed to save entry" }, { status: 500 });
  }
  return NextResponse.json({ entry: data });
});
