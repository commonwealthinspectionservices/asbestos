import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { requireAdminApi } from "@/lib/admin-api";
import { withApiErrors } from "@/lib/api-handler";

// Reference site photos for Ray's Library, keyed by material name — see
// supabase/schema.sql's rays_library_photos table comment. Returns just the
// metadata (id + material); the actual image bytes are served one at a
// time from GET /api/admin/rays-library/photos/[id].
export const GET = withApiErrors(async (req: NextRequest) => {
  const unauthorized = requireAdminApi(req);
  if (unauthorized) return unauthorized;

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("rays_library_photos")
    .select("id, material, source_project_number, source_address, created_at")
    .order("material", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ photos: data });
});
