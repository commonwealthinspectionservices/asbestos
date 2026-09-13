import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-api";
import { withApiErrors } from "@/lib/api-handler";
import { getValidAccessToken, listMessagesByQuery, getMessage, getHeader } from "@/lib/gmail";

// One-off, per Tim, 2026-09-13 — after the resend-amount fix + backfill,
// every dollar this app tracks reconciles exactly against QuickBooks
// except one untraced $504 entry dated 09/11/2026. Broadens the search
// past "has:attachment filename:pdf" (which only catches the weekly
// summary shape) to every email mentioning Crystal around that date, to
// see what else exists that the normal pipeline never classified as a
// lab summary/invoice at all. Delete after running.
export const GET = withApiErrors(async (req: NextRequest) => {
  const unauthorized = requireAdminApi(req);
  if (unauthorized) return unauthorized;
  const accessToken = await getValidAccessToken();
  if (!accessToken) return NextResponse.json({ error: "no token" }, { status: 400 });

  const candidates = await listMessagesByQuery(accessToken, `crystal newer_than:21d -from:me`);
  const rows = [];
  for (const c of candidates) {
    const message = await getMessage(accessToken, c.id);
    rows.push({
      id: c.id,
      subject: getHeader(message, "Subject"),
      from: getHeader(message, "From"),
      date: getHeader(message, "Date"),
      hasAttachment: (message.payload?.parts ?? []).some((p) => p.filename),
      labelIds: message.labelIds ?? [],
    });
  }
  return NextResponse.json({ count: rows.length, rows });
});
