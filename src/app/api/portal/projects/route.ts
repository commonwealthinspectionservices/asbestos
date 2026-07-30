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

  // requested_date/requested_time are the admin's own working values while
  // coordinating scheduling — never sent to the portal. confirmed_date/
  // confirmed_time (only ever set by the admin's explicit "Confirm & send
  // to client" action) are what the contractor is allowed to see.
  const projects = (data ?? []).map(({ requested_date: _requestedDate, requested_time: _requestedTime, ...rest }) => rest);

  return NextResponse.json({ projects, customer: auth.customer });
});
