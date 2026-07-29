import { describe, it, expect } from "vitest";
import { PDFDocument } from "pdf-lib";
import { mergePdfBuffers } from "@/lib/pdf-merge";

async function makeSinglePagePdf(): Promise<Buffer> {
  const doc = await PDFDocument.create();
  doc.addPage();
  return Buffer.from(await doc.save());
}

describe("mergePdfBuffers", () => {
  it("merges multiple PDFs into one with combined page count", async () => {
    const a = await makeSinglePagePdf();
    const b = await makeSinglePagePdf();
    const merged = await mergePdfBuffers([a, b]);
    const mergedDoc = await PDFDocument.load(merged);
    expect(mergedDoc.getPageCount()).toBe(2);
  });

  it("skips an unparseable buffer instead of throwing", async () => {
    const a = await makeSinglePagePdf();
    const garbage = Buffer.from("not a pdf");
    const merged = await mergePdfBuffers([a, garbage]);
    const mergedDoc = await PDFDocument.load(merged);
    expect(mergedDoc.getPageCount()).toBe(1);
  });
});
