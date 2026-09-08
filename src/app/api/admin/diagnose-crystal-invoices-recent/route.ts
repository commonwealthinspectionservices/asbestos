import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-api";
import { withApiErrors } from "@/lib/api-handler";
import { getValidAccessToken, listMessagesByQuery, getMessage, getHeader, findPdfParts } from "@/lib/gmail";

// One-off, 2026-09-08 — read-only. Tim: "I'm sure they did charge this
// all already" re: 3 jobs the app shows as "no lab invoice yet" (their
// week is over). Lists every real message in the "Crystal Invoices"
// Gmail label since 08/20, so it can be checked directly against what the
// pipeline recorded, rather than trusting the pipeline's own silence as
// proof nothing arrived.
export const GET = withApiErrors(async (req: NextRequest) => {
  const unauthorized = requireAdminApi(req);
  if (unauthorized) return unauthorized;
  const accessToken = await getValidAccessToken();
  if (!accessToken) return NextResponse.json({ error: "Gmail is not connected" }, { status: 500 });

  const query = `label:"Crystal Invoices" after:2026/08/20`;
  const candidates = await listMessagesByQuery(accessToken, query);
  const results = [];
  for (const c of candidates) {
    const message = await getMessage(accessToken, c.id);
    results.push({
      id: c.id,
      subject: getHeader(message, "Subject") ?? "",
      date: getHeader(message, "Date") ?? "",
      labelIds: message.labelIds ?? [],
      attachments: findPdfParts(message.payload).map((p) => p.filename),
    });
  }
  return NextResponse.json({ checked: results.length, results });
});
