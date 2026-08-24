import { NextRequest, NextResponse } from "next/server";
import { requireCronAuth } from "@/lib/cron-auth";
import { withApiErrors } from "@/lib/api-handler";
import { getSupabaseAdminFresh } from "@/lib/supabase";

// TEMPORARY — one-off diagnostic for the 26-0003/Framingham-data mixup
// reported 2026-08-24. Read-only. Delete once that's resolved.
export const dynamic = "force-dynamic";

export const GET = withApiErrors(async (req: NextRequest) => {
  const unauthorized = requireCronAuth(req);
  if (unauthorized) return unauthorized;

  const projectNumber = req.nextUrl.searchParams.get("project_number");
  if (!projectNumber) return NextResponse.json({ error: "project_number required" }, { status: 400 });

  const supabase = getSupabaseAdminFresh();
  const { data, error } = await supabase
    .from("jobs")
    .select("*, customers(id, name, company, email, phone)")
    .eq("project_number", projectNumber)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ job: data });
});
