import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-api";
import { withApiErrors } from "@/lib/api-handler";
import { getValidAccessToken, listMessagesByQuery, getMessage, getHeader, findPdfParts } from "@/lib/gmail";

// One-off, 2026-09-12 (26-0019) — not a route anything else calls. Delete
// after use.
//
// Read-only. Searches the connected Gmail mailbox for the original
// asbestos lab report email for this project (its data already made it
// into sample_results/asbestos_result at some point, but today's lead
// report upload overwrote the actual PDF attachment — see
// fix-26-0019-lead-docs' own history). Lists candidate messages/subjects/
// PDF filenames so the right one can be identified before re-filing it.
export const maxDuration = 30;

export const GET = withApiErrors(async (req: NextRequest) => {
  const unauthorized = requireAdminApi(req);
  if (unauthorized) return unauthorized;

  const accessToken = await getValidAccessToken();
  if (!accessToken) return NextResponse.json({ error: "Gmail not connected" }, { status: 400 });

  const query = '"26-0019" has:attachment filename:pdf';
  const candidates = await listMessagesByQuery(accessToken, query);

  const results = [];
  for (const c of candidates) {
    const message = await getMessage(accessToken, c.id);
    const pdfParts = findPdfParts(message.payload);
    results.push({
      id: c.id,
      from: getHeader(message, "From"),
      subject: getHeader(message, "Subject"),
      date: getHeader(message, "Date"),
      pdfFilenames: pdfParts.map((p) => p.filename),
    });
  }

  return NextResponse.json({ results });
});
