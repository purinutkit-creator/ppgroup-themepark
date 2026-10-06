import { CloudOff, RefreshCw } from 'lucide-react';
import { useAutoSync } from '../lib/offline';
import { toast } from './ui';

export function OfflineBanner() {
  const { online, pending, syncing } = useAutoSync((r) => {
    if (r.ok) toast.success(`Synced ${r.ok} offline transaction(s)`);
    for (const f of r.failed) toast.error(`Offline item rejected: ${f.item.label} — ${f.error}`);
  });
  if (online && !pending) return null;
  return (
    <div className={`flex items-center justify-center gap-2 px-3 py-1.5 text-sm font-semibold ${online ? 'bg-amber-400 text-amber-950' : 'bg-rose-600 text-white'}`}>
      {online ? <RefreshCw className={`h-4 w-4 ${syncing ? 'animate-spin' : ''}`} /> : <CloudOff className="h-4 w-4" />}
      {online ? `Syncing ${pending} offline transaction(s)…` : `OFFLINE MODE — only safe actions are allowed${pending ? ` · ${pending} queued` : ''}`}
    </div>
  );
}
