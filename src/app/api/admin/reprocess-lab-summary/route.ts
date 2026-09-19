import { NextRequest, NextResponse } from "next/server";
import { requireOwnerApi } from "@/lib/admin-api";
import { withApiErrors } from "@/lib/api-handler";
import { reprocessLabSummaryMessage } from "@/lib/lab-email";

// Owner-only: re-runs the weekly lab summary pipeline on one Gmail message
// (see reprocessLabSummaryMessage) — for a Crystal charge that was in a
// summary but never landed on a job.
export const POST = withApiErrors(async (req: NextRequest) => {
  const unauthorized = requireOwnerApi(req);
  if (unauthorized) return unauthorized;

  const body = await req.json().catch(() => null);
  const messageId = typeof body?.messageId === "string" ? body.messageId.trim() : "";
  if (!messageId) return NextResponse.json({ error: "messageId is required" }, { status: 400 });

  const result = await reprocessLabSummaryMessage(messageId);
  return NextResponse.json({
    recorded: result.recorded.map((r) => ({ project: r.projectNumber, num: r.num })),
    unmatched: result.unmatched.map((u) => ({ num: u.num, address: u.address })),
    flagged: result.flagged,
  });
});
