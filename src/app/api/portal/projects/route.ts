import { NextResponse } from "next/server";
import { requireContractorApi, getCompanyCustomerIds } from "@/lib/contractor-api";
import { getSupabaseAdmin } from "@/lib/supabase";
import { withApiErrors } from "@/lib/api-handler";

export const GET = withApiErrors(async () => {
  const auth = await requireContractorApi();
  if (auth.error) return auth.error;

  const companyCustomerIds = await getCompanyCustomerIds(auth.customer);

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("jobs")
    .select("*")
    .in("customer_id", companyCustomerIds)
    .neq("status", "waitlist_out_of_area")
    .order("requested_date", { ascending: false });

  if (error) throw new Error(error.message);

  // requested_date/requested_time are the customer's own original ask (see
  // PendingRequestEditor.tsx) — shown and editable while a request is still
  // pending. confirmed_date/confirmed_time (only ever set by the admin's
  // explicit Accept & Schedule action) are what actually gets shown once a
  // job is scheduled.
  return NextResponse.json({ projects: data ?? [], customer: auth.customer });
});
