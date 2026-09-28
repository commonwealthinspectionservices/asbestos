import { NextRequest, NextResponse } from "next/server";
import { requireOwnerApi } from "@/lib/admin-api";
import { withApiErrors } from "@/lib/api-handler";
import { getValidAccessToken, createDraft } from "@/lib/gmail";

// One-off admin tool — per Tim, 2026-09-28, drafting a custom email to
// Boston Harbor's Jake about 5 overdue invoices, not tied to any one job's
// existing draft flow (report/invoice/COC). Same draft-only pattern as
// every other document this app emails out — createDraft, never
// gmail.send — a real Gmail draft lands in the inbox for him to review
// and send himself. Owner-only, read/write nothing but Gmail.
export const POST = withApiErrors(async (req: NextRequest) => {
  const unauthorized = requireOwnerApi(req);
  if (unauthorized) return unauthorized;

  const body = await req.json().catch(() => null);
  const to = typeof body?.to === "string" ? body.to.trim() : "";
  const cc = typeof body?.cc === "string" ? body.cc.trim() : undefined;
  const subject = typeof body?.subject === "string" ? body.subject.trim() : "";
  const bodyHtml = typeof body?.bodyHtml === "string" ? body.bodyHtml : "";
  if (!to || !subject || !bodyHtml) {
    return NextResponse.json({ error: "to, subject, and bodyHtml are required" }, { status: 400 });
  }

  const accessToken = await getValidAccessToken();
  if (!accessToken) {
    return NextResponse.json({ error: "Gmail is not connected" }, { status: 500 });
  }

  const { messageId } = await createDraft(accessToken, { to, cc, subject, bodyHtml, attachments: [] });
  return NextResponse.json({ ok: true, messageId });
});
