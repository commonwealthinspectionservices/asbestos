import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-api";
import { withApiErrors } from "@/lib/api-handler";
import { getValidAccessToken, getMessage, getHeader, findPdfParts, getAttachmentData } from "@/lib/gmail";

export const GET = withApiErrors(async (req: NextRequest) => {
  const unauthorized = requireAdminApi(req);
  if (unauthorized) return unauthorized;
  const accessToken = await getValidAccessToken();
  if (!accessToken) return NextResponse.json({ error: "no token" }, { status: 400 });
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "missing id" }, { status: 400 });
  const message = await getMessage(accessToken, id);
  const subject = getHeader(message, "Subject");
  const from = getHeader(message, "From");
  const pdfParts = findPdfParts(message.payload);
  const parts = [];
  for (const part of pdfParts) {
    const data = await getAttachmentData(accessToken, id, part.attachmentId);
    parts.push({ filename: part.filename, bytes: data.length, first20: data.subarray(0, 20).toString("utf-8").replace(/[^\x20-\x7e]/g, ".") });
  }
  return NextResponse.json({ subject, from, parts });
});
