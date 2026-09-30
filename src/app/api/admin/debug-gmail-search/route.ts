import { NextRequest, NextResponse } from "next/server";
import { requireOwnerApi } from "@/lib/admin-api";
import { withApiErrors } from "@/lib/api-handler";
import { getValidAccessToken, listMessagesByQuery, getMessage, getHeader, getMessageBodyText, findPdfParts, getAttachmentData } from "@/lib/gmail";
import { parsePdfWithRetry } from "@/lib/lab-email";
import { extractPositionOrderedText } from "@/lib/pdf-position-text";
import { extractSampleResults, extractCrystalAnalyticalMaterialDescriptions } from "@/lib/parse-lab-report";

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
  // Per Tim, 2026-09-30 (26-0056's field-code-collision recovery,
  // follow-up) — plain pdf-parse text doesn't preserve the PDF's own
  // reading order (see extractPositionOrderedText's own comment: Crystal
  // Analytical's tables only parse correctly from position-ordered text),
  // so reconstructing a jumbled report by eye risked mismatching a % to
  // the wrong sample. Runs the exact same extractSampleResults/
  // extractCrystalAnalyticalMaterialDescriptions the real pipeline parses
  // every lab report with, just against one specific message here instead
  // of whatever checkForLabResultEmails happens to be looking at.
  const includeParsedResults = req.nextUrl.searchParams.get("includeParsedResults") === "true";

  const accessToken = await getValidAccessToken();
  if (!accessToken) return NextResponse.json({ error: "Gmail is not connected" }, { status: 500 });

  const candidates = await listMessagesByQuery(accessToken, q);
  const messages = await Promise.all(candidates.slice(0, limit).map((c) => getMessage(accessToken, c.id)));

  return NextResponse.json({
    messages: await Promise.all(messages.map(async (m) => {
      const pdfParts = findPdfParts(m.payload);
      let pdfText: string[] | undefined;
      let parsedResults: unknown[] | undefined;
      if ((includePdfText || includeParsedResults) && pdfParts.length > 0) {
        const perPart = await Promise.all(pdfParts.map(async (p) => {
          const data = await getAttachmentData(accessToken, m.id, p.attachmentId);
          const { text } = await parsePdfWithRetry(data, `${m.id}:${p.filename}`);
          if (!includeParsedResults) return { text, results: undefined };
          const positionOrderedText = await extractPositionOrderedText(data);
          const sampleResults = extractSampleResults(text, positionOrderedText);
          const materials = extractCrystalAnalyticalMaterialDescriptions(positionOrderedText);
          const results = sampleResults.map((s) => ({ ...s, material: materials[s.fieldCode] }));
          return { text, results };
        }));
        if (includePdfText) pdfText = perPart.map((p) => p.text);
        if (includeParsedResults) parsedResults = perPart.flatMap((p) => p.results ?? []);
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
        ...(parsedResults ? { parsedResults } : {}),
      };
    })),
  });
});
