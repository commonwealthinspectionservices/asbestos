import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-api";
import { withApiErrors } from "@/lib/api-handler";
import { buildJobScheduledEmailHtml } from "@/lib/booking-notify";

// Per Tim, 2026-09-02 — "show me what it'd say": lets Add Project's
// "email them that it's scheduled" checkbox preview the exact email
// sendJobScheduledNotification would send, from the form's own
// in-progress values — no job needs to exist yet. Reuses
// buildJobScheduledEmailHtml so this can never drift from the real send.
export const POST = withApiErrors(async (req: NextRequest) => {
  const unauthorized = requireAdminApi(req);
  if (unauthorized) return unauthorized;

  const body = await req.json().catch(() => null);
  const { projectNumber, serviceAddress, confirmedDate, confirmedTime } = body ?? {};
  if (!serviceAddress || !confirmedDate) {
    return NextResponse.json({ error: "serviceAddress and confirmedDate are required" }, { status: 400 });
  }

  const html = buildJobScheduledEmailHtml({
    projectNumber: projectNumber || null,
    serviceAddress,
    confirmedDate,
    confirmedTime: confirmedTime || null,
  });
  return NextResponse.json({ html });
});
