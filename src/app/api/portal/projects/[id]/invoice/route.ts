import { NextRequest, NextResponse } from "next/server";
import { requireContractorApi } from "@/lib/contractor-api";
import { getSupabaseAdmin } from "@/lib/supabase";
import { getSettings } from "@/lib/settings";
import { renderInvoicePdf } from "@/lib/invoice-pdf";
import { withApiErrors } from "@/lib/api-handler";
import { withCompanyBillingAddress } from "@/lib/customer-billing";
import type { Company, Job } from "@/lib/types";

// Portal counterpart of /api/admin/jobs/[id]/invoice — same PDF, scoped to
// the requesting contractor's own project.
export const GET = withApiErrors(async (
  req: NextRequest,
  { params }: { params: { id: string } }
) => {
  const auth = await requireContractorApi();
  if (auth.error) return auth.error;

  const supabase = getSupabaseAdmin();
  const { data: job, error } = await supabase
    .from("jobs")
    .select("*, customers!customer_id(*, companies!company_id(*))")
    .eq("id", params.id)
    .eq("customer_id", auth.customer.id)
    .single();

  if (error || !job) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const jobRow = job as unknown as Job & { customers: { companies: Company | null } };
  if (jobRow.invoice_total_cents == null) {
    return NextResponse.json({ error: "Project has not been invoiced yet" }, { status: 400 });
  }

  const customer = withCompanyBillingAddress(auth.customer, jobRow.customers.companies);
  const settings = await getSettings();
  const pdf = await renderInvoicePdf({ job: jobRow, customer, company: jobRow.customers.companies, settings });

  const disposition = req.nextUrl.searchParams.get("download") != null ? "attachment" : "inline";

  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${disposition}; filename="invoice-${jobRow.project_number ?? params.id}.pdf"`,
    },
  });
});
