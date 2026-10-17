import { CameraIcon, PaperclipIcon } from '@phosphor-icons/react';
import { ATTACHMENT_MIME_TYPES, MAX_ATTACHMENT_BYTES } from 'contracts';
import { useId, useState, type ChangeEvent } from 'react';
import { ErrorMessage } from '../../components/ErrorMessage';
import { ACCEPT, attachFiles, uploadFiles, type UploadTarget } from './upload';

export interface UploadedFile {
  id: string;
  name: string;
}

interface Props {
  tripId: string;
  /** Existing expense or payment: files are uploaded and linked right away. */
  target?: UploadTarget;
  /** New expense: files are uploaded and their ids handed back to link on save. */
  onUploaded?: (files: UploadedFile[]) => void;
  onAttached?: () => void;
  disabled?: boolean;
}

/** Client-side precheck (the API validates again): type and size (FR-002). */
export function localProblem(files: File[]): string | null {
  for (const f of files) {
    if (!(ATTACHMENT_MIME_TYPES as readonly string[]).includes(f.type)) return `«${f.name}»: tipo no permitido (fotos JPEG, PNG, WebP, HEIC o PDF).`;
    if (f.size > MAX_ATTACHMENT_BYTES) return `«${f.name}» supera los 10 MB.`;
  }
  return null;
}

/** FR-001: pick several photos/PDFs or take a photo with the camera (no special permissions). */
export function AttachmentPicker({ tripId, target, onUploaded, onAttached, disabled }: Props) {
  const id = useId();
  const [progress, setProgress] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);

  async function handle(e: ChangeEvent<HTMLInputElement>) {
    const files = [...(e.target.files ?? [])];
    e.target.value = '';
    if (files.length === 0) return;
    setError(null);
    setProblem(localProblem(files));
    if (localProblem(files)) return;
    setProgress(`Subiendo 0 de ${files.length}…`);
    const onProgress = (done: number, total: number) => setProgress(`Subiendo ${done} de ${total}…`);
    try {
      if (target) {
        await attachFiles(tripId, files, target, onProgress);
        onAttached?.();
      } else {
        const ids = await uploadFiles(tripId, files, undefined, onProgress);
        onUploaded?.(ids.map((uid, i) => ({ id: uid, name: files[i]!.name })));
      }
    } catch (err) {
      setError(err);
    } finally {
      setProgress(null);
    }
  }

  const busy = disabled || progress !== null;
  const button = 'inline-flex cursor-pointer items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold hover:bg-slate-50';
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <label htmlFor={`${id}-files`} className={`${button} ${busy ? 'pointer-events-none opacity-60' : ''}`}>
          <PaperclipIcon />
          Adjuntar archivos
        </label>
        <input id={`${id}-files`} type="file" multiple accept={ACCEPT} className="sr-only" disabled={busy} onChange={handle} data-testid="attachment-input" />
        <label htmlFor={`${id}-camera`} className={`${button} ${busy ? 'pointer-events-none opacity-60' : ''}`}>
          <CameraIcon />
          Tomar foto
        </label>
        <input id={`${id}-camera`} type="file" accept="image/*" capture="environment" className="sr-only" disabled={busy} onChange={handle} />
      </div>
      {progress && (
        <p role="status" className="text-sm text-slate-700">
          {progress}
        </p>
      )}
      {problem && (
        <p role="alert" className="rounded-lg bg-red-50 p-2 text-sm text-red-800">
          {problem}
        </p>
      )}
      <ErrorMessage error={error} />
    </div>
  );
}
