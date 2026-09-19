import { NextResponse } from "next/server";
import { requireContractorApi, getCompanyCustomerIds } from "@/lib/contractor-api";
import { getSupabaseAdmin } from "@/lib/supabase";
import { withApiErrors } from "@/lib/api-handler";
import { findAchPendingJobIds } from "@/lib/stripe";

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
  const achPending = await findAchPendingJobIds((data ?? []) as Parameters<typeof findAchPendingJobIds>[0]);
  const projects = (data ?? []).map((j) => ({ ...j, ach_pending: achPending.has(j.id) }));
  return NextResponse.json({ projects, customer: auth.customer });
});
