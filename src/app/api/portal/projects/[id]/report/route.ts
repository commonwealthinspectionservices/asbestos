import { NextRequest, NextResponse } from "next/server";
import { requireContractorApi, getCompanyCustomerIds } from "@/lib/contractor-api";
import { getSupabaseAdmin } from "@/lib/supabase";
import { getSettings } from "@/lib/settings";
import { renderProjectReportPdfForDomain } from "@/lib/report-pdf";
import { withApiErrors } from "@/lib/api-handler";
import { jobReportDomains, reportDownloadFilename, type ReportDomain } from "@/lib/report-findings";
import type { Customer, Job } from "@/lib/types";

const REPORT_READY_STATUSES = new Set(["completed", "invoiced", "ready_to_send", "paid"]);
const REPORT_DOMAINS: ReportDomain[] = ["asbestos", "lead", "mold"];

export const GET = withApiErrors(async (
  req: NextRequest,
  { params }: { params: { id: string } }
) => {
  const auth = await requireContractorApi();
  if (auth.error) return auth.error;

  const companyCustomerIds = await getCompanyCustomerIds(auth.customer);

  const supabase = getSupabaseAdmin();
  const { data: job, error } = await supabase
    .from("jobs")
    .select("*, customers!customer_id(*)")
    .eq("id", params.id)
    .in("customer_id", companyCustomerIds) // scoped: contractors only see projects from their own company
    .single();

  if (error || !job) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const jobRow = job as unknown as Job & { customers: Customer };
  // Individuals (paying out of pocket) don't get the report until they've
  // actually paid — a company job has no such gate, since net-30
  // billing means the report is often needed well before payment for
  // permits/project use. report_release_override is the admin's manual
  // escape hatch for an occasional exception — treated exactly like
  // "paid" here. Mirrors ProjectDetailModal.tsx's own reportReady.
  const reportReady = REPORT_READY_STATUSES.has(jobRow.status) && (!jobRow.is_individual || jobRow.status === "paid" || jobRow.report_release_override);
  if (!reportReady) {
    return NextResponse.json({ error: "Report isn't available until the project is complete" }, { status: 400 });
  }

  const settings = await getSettings();

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

  // The job's own customer, not necessarily the logged-in viewer — a
  // colleague at the same company can view this report too.
  const pdf = await renderProjectReportPdfForDomain({ job: jobRow, customer: jobRow.customers, settings }, domain);

  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${reportDownloadFilename(jobRow, domain, params.id)}.pdf"`,
    },
  });
});
