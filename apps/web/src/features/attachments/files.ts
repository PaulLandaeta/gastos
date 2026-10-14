import { MAX_PDF_PAGES } from 'contracts';

/** Pure file helpers (no Firebase): hashing, PDF page count and photo compression. */

/** Only large photos are recompressed: small files stay byte-identical (duplicate detection). */
const COMPRESS_ABOVE_BYTES = 1.5 * 1024 * 1024;
const MAX_SIDE = 2000;

export async function sha256Hex(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Counts PDF pages without a PDF library: page objects (`/Type /Page`) or, for files with
 * compressed object streams, the largest `/Count` of the page tree. Falls back to 1.
 */
export function pdfPageCountFromText(text: string): number {
  const pages = text.match(/\/Type\s*\/Page(?![a-zA-Z])/g)?.length ?? 0;
  if (pages > 0) return pages;
  const counts = [...text.matchAll(/\/Count\s+(\d+)/g)].map((m) => Number(m[1]));
  return counts.length ? Math.max(...counts) : 1;
}

export async function pdfPageCount(file: Blob): Promise<number> {
  return pdfPageCountFromText(new TextDecoder('latin1').decode(await file.arrayBuffer()));
}

/** Downscales big JPEG/PNG/WebP photos to JPEG (canvas); keeps the original if not smaller. */
export async function compressImage(file: File): Promise<File> {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size <= COMPRESS_ABOVE_BYTES) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = new OffscreenCanvas(Math.round(bitmap.width * scale), Math.round(bitmap.height * scale));
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.82 });
    if (blob.size >= file.size) return file;
    return new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' });
  } catch {
    return file;
  }
}

export interface PreparedFile {
  file: File;
  fileName: string;
  mimeType: string;
  bytes: number;
  pages: number;
  sha256: string;
}

export async function prepareFile(original: File): Promise<PreparedFile> {
  const file = await compressImage(original);
  const mimeType = file.type || (file.name.toLowerCase().endsWith('.pdf') ? 'application/pdf' : '');
  const pages = mimeType === 'application/pdf' ? Math.min(await pdfPageCount(file), MAX_PDF_PAGES + 1) : 1;
  return { file, fileName: file.name, mimeType, bytes: file.size, pages, sha256: await sha256Hex(file) };
}
