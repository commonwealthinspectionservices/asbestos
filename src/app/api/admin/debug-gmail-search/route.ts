import { NextRequest, NextResponse } from "next/server";
import { requireOwnerApi } from "@/lib/admin-api";
import { withApiErrors } from "@/lib/api-handler";
import { getValidAccessToken, listMessagesByQuery, getMessage, getHeader, getMessageBodyText, findPdfParts, getAttachmentData } from "@/lib/gmail";
import { parsePdfWithRetry } from "@/lib/lab-email";

// Read-only, owner-only: a generic Gmail search + body-text dump, used to
// spot-check what a real email's raw text/headers actually look like
// before writing a parser against it — same reasoning as
// list-lab-summary-messages (built the same day), generalized so the next
// new parser doesn't need its own one-off debug route.
// Per Tim, 2026-09-30 — extended (26-0056's field-code-collision recovery)
// to optionally dump each PDF attachment's own extracted text too
// (?includePdfText=true), reusing the exact same parsePdfWithRetry the
// real pipeline parses lab reports with — so a report that needs manual
// reading (two colliding field-code ranges from an old split job, in this
// case) can be read here instead of downloading and opening it by hand.
export const GET = withApiErrors(async (req: NextRequest) => {
  const unauthorized = requireOwnerApi(req);
  if (unauthorized) return unauthorized;

  const q = req.nextUrl.searchParams.get("q");
  if (!q) return NextResponse.json({ error: "?q=<gmail search query> required" }, { status: 400 });
  const limit = Math.min(Number(req.nextUrl.searchParams.get("limit") ?? "5") || 5, 20);
  const includePdfText = req.nextUrl.searchParams.get("includePdfText") === "true";

  const accessToken = await getValidAccessToken();
  if (!accessToken) return NextResponse.json({ error: "Gmail is not connected" }, { status: 500 });

  const candidates = await listMessagesByQuery(accessToken, q);
  const messages = await Promise.all(candidates.slice(0, limit).map((c) => getMessage(accessToken, c.id)));

  return NextResponse.json({
    messages: await Promise.all(messages.map(async (m) => {
      const pdfParts = findPdfParts(m.payload);
      let pdfText: string[] | undefined;
      if (includePdfText && pdfParts.length > 0) {
        pdfText = await Promise.all(pdfParts.map(async (p) => {
          const data = await getAttachmentData(accessToken, m.id, p.attachmentId);
          const { text } = await parsePdfWithRetry(data, `${m.id}:${p.filename}`);
          return text;
        }));
      }
      return {
        id: m.id,
        threadId: m.threadId,
        from: getHeader(m, "From"),
        subject: getHeader(m, "Subject"),
        date: m.internalDate ? new Date(Number(m.internalDate)).toISOString() : null,
        bodyText: getMessageBodyText(m),
        pdfAttachments: pdfParts.map((p) => p.filename),
        ...(pdfText ? { pdfText } : {}),
      };
    })),
  });
});
