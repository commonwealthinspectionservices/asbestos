import { NextResponse } from "next/server";
import { requireContractorApi } from "@/lib/contractor-api";
import { getSupabaseAdmin } from "@/lib/supabase";
import { withApiErrors } from "@/lib/api-handler";

export const GET = withApiErrors(async () => {
  const auth = await requireContractorApi();
  if (auth.error) return auth.error;

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("jobs")
    .select("*")
    .eq("customer_id", auth.customer.id)
    .neq("status", "waitlist_out_of_area")
    .order("requested_date", { ascending: false });

  if (error) throw new Error(error.message);
  return NextResponse.json({ projects: data });
});
