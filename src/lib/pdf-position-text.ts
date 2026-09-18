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
//
// Per Tim, 2026-09-17 (26-0030) — a job with more air samples than fit in
// one table gets a SECOND same-labeled table further down the report (its
// own "Sample Name" row, no baseline column — see
// extractMoldSporeTrapFindings' own comment). Every matching row across
// every page now contributes its own columns, concatenated in document
// order, instead of just the first one found — the only caller of this
// (mold air's "Sample Name") already expects one name per sample in report
// order, so a report with just one matching row behaves exactly as before.
export async function extractLabeledRowItems(pdfBuffer: Buffer, label: string): Promise<string[] | null> {
  const rows: string[][] = [];
  async function findLabeledRow(pageData: {
    getTextContent: (opts: { normalizeWhitespace: boolean; disableCombineTextItems: boolean }) => Promise<{
      items: { str: string; transform: number[] }[];
    }>;
  }): Promise<string> {
    const textContent = await pageData.getTextContent({ normalizeWhitespace: false, disableCombineTextItems: false });
    const items: PositionedItem[] = textContent.items
      .map((it) => ({ str: it.str, x: it.transform[4], y: Math.round(it.transform[5]) }))
      .filter((it) => it.str.trim().length > 0);
    for (const labelItem of items.filter((it) => it.str.trim() === label)) {
      const row = items
        .filter((it) => it.y === labelItem.y && it !== labelItem)
        .sort((a, b) => a.x - b.x)
        .map((it) => it.str.trim());
      if (row.length > 0) rows.push(row);
    }
    return "";
  }
  await pdfParse(pdfBuffer, { pagerender: findLabeledRow });
  return rows.length > 0 ? rows.flat() : null;
}

export interface SporeTrapCellValue {
  count: number;
  structPerM3: number;
  pct: number;
}

