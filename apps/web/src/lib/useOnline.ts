import { useSyncExternalStore } from 'react';

/**
 * Connection state (feature 005): the browser's `navigator.onLine` plus failures seen by the API
 * client, because `onLine` stays true on captive portals or when the server is unreachable.
 * While a failure is reported, a light health probe clears it as soon as the API answers again.
 */
let networkFailed = false;
let probe: ReturnType<typeof setInterval> | null = null;
const listeners = new Set<() => void>();
const PROBE_MS = 15_000;

const browserOnline = () => typeof navigator === 'undefined' || navigator.onLine;

export function isOnline(): boolean {
  return browserOnline() && !networkFailed;
}

function emit(): void {
  for (const l of [...listeners]) l();
}

function stopProbe(): void {
  if (probe) clearInterval(probe);
  probe = null;
}

export function reportNetworkFailure(): void {
  if (networkFailed) return;
  networkFailed = true;
  emit();
  if (typeof window === 'undefined' || probe) return;
  probe = setInterval(() => {
    if (!browserOnline()) return;
    fetch(`${import.meta.env.VITE_API_URL}/health`, { cache: 'no-store' })
      .then((r) => r.ok && reportNetworkSuccess())
      .catch(() => undefined);
  }, PROBE_MS);
}

const LAST_ONLINE_KEY = 'lastOnlineAt';

function markOnline(): void {
  try {
    localStorage.setItem(LAST_ONLINE_KEY, String(Date.now()));
  } catch {
    // storage unavailable: the status bar just omits the date
  }
}

/** Last time the server answered (shown offline as «datos del …», FR-002). */
export function lastOnlineAt(): Date | null {
  try {
    const v = localStorage.getItem(LAST_ONLINE_KEY);
    return v ? new Date(Number(v)) : null;
  } catch {
    return null;
  }
}

export function reportNetworkSuccess(): void {
  markOnline();
  stopProbe();
  if (!networkFailed) return;
  networkFailed = false;
  emit();
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    networkFailed = false;
    stopProbe();
    emit();
  });
  window.addEventListener('offline', emit);
}

export function subscribeOnline(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Calls `cb` every time the app goes from offline to online. */
export function onReconnect(cb: () => void): () => void {
  let last = isOnline();
  return subscribeOnline(() => {
    const now = isOnline();
    if (now && !last) cb();
    last = now;
  });
}

export function useOnline(): boolean {
  return useSyncExternalStore(subscribeOnline, isOnline, () => true);
}
