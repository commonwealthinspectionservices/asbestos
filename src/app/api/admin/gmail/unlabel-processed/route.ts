import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-api";
import { withApiErrors } from "@/lib/api-handler";
import { getValidAccessToken, getOrCreateLabelId, removeLabelFromMessage, getMessage, getHeader } from "@/lib/gmail";

// One-off admin tool, 2026-09-08 — removes the "Processed/Lab Reports"
// label from one specific message so checkForLabResultEmails treats it
// as a fresh candidate again on the next check-now. Same real-pipeline
// reprocessing pattern already used to fix the Sales Receipt filing bug
// (2026-09-04) — safe by construction: processWeeklyLabSummaryEmail's own
// idempotency (existingDocsForNum) means any job/transaction pair already
// correctly filed just gets skipped again, so this can only ever add a
// missing document, never double-bill an existing one. Takes messageId as
// a query param rather than hardcoding one, so this stays reusable the
// next time a parsing bug needs a real message reprocessed after a fix
// ships — GET with confirm=true required so a bare URL visit can't
// silently mutate anything.
export const GET = withApiErrors(async (req: NextRequest) => {
  const unauthorized = requireAdminApi(req);
  if (unauthorized) return unauthorized;

  const messageId = req.nextUrl.searchParams.get("messageId");
  const confirm = req.nextUrl.searchParams.get("confirm");
  if (!messageId) return NextResponse.json({ error: "messageId required" }, { status: 400 });
  if (confirm !== "true") return NextResponse.json({ error: "pass confirm=true to actually remove the label" }, { status: 400 });

  const accessToken = await getValidAccessToken();
  if (!accessToken) return NextResponse.json({ error: "Gmail is not connected" }, { status: 500 });

  const before = await getMessage(accessToken, messageId);
  const subject = getHeader(before, "Subject") ?? "";

  const labelId = await getOrCreateLabelId(accessToken, "Processed/Lab Reports");
  await removeLabelFromMessage(accessToken, messageId, labelId);

  return NextResponse.json({ ok: true, messageId, subject });
});
