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

  // Optional { "<lab receipt number>": "<project number>" } — the owner's own
  // answer for a charge the matcher can't resolve by itself.
  const overrides: Record<string, string> = {};
  if (body?.overrides && typeof body.overrides === "object") {
    for (const [num, project] of Object.entries(body.overrides as Record<string, unknown>)) {
      if (typeof project === "string" && project.trim()) overrides[num] = project.trim();
    }
  }

  const result = await reprocessLabSummaryMessage(messageId, overrides);
  return NextResponse.json({
    recorded: result.recorded.map((r) => ({ project: r.projectNumber, num: r.num })),
    unmatched: result.unmatched.map((u) => ({ num: u.num, address: u.address })),
    flagged: result.flagged,
  });
});
