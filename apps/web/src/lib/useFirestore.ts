import { collection, doc, onSnapshot, type DocumentData } from 'firebase/firestore';
import { useEffect, useState } from 'react';
import { db } from './firebase';

export interface LiveResult<T> {
  data: T | undefined;
  error: Error | null;
  loading: boolean;
  /** Feature 005: data served from the offline cache (not confirmed by the server yet). */
  fromCache: boolean;
}

function convert(data: DocumentData): DocumentData {
  const out: DocumentData = {};
  for (const [k, v] of Object.entries(data)) {
    out[k] = v && typeof v === 'object' && 'toDate' in v && typeof v.toDate === 'function' ? v.toDate() : v;
  }
  return out;
}

/** Live document (Security Rules apply). `null` data means the document does not exist. */
export function useDoc<T>(path: string | null): LiveResult<(T & { id: string }) | null> {
  const [state, setState] = useState<LiveResult<(T & { id: string }) | null>>({ data: undefined, error: null, loading: true, fromCache: false });
  useEffect(() => {
    if (!path) return;
    setState({ data: undefined, error: null, loading: true, fromCache: false });
    return onSnapshot(
      doc(db, path),
      { includeMetadataChanges: true },
      (snap) =>
        setState({
          data: snap.exists() ? ({ id: snap.id, ...convert(snap.data()) } as T & { id: string }) : null,
          error: null,
          loading: false,
          fromCache: snap.metadata.fromCache,
        }),
      (error) => setState({ data: undefined, error, loading: false, fromCache: false }),
    );
  }, [path]);
  return state;
}

/** Live collection (Security Rules apply). */
export function useCollection<T>(path: string | null): LiveResult<(T & { id: string })[]> {
  const [state, setState] = useState<LiveResult<(T & { id: string })[]>>({ data: undefined, error: null, loading: true, fromCache: false });
  useEffect(() => {
    if (!path) return;
    setState({ data: undefined, error: null, loading: true, fromCache: false });
    return onSnapshot(
      collection(db, path),
      { includeMetadataChanges: true },
      (snap) =>
        setState({
          data: snap.docs.map((d) => ({ id: d.id, ...convert(d.data()) }) as T & { id: string }),
          error: null,
          loading: false,
          fromCache: snap.metadata.fromCache,
        }),
      (error) => setState({ data: undefined, error, loading: false, fromCache: false }),
    );
  }, [path]);
  return state;
}
