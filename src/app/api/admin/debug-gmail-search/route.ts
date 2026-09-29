import { NextRequest, NextResponse } from "next/server";
import { requireOwnerApi } from "@/lib/admin-api";
import { withApiErrors } from "@/lib/api-handler";
import { getValidAccessToken, listMessagesByQuery, getMessage, getHeader, getMessageBodyText } from "@/lib/gmail";

// Read-only, owner-only: a generic Gmail search + body-text dump, used to
// spot-check what a real email's raw text/headers actually look like
// before writing a parser against it — same reasoning as
// list-lab-summary-messages (built the same day), generalized so the next
// new parser doesn't need its own one-off debug route.
export const GET = withApiErrors(async (req: NextRequest) => {
  const unauthorized = requireOwnerApi(req);
  if (unauthorized) return unauthorized;

  const q = req.nextUrl.searchParams.get("q");
  if (!q) return NextResponse.json({ error: "?q=<gmail search query> required" }, { status: 400 });
  const limit = Math.min(Number(req.nextUrl.searchParams.get("limit") ?? "5") || 5, 20);

  const accessToken = await getValidAccessToken();
  if (!accessToken) return NextResponse.json({ error: "Gmail is not connected" }, { status: 500 });

  const candidates = await listMessagesByQuery(accessToken, q);
  const messages = await Promise.all(candidates.slice(0, limit).map((c) => getMessage(accessToken, c.id)));

  return NextResponse.json({
    messages: messages.map((m) => ({
      id: m.id,
      threadId: m.threadId,
      from: getHeader(m, "From"),
      subject: getHeader(m, "Subject"),
      date: m.internalDate ? new Date(Number(m.internalDate)).toISOString() : null,
      bodyText: getMessageBodyText(m),
    })),
  });
});
