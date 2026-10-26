/** Shared declarative format policy, never URL or filesystem authority. */
export const NOTEBOOK_IMAGE_MAX_BYTES = 8 * 1024 * 1024;
export const NOTEBOOK_PDF_MAX_BYTES = 16 * 1024 * 1024;
export function notebookAssetMime(path: string): string | null {
  const extension = path.split(".").at(-1)?.toLowerCase();
  return ({ png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", pdf: "application/pdf" } as Record<string, string>)[extension ?? ""] ?? null;
}
export function isNotebookAssetPath(path: string): boolean {
  return /\.(?:md|txt|json|csv|tsv|mmd|png|jpe?g|gif|webp|pdf)$/i.test(path);
}
export function notebookAssetLimit(mime: string): number {
  return mime === "application/pdf" ? NOTEBOOK_PDF_MAX_BYTES : NOTEBOOK_IMAGE_MAX_BYTES;
}
/** Format signatures are admission checks, not a claim to fully validate/decode a document. */
export function notebookAssetHasSignature(bytes: Uint8Array, mime: string): boolean {
  const ascii = (offset: number, text: string) => [...text].every((char, i) => bytes[offset + i] === char.charCodeAt(0));
  if (mime === "image/png") return bytes.length >= 24 && [137, 80, 78, 71, 13, 10, 26, 10].every((b, i) => bytes[i] === b) && ascii(12, "IHDR");
  if (mime === "image/jpeg") return bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 && bytes[3] !== 0;
  if (mime === "image/gif") return bytes.length >= 13 && (ascii(0, "GIF87a") || ascii(0, "GIF89a"));
  if (mime === "image/webp") return bytes.length >= 16 && ascii(0, "RIFF") && ascii(8, "WEBP") && (ascii(12, "VP8 ") || ascii(12, "VP8L") || ascii(12, "VP8X"));
  if (mime === "application/pdf") return bytes.length >= 8 && ascii(0, "%PDF-") && bytes[5] >= 49 && bytes[5] <= 50 && bytes[6] === 46 && bytes[7] >= 48 && bytes[7] <= 57;
  return false;
}
