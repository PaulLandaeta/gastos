import { z } from 'zod';

/** FR-001/FR-002: accepted receipt types and limits (checked before anything is stored). */
export const ATTACHMENT_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf'] as const;
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const MAX_PDF_PAGES = 10;
export const MAX_FILES_PER_UPLOAD = 10;
export const MAX_ATTACHMENTS_PER_TARGET = 20;
/** Signed download links live 15 minutes (FR-004). */
export const DOWNLOAD_URL_TTL_SECONDS = 900;
/** Pending uploads never linked are cleaned up after 24 h (FR-023). */
export const PENDING_UPLOAD_TTL_MS = 24 * 60 * 60 * 1000;

const Sha256 = z.string().regex(/^[0-9a-f]{64}$/, 'Expected a lowercase hex SHA-256');
const Id = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);

/** Structure only: type/size/pages violations are reported as ATTACHMENT_INVALID by the API. */
export const UploadFileInput = z.object({
  fileName: z.string().trim().min(1).max(200),
  mimeType: z.string().min(1).max(100),
  bytes: z.number().int().min(0),
  pages: z.number().int().min(0),
  sha256: Sha256,
});
export type UploadFileInput = z.infer<typeof UploadFileInput>;

export const UploadTarget = z.union([z.object({ expenseId: Id }).strict(), z.object({ settlementId: Id }).strict()]);
export type UploadTarget = z.infer<typeof UploadTarget>;

export const CreateUploadsBody = z.object({
  files: z.array(UploadFileInput).min(1).max(MAX_FILES_PER_UPLOAD),
  target: UploadTarget.optional(),
});
export type CreateUploadsBody = z.input<typeof CreateUploadsBody>;

export const CreateUploadsResponse = z.object({
  uploads: z.array(
    z.object({ id: z.string(), uploadUrl: z.string(), headers: z.record(z.string(), z.string()), expiresAt: z.string() }),
  ),
});

export const LinkUploadsBody = z.object({ uploadIds: z.array(Id).min(1).max(MAX_FILES_PER_UPLOAD) });
export type LinkUploadsBody = z.input<typeof LinkUploadsBody>;

export const AttachmentStatus = z.enum(['active', 'removing', 'removed', 'deleted']);

export const Attachment = z.object({
  id: z.string(),
  fileName: z.string(),
  mimeType: z.string(),
  bytes: z.number().int(),
  pages: z.number().int(),
  sha256: z.string(),
  uploadedBy: z.string(),
  uploadedAt: z.string(),
  expiresAt: z.string(),
  status: AttachmentStatus,
  source: z.enum(['manual', 'scan']),
  deletedAt: z.string().nullable(),
});
export type Attachment = z.infer<typeof Attachment>;

export const AttachmentUrlResponse = z.object({ url: z.string(), expiresAt: z.string() });
