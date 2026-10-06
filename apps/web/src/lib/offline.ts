import { useEffect, useState, useSyncExternalStore } from 'react';
import { sapi, newKey } from './api';

/**
 * Offline handling: tracks connectivity (browser + API heartbeat) and keeps a local queue
 * of SAFE actions (allow-listed by the server's offline policy). Each queued action keeps
 * its idempotency key so replay through /api/sync/batch can never double-execute.
 */
export interface QueuedAction { idempotencyKey: string; action: string; payload: Record<string, unknown>; createdAt: string; label: string }
const KEY = 'tp.offlineQueue';
const listeners = new Set<() => void>();
let online = typeof navigator !== 'undefined' ? navigator.onLine : true;

function read(): QueuedAction[] { try { return JSON.parse(localStorage.getItem(KEY) ?? '[]'); } catch { return []; } }
function write(q: QueuedAction[]) { localStorage.setItem(KEY, JSON.stringify(q)); listeners.forEach((l) => l()); }
let cache = read();
const emit = () => { cache = read(); listeners.forEach((l) => l()); };

export const offlineQueue = {
  list: () => cache,
  add(action: string, payload: Record<string, unknown>, label: string) {
    const item: QueuedAction = { idempotencyKey: newKey(), action, payload, createdAt: new Date().toISOString(), label };
    write([...read(), item]);
    emit();
    return item;
  },
  async sync(): Promise<{ ok: number; failed: Array<{ item: QueuedAction; error: string }> }> {
    const q = read();
    if (!q.length) return { ok: 0, failed: [] };
    const res = await sapi.post<{ results: any[] }>('/api/sync/batch', { items: q.map(({ label, ...i }) => i) });
    const failed: Array<{ item: QueuedAction; error: string }> = [];
    let ok = 0;
    const remaining: QueuedAction[] = [];
    for (const r of res.results) {
      const item = q.find((i) => i.idempotencyKey === r.idempotencyKey)!;
      if (r.ok) ok++;
      else if (r.status >= 500 || r.status === 0) remaining.push(item);          // retry later
      else failed.push({ item, error: r.error?.message ?? 'Rejected' });          // permanent business rejection
    }
    write(remaining);
    emit();
    return { ok, failed };
  },
};

function subscribe(cb: () => void) { listeners.add(cb); return () => listeners.delete(cb); }
export function useOfflineQueue() { return useSyncExternalStore(subscribe, () => cache); }

function setOnline(v: boolean) { if (online !== v) { online = v; listeners.forEach((l) => l()); } }
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => setOnline(true));
  window.addEventListener('offline', () => setOnline(false));
  setInterval(async () => {
    try { const r = await fetch('/api/health', { cache: 'no-store' }); setOnline(r.ok); } catch { setOnline(false); }
  }, 10_000);
}
export function useOnline() { return useSyncExternalStore(subscribe, () => online); }

/** Auto-sync when connectivity returns */
export function useAutoSync(onResult?: (r: { ok: number; failed: any[] }) => void) {
  const isOnline = useOnline();
  const q = useOfflineQueue();
  const [syncing, setSyncing] = useState(false);
  useEffect(() => {
    if (!isOnline || !q.length || syncing) return;
    setSyncing(true);
    offlineQueue.sync().then((r) => onResult?.(r)).catch(() => {}).finally(() => setSyncing(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOnline, q.length]);
  return { syncing, pending: q.length, online: isOnline };
}
