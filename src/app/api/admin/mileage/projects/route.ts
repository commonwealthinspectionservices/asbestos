import { NextRequest, NextResponse } from "next/server";
import { requireOwnerApi } from "@/lib/admin-api";
import { withApiErrors } from "@/lib/api-handler";
import { getSupabaseAdminFresh } from "@/lib/supabase";

// Recent projects, for adding a job as a stop on a mileage day.
export const GET = withApiErrors(async (req: NextRequest) => {
  const unauthorized = requireOwnerApi(req);
  if (unauthorized) return unauthorized;
  const { data, error } = await getSupabaseAdminFresh()
    .from("jobs")
    .select("id, project_number, service_address, confirmed_date, requested_date, customers!customer_id(name, company)")
    .not("service_address", "is", null)
    .neq("status", "cancelled")
    .order("created_at", { ascending: false })
    .limit(40);
  if (error) throw new Error(error.message);
  return NextResponse.json({ projects: data ?? [] });
});
