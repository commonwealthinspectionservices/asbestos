import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { requireAdminApi } from "@/lib/admin-api";
import { withApiErrors } from "@/lib/api-handler";

// Consolidates a duplicate company (survivorId is kept, loserId is merged
// in and deleted) — see merge_companies() in supabase/schema.sql for what
// actually gets reassigned. Same shape as /api/admin/customers/merge.
export const POST = withApiErrors(async (req: NextRequest) => {
  const unauthorized = requireAdminApi(req);
  if (unauthorized) return unauthorized;

  const body = await req.json().catch(() => null);
  const survivorId = body?.survivorId?.trim();
  const loserId = body?.loserId?.trim();
  if (!survivorId || !loserId) {
    return NextResponse.json({ error: "survivorId and loserId are required" }, { status: 400 });
  }
  if (survivorId === loserId) {
    return NextResponse.json({ error: "Can't merge a company into itself" }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  const { error } = await supabase.rpc("merge_companies", { survivor_id: survivorId, loser_id: loserId });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
});
