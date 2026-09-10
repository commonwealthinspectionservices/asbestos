import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-api";
import { withApiErrors } from "@/lib/api-handler";
import { getValidAccessToken, listMessagesByQuery, getMessage, getHeader } from "@/lib/gmail";

// One-off diagnostic, 2026-09-09 — checking whether job 26-0022 (an FLI
// job, South Boston) has a real Crystal Analytical email sitting
// unmatched in Gmail right now, per the FLI address-matching
// investigation. Delete after use.
export const GET = withApiErrors(async (req: NextRequest) => {
  const unauthorized = requireAdminApi(req);
  if (unauthorized) return unauthorized;

  const accessToken = await getValidAccessToken();
  if (!accessToken) return NextResponse.json({ error: "Gmail not connected" }, { status: 500 });

  const messages = await listMessagesByQuery(accessToken, "from:crystalanalytical.com newer_than:14d");
  const results = [];
  for (const m of messages) {
    const full = await getMessage(accessToken, m.id);
    results.push({
      id: m.id,
      subject: getHeader(full, "Subject"),
      date: getHeader(full, "Date"),
      labels: full.labelIds,
    });
  }
  return NextResponse.json({ count: results.length, results });
});
