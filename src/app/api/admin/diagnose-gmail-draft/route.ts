import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-api";
import { withApiErrors } from "@/lib/api-handler";
import { getValidAccessToken } from "@/lib/gmail";

// One-off, 2026-09-11 (26-0026) — read-only. Delete after use.
//
// Tim used Gmail's "Schedule Send" on this job's invoice draft, and
// checkDraftSentStatus (gmail.ts's getDraftStatus) was never built with
// that in mind — it only checks for the draft's underlying message
// carrying Gmail's SENT label, nothing about the SCHEDULED state Gmail
// actually puts a scheduled-but-not-yet-fired message into. This dumps the
// real labelIds/internalDate straight from Gmail for a given draft id so
// the actual state is visible instead of guessed at.
export const GET = withApiErrors(async (req: NextRequest) => {
  const unauthorized = requireAdminApi(req);
  if (unauthorized) return unauthorized;

  const draftId = req.nextUrl.searchParams.get("draftId");
  if (!draftId) return NextResponse.json({ error: "draftId required" }, { status: 400 });

  const accessToken = await getValidAccessToken();
  if (!accessToken) return NextResponse.json({ error: "Gmail is not connected" }, { status: 400 });

  const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/drafts/${draftId}?format=metadata`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  const body = await res.json();
  return NextResponse.json({ httpStatus: res.status, body });
});
