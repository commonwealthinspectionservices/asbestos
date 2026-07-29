import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-api";
import { withApiErrors } from "@/lib/api-handler";
import { createInvoiceDraftForJob, createReportDraftForJob } from "@/lib/lab-email";

// Manual escape hatch for the "Create Invoice Draft" / "Create Report
// Draft" buttons on the Final Report tab — same draft-creation paths the
// automatic Gmail check and markJobPaid use, for whenever those didn't run
// on their own (a manual document upload, a check that hasn't run yet, a
// lab format the parser doesn't recognize, or — for the report — a job
// that was marked paid before Gmail was connected). `kind` picks which:
// defaults to "report" only as a safety net for any caller that predates
// this split; the UI always passes it explicitly.
export const POST = withApiErrors(async (
  req: NextRequest,
  { params }: { params: { id: string } }
) => {
  const unauthorized = requireAdminApi(req);
  if (unauthorized) return unauthorized;

  const kind = req.nextUrl.searchParams.get("kind") === "invoice" ? "invoice" : "report";
  if (kind === "invoice") {
    const includePayNowLink = req.nextUrl.searchParams.get("includePayNowLink") !== "false";
    await createInvoiceDraftForJob(params.id, includePayNowLink);
  } else {
    await createReportDraftForJob(params.id);
  }
  return NextResponse.json({ ok: true });
});
