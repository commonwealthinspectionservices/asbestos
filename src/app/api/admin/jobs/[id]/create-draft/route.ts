import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-api";
import { withApiErrors } from "@/lib/api-handler";
import { createCombinedDraftForJob, createInvoiceDraftForJob, createReportDraftForJob } from "@/lib/lab-email";

// Manual escape hatch for the Email tab's "Create Draft" button — same
// draft-creation path the automatic Gmail check and markJobPaid use, for
// whenever those didn't run on their own (a manual document upload, a
// check that hasn't run yet, a lab format the parser doesn't recognize, or
// a job that was marked paid before Gmail was connected). `kind=combined`
// is what the current UI sends (report + invoice as one draft); "invoice"/
// "report" still work standalone for any other caller, but nothing in the
// UI triggers them anymore.
export const POST = withApiErrors(async (
  req: NextRequest,
  { params }: { params: { id: string } }
) => {
  const unauthorized = requireAdminApi(req);
  if (unauthorized) return unauthorized;

  const kind = req.nextUrl.searchParams.get("kind");
  if (kind === "invoice") {
    const includePayNowLink = req.nextUrl.searchParams.get("includePayNowLink") !== "false";
    await createInvoiceDraftForJob(params.id, includePayNowLink);
  } else if (kind === "report") {
    await createReportDraftForJob(params.id);
  } else {
    await createCombinedDraftForJob(params.id);
  }
  return NextResponse.json({ ok: true });
});
