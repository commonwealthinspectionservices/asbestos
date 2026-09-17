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

// Per Tim, 2026-09-17 — pushed back on "a sample's real-world location
// name isn't reliably recoverable from this table's text" after seeing
// "Sample Name" right there in the report, and he was right: that
// conclusion only held for extractPositionOrderedText's own OUTPUT, which
// joins every same-row item into one space-separated line and loses the
// item boundaries in the process ("Outdoor Ambient Boiler/Equipment Room
// Basement - Common Area w/ Red Tile Basement - Back Right Bedroom" reads
// as one ambiguous blob). The underlying pdf.js text items never lost that
// information — confirmed against two real reports (26-0032, 26-0002):
// each sample's location name is already its own discrete item, not
// fragmented at the word or character level, at the exact same y as the
// "Sample Name" label itself. This finds a row by its own label text
// (exact match) and returns every OTHER item on that same line, left to
// right — one string per column, in the table's own left-to-right order
// (which extractMoldSporeTrapFindings already relies on matching the
// Sample Number row's own order, from the joined text). Returns null when
// the label isn't found on any page at all.
export async function extractLabeledRowItems(pdfBuffer: Buffer, label: string): Promise<string[] | null> {
  let result: string[] | null = null;
  async function findLabeledRow(pageData: {
    getTextContent: (opts: { normalizeWhitespace: boolean; disableCombineTextItems: boolean }) => Promise<{
      items: { str: string; transform: number[] }[];
    }>;
  }): Promise<string> {
    if (result) return "";
    const textContent = await pageData.getTextContent({ normalizeWhitespace: false, disableCombineTextItems: false });
    const items: PositionedItem[] = textContent.items
      .map((it) => ({ str: it.str, x: it.transform[4], y: Math.round(it.transform[5]) }))
      .filter((it) => it.str.trim().length > 0);
    const labelItem = items.find((it) => it.str.trim() === label);
    if (labelItem) {
      result = items
        .filter((it) => it.y === labelItem.y && it !== labelItem)
        .sort((a, b) => a.x - b.x)
        .map((it) => it.str.trim());
    }
    return "";
  }
  await pdfParse(pdfBuffer, { pagerender: findLabeledRow });
  return result;
}
