import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-api";
import { withApiErrors } from "@/lib/api-handler";
import { getValidAccessToken, listLabels, listMessagesByQuery, getMessage, getHeader, findPdfParts } from "@/lib/gmail";

// One-off diagnostic, 2026-09-05 — read-only, no writes, no labels
// touched. Tim: "all that they have sent me are in my 'crystal reports'
// folder on gmail" — investigating why 26-0008 shows two lab_invoice
// documents (num 6519 stored $80, num 6515 stored $96) whose own re-parsed
// content is byte-identical for that job. This lists every real message in
// his own Gmail label matching "crystal" (case-insensitive) within the
// given date query, so what Crystal actually sent can be read directly
// instead of inferred from stored documents.
export const GET = withApiErrors(async (req: NextRequest) => {
  const unauthorized = requireAdminApi(req);
  if (unauthorized) return unauthorized;

  const accessToken = await getValidAccessToken();
  if (!accessToken) return NextResponse.json({ error: "Gmail is not connected" }, { status: 500 });

  const labels = await listLabels(accessToken);
  const matchingLabels = labels.filter((l) => /crystal/i.test(l.name));
  if (matchingLabels.length === 0) {
    return NextResponse.json({ error: "No Gmail label matching 'crystal' found", allLabels: labels.map((l) => l.name) }, { status: 404 });
  }

  const after = req.nextUrl.searchParams.get("after") ?? "2026/08/20";
  const before = req.nextUrl.searchParams.get("before") ?? "2026/09/01";

  const results: Record<string, unknown>[] = [];
  for (const label of matchingLabels) {
    const query = `label:"${label.name}" after:${after} before:${before}`;
    const candidates = await listMessagesByQuery(accessToken, query);
    for (const candidate of candidates) {
      const message = await getMessage(accessToken, candidate.id);
      results.push({
        labelName: label.name,
        id: candidate.id,
        subject: getHeader(message, "Subject") ?? "",
        from: getHeader(message, "From") ?? "",
        date: getHeader(message, "Date") ?? "",
        attachments: findPdfParts(message.payload).map((p) => p.filename),
      });
    }
  }

  return NextResponse.json({ matchingLabels: matchingLabels.map((l) => l.name), checked: results.length, results });
});
