import { PDFDocument } from "pdf-lib";

/** Merges PDF buffers into one, in order, skipping any that fail to parse (e.g. a corrupt upload). */
export async function mergePdfBuffers(buffers: Buffer[]): Promise<Buffer> {
  const merged = await PDFDocument.create();
  for (const buffer of buffers) {
    try {
      const src = await PDFDocument.load(buffer);
      const pages = await merged.copyPages(src, src.getPageIndices());
      pages.forEach((page) => merged.addPage(page));
    } catch (err) {
      console.error("Skipping unmergeable PDF in report packet:", err);
    }
  }
  return Buffer.from(await merged.save());
}
