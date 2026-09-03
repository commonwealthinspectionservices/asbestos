import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-api";
import { withApiErrors } from "@/lib/api-handler";
import { buildJobPaidEmailHtml } from "@/lib/booking-notify";
import { getSupabaseAdmin } from "@/lib/supabase";

// Per Tim, 2026-09-03 — "show me what itd have looked like": lets an
// already-paid job preview the exact email sendJobPaidNotification would
// send, without re-triggering a real send. Reuses buildJobPaidEmailHtml so
// this can never drift from the real one.
export const GET = withApiErrors(async (req: NextRequest) => {
  const unauthorized = requireAdminApi(req);
  if (unauthorized) return unauthorized;

  const jobId = req.nextUrl.searchParams.get("jobId");
  if (!jobId) return NextResponse.json({ error: "jobId is required" }, { status: 400 });

  const supabase = getSupabaseAdmin();
  const { data: job } = await supabase
    .from("jobs")
    .select("project_number, service_address, invoice_total_cents, customer_id")
    .eq("id", jobId)
    .maybeSingle();
  if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });

  const { data: customer } = await supabase.from("customers").select("name, company").eq("id", job.customer_id).maybeSingle();

  const html = buildJobPaidEmailHtml({
    jobId,
    projectNumber: job.project_number,
    customerName: customer?.name ?? "Customer",
    company: customer?.company,
    address: job.service_address,
    amountCents: job.invoice_total_cents,
  });
  return NextResponse.json({ html });
});
