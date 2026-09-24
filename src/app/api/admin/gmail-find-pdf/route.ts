import { NextRequest, NextResponse } from "next/server";
import pdfParse from "pdf-parse/lib/pdf-parse.js";
import { requireOwnerApi } from "@/lib/admin-api";
import { withApiErrors } from "@/lib/api-handler";
import { findPdfParts, getAttachmentData, getHeader, getMessage, getValidAccessToken, listMessagesByQuery } from "@/lib/gmail";

// One-off, owner-only, READ-ONLY: ?q=<gmail search> lists matching PDFs
// (subject/date/project number/collected date/kind); ?messageId=&part=<n>
// streams that PDF so it can be re-uploaded through the normal document
// upload. Temporary — for recovering 26-0041's overwritten air report.
export const GET = withApiErrors(async (req: NextRequest) => {
  const unauthorized = requireOwnerApi(req);
  if (unauthorized) return unauthorized;

  const accessToken = await getValidAccessToken();
  if (!accessToken) return NextResponse.json({ error: "Gmail is not connected" }, { status: 400 });

  const url = new URL(req.url);
  const messageId = url.searchParams.get("messageId");
  if (messageId) {
    const partIndex = Number(url.searchParams.get("part") ?? "0");
    const message = await getMessage(accessToken, messageId);
    const part = findPdfParts(message.payload)[partIndex];
    if (!part) return NextResponse.json({ error: "No such PDF part" }, { status: 404 });
    const data = await getAttachmentData(accessToken, messageId, part.attachmentId);
    return new NextResponse(data, { headers: { "Content-Type": "application/pdf" } });
  }

  const q = url.searchParams.get("q");
  if (!q) return NextResponse.json({ error: "q or messageId required" }, { status: 400 });
  const found = await listMessagesByQuery(accessToken, q);
  const out = [];
  for (const m of found.slice(0, 40)) {
    const message = await getMessage(accessToken, m.id);
    const parts = findPdfParts(message.payload);
    const pdfs = [];
    for (let i = 0; i < parts.length; i++) {
      let info: Record<string, unknown> = {};
      try {
        const data = await getAttachmentData(accessToken, m.id, parts[i].attachmentId);
        const { text } = await pdfParse(data);
        info = {
          bytes: data.length,
          project: /Project Information:\s*(\S+)/i.exec(text)?.[1] ?? null,
          collected: /Collected:\s*([A-Za-z]+ \d+, \d{4}|\d{2}\/\d{2}\/\d{2,4})/i.exec(text)?.[1] ?? null,
          kind: /Air-O-Cell|spore trap/i.test(text) ? "air (spore trap)" : /Direct Analysis/i.test(text) ? "bulk (direct analysis)" : /asbestos|PLM/i.test(text) ? "asbestos" : "other",
        };
      } catch (e) {
        info = { error: e instanceof Error ? e.message : String(e) };
      }
      pdfs.push({ part: i, filename: parts[i].filename, ...info });
    }
    out.push({ id: m.id, subject: getHeader(message, "Subject"), from: getHeader(message, "From"), date: getHeader(message, "Date"), labels: message.labelIds, pdfs });
  }
  return NextResponse.json({ messages: out });
});
