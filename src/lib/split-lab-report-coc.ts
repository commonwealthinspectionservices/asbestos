// Imports the implementation directly rather than the package root — see
// src/app/api/admin/jobs/[id]/documents/route.ts for why.
import pdfParse from "pdf-parse/lib/pdf-parse.js";
// pdf-lib is imported dynamically below, not statically here, and only
// after pdf-parse is done — see the comment at the top of lab-email.ts for
// why: statically co-importing pdf-parse with another PDF library in the
// same module corrupts state pdf-parse's bundled legacy pdf.js depends on,
// even though nothing here calls pdf-lib until after parsing finishes.

// A page with fewer than this many characters of extractable text is
// treated as a scan, not a typed page — real Crystal Analytical data pages
// run 900-2200+ characters; a genuinely blank/scanned page extracts to 0.
// Left with headroom in case a scan carries a stray watermark/footer.
const SCANNED_PAGE_TEXT_THRESHOLD = 20;

async function pageTextLengths(pdfBuffer: Buffer): Promise<number[]> {
  const lengths: number[] = [];
  await pdfParse(pdfBuffer, {
    pagerender: async (pageData: { getTextContent: () => Promise<{ items: { str: string }[] }> }) => {
      const content = await pageData.getTextContent();
      const text = content.items.map((i) => i.str).join(" ");
      lengths.push(text.trim().length);
      return text;
    },
  });
  return lengths;
}

/**
 * Crystal Analytical (and similarly-shaped labs) email back a single PDF
 * with typed analytical data pages followed by the scanned, handwritten
 * chain-of-custody form as the last page(s) — never a separate attachment.
 * Confirmed across 5 real reports: every one has 0 extractable characters
 * on its trailing COC page(s) and 900+ on every data page before them, so
 * that's used as the split point rather than a fixed page count (a bigger
 * job's handwritten form can span more than one page). Splits from the end
 * inward, stopping at the first page with real text. Returns the original
 * buffer as reportBuffer with cocBuffer null when no scanned trailing page
 * is found (e.g. EMSL's report PDFs, which never bundle a COC at all).
 *
 * No unit test file: this project's bundled pdf-parse (ancient pdf.js
 * v1.10.100) can't read pdf-lib's own compressed output at all — confirmed
 * in isolation, unrelated to the co-import issue above — so a pdf-lib-built
 * synthetic fixture can't stand in for a real report here. Validated
 * instead against 5 real Crystal Analytical PDFs (manually, not committed —
 * real client documents), each one splitting at exactly its scanned page.
 */
export async function splitTrailingCocPages(pdfBuffer: Buffer): Promise<{ reportBuffer: Buffer; cocBuffer: Buffer | null }> {
  const lengths = await pageTextLengths(pdfBuffer);

  let cocPageCount = 0;
  for (let i = lengths.length - 1; i >= 0; i--) {
    if (lengths[i] >= SCANNED_PAGE_TEXT_THRESHOLD) break;
    cocPageCount++;
  }

  // No trailing scanned page, or the whole document is blank (shouldn't
  // happen for a real report) — nothing to split out.
  if (cocPageCount === 0 || cocPageCount >= lengths.length) {
    return { reportBuffer: pdfBuffer, cocBuffer: null };
  }

  const { PDFDocument } = await import("pdf-lib");
  const src = await PDFDocument.load(pdfBuffer);
  const reportPageCount = lengths.length - cocPageCount;

  const reportDoc = await PDFDocument.create();
  const reportPages = await reportDoc.copyPages(src, src.getPageIndices().slice(0, reportPageCount));
  reportPages.forEach((p) => reportDoc.addPage(p));

  const cocDoc = await PDFDocument.create();
  const cocPages = await cocDoc.copyPages(src, src.getPageIndices().slice(reportPageCount));
  cocPages.forEach((p) => cocDoc.addPage(p));

  return {
    reportBuffer: Buffer.from(await reportDoc.save()),
    cocBuffer: Buffer.from(await cocDoc.save()),
  };
}
