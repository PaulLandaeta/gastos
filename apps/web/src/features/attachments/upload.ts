import { ATTACHMENT_MIME_TYPES } from 'contracts';
import { ApiError, api } from '../../lib/apiClient';
import { prepareFile } from './files';

export { pdfPageCount, prepareFile, sha256Hex } from './files';

export type UploadTarget = { expenseId: string } | { settlementId: string };

/** Accept attribute for the file pickers (FR-001). */
export const ACCEPT = ATTACHMENT_MIME_TYPES.join(',');

interface CreatedUpload {
  id: string;
  uploadUrl: string;
  headers: Record<string, string>;
}

/**
 * Registers the uploads and PUTs each file straight to storage with its signed URL (the API never
 * receives file bytes). Returns the upload ids in the same order as `files`.
 */
export async function uploadFiles(
  tripId: string,
  files: File[],
  target?: UploadTarget,
  onProgress?: (done: number, total: number) => void,
): Promise<string[]> {
  const prepared = await Promise.all(files.map(prepareFile));
  const { uploads } = await api<{ uploads: CreatedUpload[] }>('POST', `/trips/${tripId}/uploads`, {
    body: {
      files: prepared.map(({ fileName, mimeType, bytes, pages, sha256 }) => ({ fileName, mimeType, bytes, pages, sha256 })),
      ...(target ? { target } : {}),
    },
  });
  let done = 0;
  onProgress?.(0, uploads.length);
  await Promise.all(
    uploads.map(async (u, i) => {
      let res: Response;
      try {
        res = await fetch(u.uploadUrl, { method: 'PUT', headers: u.headers, body: prepared[i]!.file });
      } catch {
        throw new ApiError('NETWORK', 0, 'No se pudo subir el archivo');
      }
      if (!res.ok) throw new ApiError('ATTACHMENT_INVALID', res.status, 'Upload rejected by storage');
      onProgress?.(++done, uploads.length);
    }),
  );
  return uploads.map((u) => u.id);
}

/** Uploads and links files to an existing expense or payment. */
export async function attachFiles(tripId: string, files: File[], target: UploadTarget, onProgress?: (done: number, total: number) => void) {
  const uploadIds = await uploadFiles(tripId, files, target, onProgress);
  const path = 'expenseId' in target ? `expenses/${target.expenseId}` : `settlements/${target.settlementId}`;
  return api<{ attachments: unknown[] }>('POST', `/trips/${tripId}/${path}/attachments`, { body: { uploadIds } });
}
