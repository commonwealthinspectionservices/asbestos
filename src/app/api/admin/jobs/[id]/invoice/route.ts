import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-api";
import { getSupabaseAdmin } from "@/lib/supabase";
import { getSettings } from "@/lib/settings";
import { renderInvoicePdf } from "@/lib/invoice-pdf";
import { withApiErrors } from "@/lib/api-handler";
import { withCompanyBillingAddress } from "@/lib/customer-billing";
import type { Company, Customer, Job } from "@/lib/types";

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
  if (jobRow.invoice_total_cents == null) {
    return NextResponse.json({ error: "Project has not been invoiced yet" }, { status: 400 });
  }

  const customer = withCompanyBillingAddress(jobRow.customers, jobRow.customers.companies);
  const settings = await getSettings();
  const pdf = await renderInvoicePdf({ job: jobRow, customer, company: jobRow.customers.companies, settings });

  // "inline" opens in the browser tab for the View button; "attachment" is
  // what actually forces a save-to-disk for the Download button — some
  // browsers otherwise ignore the <a download> attribute entirely and just
  // follow whatever Content-Disposition the server sent.
  const disposition = req.nextUrl.searchParams.get("download") != null ? "attachment" : "inline";

  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${disposition}; filename="${jobRow.project_number ?? params.id} invoice.pdf"`,
    },
  });
});
