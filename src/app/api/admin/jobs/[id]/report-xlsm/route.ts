import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-api";
import { getSupabaseAdmin } from "@/lib/supabase";
import { renderProjectXlsm } from "@/lib/report-xlsm";
import { withApiErrors } from "@/lib/api-handler";
import { withCompanyBillingAddress } from "@/lib/customer-billing";
import type { Company, Customer, Job } from "@/lib/types";

// The manually-editable companion to the PDF report — the same "Asbestos
// Limited Template.xlsm" the admin already works from day to day, with the
// job-specific fields filled in, so he can hand-tweak it (add remarks,
// adjust wording) before sending, same as his existing workflow.
export const GET = withApiErrors(async (
  req: NextRequest,
  { params }: { params: { id: string } }
) => {
  const unauthorized = requireAdminApi(req);
  if (unauthorized) return unauthorized;

  const supabase = getSupabaseAdmin();
  const { data: job, error } = await supabase
    .from("jobs")
    .select("*, customers!customer_id(*, companies!company_id(*))")
    .eq("id", params.id)
    .single();

  if (error || !job) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const jobRow = job as unknown as Job & { customers: Customer & { companies: Company | null } };
  const customer = withCompanyBillingAddress(jobRow.customers, jobRow.customers.companies);
  const xlsm = await renderProjectXlsm({ job: jobRow, customer });

  const fileName = [jobRow.project_number, jobRow.service_address].filter(Boolean).join(" ") || `project-${params.id}`;
  const safeFileName = fileName.replace(/[^a-zA-Z0-9 .,#'-]/g, "_");

  return new NextResponse(new Uint8Array(xlsm), {
    headers: {
      "Content-Type": "application/vnd.ms-excel.sheet.macroEnabled.12",
      "Content-Disposition": `attachment; filename="${safeFileName}.xlsm"`,
    },
  });
});
