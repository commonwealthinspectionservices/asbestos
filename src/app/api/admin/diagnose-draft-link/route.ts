import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-api";
import { withApiErrors } from "@/lib/api-handler";
import { getValidAccessToken, getMessageBodyText } from "@/lib/gmail";

// One-off diagnostic, 2026-09-10 — extracts the raw invite link out of a
// just-created portal-invite Gmail draft so it can be followed directly
// to demo the real portal experience, without needing to open Gmail's
// own web UI. Delete after use.
export const GET = withApiErrors(async (req: NextRequest) => {
  const unauthorized = requireAdminApi(req);
  if (unauthorized) return unauthorized;

  const draftId = req.nextUrl.searchParams.get("draftId");
  if (!draftId) return NextResponse.json({ error: "draftId required" }, { status: 400 });

  const accessToken = await getValidAccessToken();
  if (!accessToken) return NextResponse.json({ error: "Gmail not connected" }, { status: 500 });

  const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/drafts/${draftId}?format=full`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = await res.json();
  const body = getMessageBodyText(data.message);
  const match = body.match(/https:\/\/[^\s"<]+\/portal\/confirm[^\s"<]*/);
  return NextResponse.json({ link: match?.[0] ?? null, bodyPreview: body.slice(0, 500) });
});
