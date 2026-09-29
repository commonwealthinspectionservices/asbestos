import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-api";
import { withApiErrors } from "@/lib/api-handler";
import { checkCocDraftSentStatus } from "@/lib/lab-email";

// Live check for the Chain of Custody panel's own per-coc_type checklist —
// thin wrapper over checkCocDraftSentStatus (see its own doc comment),
// which the check-sent-drafts cron also calls so this doesn't only run
// when someone happens to have the job's Chain of Custody tab open.
export const GET = withApiErrors(async (
  req: NextRequest,
  { params }: { params: { id: string } }
) => {
  const unauthorized = requireAdminApi(req);
  if (unauthorized) return unauthorized;

  const result = await checkCocDraftSentStatus(params.id);
  return NextResponse.json(result);
});
