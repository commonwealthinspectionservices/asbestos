import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-api";
import { getSupabaseAdmin } from "@/lib/supabase";
import { getSettings } from "@/lib/settings";
import { buildFinalReportPacket } from "@/lib/report-packet";
import { withApiErrors } from "@/lib/api-handler";
import { withCompanyBillingAddress } from "@/lib/customer-billing";
import { jobReportDomains, reportDownloadFilename, type ReportDomain } from "@/lib/report-findings";
import type { Company, Customer, Job } from "@/lib/types";

const REPORT_DOMAINS: ReportDomain[] = ["asbestos", "lead", "mold"];

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
  const settings = await getSettings();

  // One report per domain (asbestos/lead/mold) actually on the job — the
  // caller says which one it wants via ?type=. Omitting it only works when
  // the job has exactly one domain (the common single-service-type case),
  // so existing single-type links keep working unchanged; a multi-domain
  // job must specify which report it's downloading.
  const typeParam = req.nextUrl.searchParams.get("type");
  const domains = jobReportDomains(jobRow.service_type);
  let domain: ReportDomain;
  if (typeParam) {
    if (!REPORT_DOMAINS.includes(typeParam as ReportDomain)) {
      return NextResponse.json({ error: `Invalid type "${typeParam}"` }, { status: 400 });
    }
    domain = typeParam as ReportDomain;
  } else if (domains.length === 1) {
    domain = domains[0];
  } else {
    return NextResponse.json({ error: "This job has multiple report types — specify ?type=" }, { status: 400 });
  }

  const pdf = await buildFinalReportPacket(jobRow, customer, settings, domain);

  // Same reasoning as the invoice route: "attachment" is what actually
  // forces a save-to-disk for the Download link — some browsers ignore the
  // <a download> attribute entirely and just follow Content-Disposition.
  const disposition = req.nextUrl.searchParams.get("download") != null ? "attachment" : "inline";

  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${disposition}; filename="${reportDownloadFilename(jobRow, domain, params.id)}.pdf"`,
    },
  });
});
