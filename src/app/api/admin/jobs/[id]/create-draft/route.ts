import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-api";
import { withApiErrors } from "@/lib/api-handler";
import { createCombinedDraftForJob, createInvoiceDraftForJob, createReportDraftForJob } from "@/lib/lab-email";

// Backing the Email tab's one "View Draft" button — same draft-creation
// path the automatic Gmail check and markJobPaid use, callable on demand
// any time the admin wants the freshest attachments (this always replaces
// whatever draft is already sitting there, deleting it first — see
// draftCombinedEmailForJob's own stale-draft cleanup — rather than opening
// a possibly-stale one). `kind=combined` is what the current UI sends
// (report + invoice as one draft); "invoice"/"report" still work
// standalone for any other caller, but nothing in the UI triggers them
// anymore. Returns the new draft's Gmail message id (combined only) so the
// button can jump straight to it without waiting for a job refetch.
export const POST = withApiErrors(async (
  req: NextRequest,
  { params }: { params: { id: string } }
) => {
  const unauthorized = requireAdminApi(req);
  if (unauthorized) return unauthorized;

  const kind = req.nextUrl.searchParams.get("kind");
  if (kind === "invoice") {
    await createInvoiceDraftForJob(params.id);
    return NextResponse.json({ ok: true });
  }
  if (kind === "report") {
    await createReportDraftForJob(params.id);
    return NextResponse.json({ ok: true });
  }
  const { messageId } = await createCombinedDraftForJob(params.id);
  return NextResponse.json({ ok: true, messageId });
});
