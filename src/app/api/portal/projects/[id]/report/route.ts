import { NextRequest, NextResponse } from "next/server";
import { requireContractorApi } from "@/lib/contractor-api";
import { getSupabaseAdmin } from "@/lib/supabase";
import { getSettings } from "@/lib/settings";
import { renderProjectReportPdf } from "@/lib/report-pdf";
import { withApiErrors } from "@/lib/api-handler";
import type { Job } from "@/lib/types";

const REPORT_READY_STATUSES = new Set(["completed", "invoiced", "ready_to_send", "paid"]);

export const GET = withApiErrors(async (
  req: NextRequest,
  { params }: { params: { id: string } }
) => {
  const auth = await requireContractorApi();
  if (auth.error) return auth.error;

  const supabase = getSupabaseAdmin();
  const { data: job, error } = await supabase
    .from("jobs")
    .select("*")
    .eq("id", params.id)
    .eq("customer_id", auth.customer.id) // scoped: contractors only see their own project's report
    .single();

  if (error || !job) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const jobRow = job as unknown as Job;
  if (!REPORT_READY_STATUSES.has(jobRow.status)) {
    return NextResponse.json({ error: "Report isn't available until the project is complete" }, { status: 400 });
  }

  const settings = await getSettings();
  const pdf = await renderProjectReportPdf({ job: jobRow, customer: auth.customer, settings });

  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="project-report-${params.id}.pdf"`,
    },
  });
});
