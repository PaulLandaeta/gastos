import { useMutation, useQuery } from '@tanstack/react-query';
import { isExpiringSoon, type Attachment } from 'contracts';
import { ErrorMessage } from '../../components/ErrorMessage';
import { api } from '../../lib/apiClient';
import { AttachmentPicker } from './AttachmentPicker';
import type { UploadTarget } from './upload';

const formatExpiry = (iso: string) => new Intl.DateTimeFormat('es', { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(iso));
const formatSize = (bytes: number) => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

interface Props {
  tripId: string;
  target: UploadTarget;
  canAdd: boolean;
  canRemove: boolean;
  title?: string;
}

/**
 * Receipts of an expense or payment (FR-004/FR-005/FR-022). The list and every download link come
 * from the API after a permission check; links last 15 minutes and are never stored.
 */
export function AttachmentList({ tripId, target, canAdd, canRemove, title = 'Comprobantes' }: Props) {
  const base = 'expenseId' in target ? `/trips/${tripId}/expenses/${target.expenseId}` : `/trips/${tripId}/settlements/${target.settlementId}`;
  const list = useQuery({
    queryKey: ['attachments', base],
    queryFn: () => api<{ attachments: Attachment[] }>('GET', `${base}/attachments`),
  });
  const open = useMutation({
    mutationFn: async (id: string) => {
      // Open the tab synchronously (popup blockers), then point it at the signed URL.
      const tab = window.open('', '_blank');
      try {
        const { url } = await api<{ url: string }>('GET', `${base}/attachments/${id}/url`);
        if (tab) {
          tab.opener = null;
          tab.location.href = url;
        } else {
          window.location.assign(url);
        }
      } catch (e) {
        tab?.close();
        throw e;
      }
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => api('DELETE', `${base}/attachments/${id}`),
    onSuccess: () => void list.refetch(),
  });

  const items = (list.data?.attachments ?? []).filter((a) => a.status === 'active' || a.status === 'deleted');
  const now = new Date();
  return (
    <section aria-label={title} className="space-y-2">
      <h2 className="text-lg font-semibold">{title}</h2>
      {list.isLoading && <p className="text-sm text-slate-600">Cargando comprobantes…</p>}
      {list.data && items.length === 0 && <p className="text-sm text-slate-600">Sin comprobantes.</p>}
      <ul className="space-y-2">
        {items.map((a) =>
          a.status === 'deleted' ? (
            <li key={a.id} className="rounded-lg bg-slate-50 p-2 text-sm text-slate-700">
              {a.fileName}: comprobante eliminado por política de retención
            </li>
          ) : (
            <li key={a.id} className="space-y-1 rounded-lg border border-slate-200 p-2 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="min-w-0 break-all">
                  <span aria-hidden>{a.mimeType === 'application/pdf' ? '📄' : '🖼️'} </span>
                  {a.fileName}
                  <span className="text-slate-600">
                    {' '}
                    · {formatSize(a.bytes)}
                    {a.mimeType === 'application/pdf' ? ` · ${a.pages} pág.` : ''}
                    {a.source === 'scan' ? ' · escaneado' : ''}
                  </span>
                </span>
                <span className="flex gap-2">
                  <button type="button" onClick={() => open.mutate(a.id)} className="rounded-lg border border-slate-300 px-2 py-1">
                    Abrir <span className="sr-only">{a.fileName}</span>
                  </button>
                  {canRemove && (
                    <button
                      type="button"
                      disabled={remove.isPending}
                      onClick={() => remove.mutate(a.id)}
                      className="rounded-lg border border-red-300 px-2 py-1 text-red-800"
                    >
                      Quitar <span className="sr-only">{a.fileName}</span>
                    </button>
                  )}
                </span>
              </div>
              {isExpiringSoon(new Date(a.expiresAt), now) && (
                <p className="rounded bg-amber-50 px-2 py-1 text-amber-900">
                  ⚠️ Se eliminará el {formatExpiry(a.expiresAt)} por política de retención. Descárgalo si lo necesitas.
                </p>
              )}
            </li>
          ),
        )}
      </ul>
      <ErrorMessage error={list.error ?? open.error ?? remove.error} />
      {canAdd && <AttachmentPicker tripId={tripId} target={target} onAttached={() => void list.refetch()} />}
    </section>
  );
}