// Per Tim, 2026-09-17 (26-0030) — a real report's own "Composition Alert"
// coloring flagged a taxon at 42.6% of one sample's total, but that
// sample's row in the flattened text only had 3 of that page's 3 column
// groups present for a DIFFERENT taxon and was correctly parsed there —
// the actual miss was elsewhere: a taxon genuinely undetected in the
// baseline sample prints nothing at all for that cell (Crystal never
// prints a placeholder zero), and extractMoldSporeTrapFindings' flattened-
// text parsing can't tell which of the table's columns a partial row's
// present numbers belong to when one or more cells are blank like that —
// so it correctly refused to guess and dropped the whole row, silently
// losing the one real elevated finding along with it.
//
// This resolves that ambiguity using each value's own on-page position:
// every table's "Total" row is guaranteed complete (unlike an individual
// taxon), so its own column x-positions are a reliable anchor. A taxon's
// row is read the same way (group of 3 nearby items = one column's
// count/struct/%), and each group's x is matched to whichever Total-row
// anchor it's closest to — resolving that (in this report) a lone
// 2-value row belongs to columns 2 and 4, not 1 and 2. A blank/undetected
// cell simply has no group near its anchor at all, which the caller (see
// extractMoldSporeTrapFindings) can then safely treat as a real, printed
// zero rather than dropping the whole row over it.
export async function extractSporeTrapTaxonColumns(
  pdfBuffer: Buffer,
  taxa: string[]
): Promise<{ columnCount: number; valuesByTaxon: Map<string, Map<number, SporeTrapCellValue>> }[]> {
  const pages: { columnCount: number; valuesByTaxon: Map<string, Map<number, SporeTrapCellValue>> }[] = [];
  // Longest-first, same reasoning as findSporeTrapTaxonInLine — an exact
  // full-string match here so a shorter taxon name never matters, but kept
  // for parity with how the caller's own list is normally sorted.
  const sortedTaxa = [...taxa].sort((a, b) => b.length - a.length);

  async function renderPage(pageData: {
    getTextContent: (opts: { normalizeWhitespace: boolean; disableCombineTextItems: boolean }) => Promise<{
      items: { str: string; transform: number[] }[];
    }>;
  }): Promise<string> {
    const textContent = await pageData.getTextContent({ normalizeWhitespace: false, disableCombineTextItems: false });
    const items: PositionedItem[] = textContent.items
      .map((it) => ({ str: it.str, x: it.transform[4], y: Math.round(it.transform[5]) }))
      .filter((it) => it.str.trim().length > 0);

    // Only a page with the spore-trap table itself — an unrelated table
    // elsewhere in the report (e.g. a Direct Analysis/PLM page) can have
    // its own "Total" row too, and including it here would misalign this
    // function's own page order against extractMoldSporeTrapFindings'
    // own section order (both assume one entry per actual spore-trap
    // table, in document order).
    if (!items.some((it) => it.str.includes("Inertial Impactor"))) return "";

    // The row label ("Total") and its own values sit a point or two apart
    // in practice, not exactly the same y — same small tolerance used
    // throughout this function for matching a label to its row.
    const totalLabel = items.find((it) => it.str.trim() === "Total" && it.x < 150);
    if (!totalLabel) return "";
    const totalRowItems = items
      .filter((it) => Math.abs(it.y - totalLabel.y) <= 3 && it !== totalLabel)
      .sort((a, b) => a.x - b.x);
    // The Total row is the one row guaranteed complete — every column
    // present in a row always contributes its whole count/struct/% triple
    // together, never a stray partial one (confirmed against two real
    // reports), so simple left-to-right groups of 3 are exactly the
    // columns, with no gap-width guessing needed. Each group's own shape
    // (two numbers then a percent) is checked too — if this row doesn't
    // resolve cleanly, this page's table isn't in a shape trustworthy
    // enough to anchor columns from at all.
    const totalGroups = chunkTriplets(totalRowItems);
    if (!totalGroups) return "";
    const columnAnchors = totalGroups.map((g) => g[0].x);
    const columnCount = columnAnchors.length;

    const valuesByTaxon = new Map<string, Map<number, SporeTrapCellValue>>();
    for (const taxon of sortedTaxa) {
      const taxonLabelItem = items.find((it) => it.str.trim() === taxon);
      if (!taxonLabelItem) continue;
      const rowItems = items
        .filter((it) => Math.abs(it.y - taxonLabelItem.y) <= 3 && it !== taxonLabelItem)
        .sort((a, b) => a.x - b.x);
      const rowGroups = chunkTriplets(rowItems);
      if (!rowGroups) continue;
      const columnValues = new Map<number, SporeTrapCellValue>();
      for (const g of rowGroups) {
        const count = Number(g[0].str.replace(/,/g, ""));
        const structPerM3 = Number(g[1].str.replace(/,/g, ""));
        const pct = Number(g[2].str.replace(/%/g, ""));
        // Nearest anchor, but only if actually close to it — a group that
        // doesn't land near any real column isn't trustworthy to place.
        let nearestIndex = -1;
        let nearestDist = Infinity;
        columnAnchors.forEach((anchorX, i) => {
          const dist = Math.abs(g[0].x - anchorX);
          if (dist < nearestDist) { nearestDist = dist; nearestIndex = i; }
        });
        if (nearestIndex >= 0 && nearestDist <= 30) {
          columnValues.set(nearestIndex, { count, structPerM3, pct });
        }
      }
      if (columnValues.size > 0) valuesByTaxon.set(taxon, columnValues);
    }

    pages.push({ columnCount, valuesByTaxon });
    return "";
  }

  await pdfParse(pdfBuffer, { pagerender: renderPage });
  return pages;
}

// A row's items, already sorted left to right, split into consecutive
// groups of 3 (count, struct/m³, %) — every column present in a row
// contributes exactly these 3 together (see extractSporeTrapTaxonColumns'
// own comment), so position alone (not x-gap width, which isn't reliably
// different between columns and within one) is enough to chunk them.
// Verifies each group's own shape (two numbers then a percent) rather
// than just trusting position, and returns null — not a partial result —
// the moment anything doesn't fit, so a genuinely unexpected row is
// skipped rather than guessed at.
function chunkTriplets(items: PositionedItem[]): PositionedItem[][] | null {
  if (items.length === 0 || items.length % 3 !== 0) return null;
  const groups: PositionedItem[][] = [];
  for (let i = 0; i < items.length; i += 3) {
    const group = items.slice(i, i + 3);
    const [count, structPerM3, pct] = group;
    if (!/^[\d,]+$/.test(count.str.trim())) return null;
    if (!/^[\d,]+$/.test(structPerM3.str.trim())) return null;
    if (!/^[\d.]+%$/.test(pct.str.trim())) return null;
    groups.push(group);
  }
  return groups;
}
