import convert from "heic-convert";

// Per Tim, 2026-09-04 — iPhone photos upload as .HEIC by default, which no
// browser <img> tag can decode (and which @react-pdf/renderer can't embed
// either, despite src/lib/report-pdf.tsx's moistureMappingPhotoFormat
// assuming this conversion already happened). Converting once here, at
// upload time, is what makes every downstream consumer — the room-photo
// list's thumbnails, the lightbox, and the Moisture Mapping PDF — just
// work without each having to know about HEIC.
const HEIC_EXTENSION = /\.(heic|heif)$/i;

export async function normalizePhotoUpload(
  fileName: string,
  buffer: Buffer,
  contentType: string
): Promise<{ fileName: string; buffer: Buffer; contentType: string }> {
  const isHeic = HEIC_EXTENSION.test(fileName) || contentType === "image/heic" || contentType === "image/heif";
  if (!isHeic) return { fileName, buffer, contentType };

  const converted = await convert({ buffer, format: "JPEG", quality: 0.9 });
  return {
    fileName: fileName.replace(HEIC_EXTENSION, ".jpg"),
    buffer: Buffer.from(converted),
    contentType: "image/jpeg",
  };
}
