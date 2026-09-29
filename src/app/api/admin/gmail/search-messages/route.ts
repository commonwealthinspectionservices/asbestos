import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-api";
import { withApiErrors } from "@/lib/api-handler";
import { getValidAccessToken, listMessagesByQuery, getMessage, getHeader } from "@/lib/gmail";

// One-off admin tool, 2026-09-29 — companion to unlabel-processed: that
// route needs a messageId, and there was no way to find one short of
// paging through Gmail by hand. Takes a Gmail search query (`q`, same
// syntax as the Gmail search bar, e.g. `subject:26-0041`) and returns the
// subject/date/from of each match so the right messageId can be picked
// before calling unlabel-processed + check-now to reprocess it.
export const GET = withApiErrors(async (req: NextRequest) => {
  const unauthorized = requireAdminApi(req);
  if (unauthorized) return unauthorized;

  const q = req.nextUrl.searchParams.get("q");
  if (!q) return NextResponse.json({ error: "q required" }, { status: 400 });

  const accessToken = await getValidAccessToken();
  if (!accessToken) return NextResponse.json({ error: "Gmail is not connected" }, { status: 500 });

  const matches = await listMessagesByQuery(accessToken, q);
  const messages = await Promise.all(
    matches.map(async (m) => {
      const full = await getMessage(accessToken, m.id);
      return {
        id: m.id,
        threadId: m.threadId,
        subject: getHeader(full, "Subject"),
        from: getHeader(full, "From"),
        date: getHeader(full, "Date"),
        labelIds: full.labelIds,
      };
    })
  );

  return NextResponse.json({ messages });
});
