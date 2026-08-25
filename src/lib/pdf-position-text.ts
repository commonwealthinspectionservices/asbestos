// pdf-parse's default text extraction (src/lib/lab-email.ts,
// api/admin/jobs/[id]/documents/route.ts) walks a PDF's content stream in
// draw order, not visual reading order — most reports don't care (a label
// and its value land next to each other in the stream either way), but
// Crystal Analytical's asbestos PLM table interleaves cells across rows and
// columns in an order that has nothing to do with the printed table
// (confirmed against a real report: "MA DLS - License #" at y=142 sits
// right after "Project ID:" at y=557 in the raw stream). That broke
// bestReportSamplesCrystalAnalytical's field-code-to-result pairing —
// wrong results attached to wrong field codes, real positives dropped
// entirely.
//
// Sorting every text item by its own on-page position (top to bottom, left
// to right) before joining reconstructs the table exactly as printed —
// verified against 2601003617 (36 Drummer Rd., Acton, MA): every one of
// its 12 rows lines up correctly, including the one true positive (01A/01B,
// 3% Chrysotile) that the stream-order text lost. Used only by the Crystal
// Analytical asbestos path (bestReportSamplesCrystalAnalytical) — EMSL's
// extractor already has its own stream-order-specific workaround (see
// bestReportSamples's "backward fallback" comment) that this must not
// disturb.
import pdfParse from "pdf-parse/lib/pdf-parse.js";

interface PositionedItem {
  str: string;
  x: number;
  y: number;
}

export async function extractPositionOrderedText(pdfBuffer: Buffer): Promise<string> {
  async function renderPageInPosition(pageData: {
    getTextContent: (opts: { normalizeWhitespace: boolean; disableCombineTextItems: boolean }) => Promise<{
      items: { str: string; transform: number[] }[];
    }>;
  }): Promise<string> {
    const textContent = await pageData.getTextContent({ normalizeWhitespace: false, disableCombineTextItems: false });
    const items: PositionedItem[] = textContent.items
      .map((it) => ({ str: it.str, x: it.transform[4], y: Math.round(it.transform[5]) }))
      .filter((it) => it.str.length > 0);
    items.sort((a, b) => (b.y - a.y) || (a.x - b.x));

    let text = "";
    let lastY: number | null = null;
    for (const item of items) {
      if (lastY === null || item.y === lastY) {
        text += (text.length > 0 && !text.endsWith(" ") && lastY !== null ? " " : "") + item.str;
      } else {
        text += "\n" + item.str;
      }
      lastY = item.y;
    }
    return text;
  }

  const data = await pdfParse(pdfBuffer, { pagerender: renderPageInPosition });
  return data.text;
}
