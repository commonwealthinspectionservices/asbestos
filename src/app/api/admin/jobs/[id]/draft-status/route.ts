import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-api";
import { withApiErrors } from "@/lib/api-handler";
import { checkDraftSentStatus } from "@/lib/lab-email";

// Live check for the Final Report tab's invoice and report rows — thin
// wrapper over checkDraftSentStatus (see its own doc comment), which the
// check-sent-drafts cron also calls so this doesn't only run when someone
// happens to have the job open. `kind` picks which pair of columns to
// check; defaults to "report" only as a safety net, the UI always passes
// it explicitly.
export const GET = withApiErrors(async (
  req: NextRequest,
  { params }: { params: { id: string } }
) => {
  const unauthorized = requireAdminApi(req);
  if (unauthorized) return unauthorized;

  const kind = req.nextUrl.searchParams.get("kind") === "invoice" ? "invoice" : "report";
  const result = await checkDraftSentStatus(params.id, kind);
  return NextResponse.json(result);
});
