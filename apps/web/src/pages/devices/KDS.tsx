import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChefHat, Clock } from 'lucide-react';
import { sapi, errorMessage, ApiError } from '../../lib/api';
import { useRealtime } from '../../lib/socket';
import { offlineQueue, useOnline } from '../../lib/offline';
import { useSurfaceFont } from '../../lib/config';
import { cx, toast } from '../../components/ui';
import { OfflineBanner } from '../../components/OfflineBanner';
import { DeviceGuard } from './DeviceShell';

export function KDS() { return <DeviceGuard need="KITCHEN_DISPLAY"><Inner /></DeviceGuard>; }

const COLS = [
  { status: 'NEW', label: 'NEW', next: 'PREPARING', color: 'border-sky-500', btn: 'bg-sky-600' },
  { status: 'PREPARING', label: 'PREPARING', next: 'READY', color: 'border-amber-500', btn: 'bg-amber-500' },
  { status: 'READY', label: 'READY', next: 'COMPLETED', color: 'border-emerald-500', btn: 'bg-emerald-600' },
];

function Inner() {
  useSurfaceFont('pos');
  const { storeId } = useParams();
  const qc = useQueryClient();
  const online = useOnline();
  const q = useQuery({ queryKey: ['kds', storeId], queryFn: () => sapi.get(`/api/kitchen/${storeId}/orders`), refetchInterval: 30_000 });
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const i = setInterval(() => setNow(Date.now()), 10_000); return () => clearInterval(i); }, []);
  useRealtime([storeId ? `kds:${storeId}` : null], {
    'kitchen.order': (e) => { qc.invalidateQueries({ queryKey: ['kds', storeId] }); if (e.status === 'NEW') { toast.info(`New order ${e.queueNo}`); try { new Audio('data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=').play(); } catch { /* */ } } },
  });
  const move = async (o: any, status: string) => {
    try { await sapi.post(`/api/kitchen/orders/${o.id}/status`, { status }); qc.invalidateQueries({ queryKey: ['kds', storeId] }); }
    catch (e) {
      if (e instanceof ApiError && e.status === 0) { offlineQueue.add('kds.status', { orderId: o.id, status }, `KDS ${o.queue_no} → ${status}`); toast.warning('Offline — status queued'); }
      else toast.error(errorMessage(e));
    }
  };
  const orders = q.data ?? [];
  return (
    <div className="flex h-full flex-col bg-slate-900 text-white">
      <OfflineBanner />
      <div className="flex items-center justify-between px-5 py-3"><div className="flex items-center gap-2 text-2xl font-black"><ChefHat />Kitchen Display</div><div className={online ? 'text-emerald-400' : 'text-rose-400'}>{online ? '● LIVE' : '● OFFLINE'}</div></div>
      <div className="grid flex-1 grid-cols-1 gap-3 overflow-hidden p-3 md:grid-cols-3">
        {COLS.map((c) => (
          <div key={c.status} className="flex min-h-0 flex-col rounded-2xl bg-slate-800">
            <div className="px-4 py-2 text-lg font-bold">{c.label} <span className="text-white/50">({orders.filter((o: any) => o.kitchen_status === c.status).length})</span></div>
            <div className="flex-1 space-y-3 overflow-y-auto p-3">
              {orders.filter((o: any) => o.kitchen_status === c.status).map((o: any) => {
                const mins = Math.floor((now - new Date(o.created_at).getTime()) / 60000);
                return (
                  <div key={o.id} className={cx('rounded-xl border-l-8 bg-white p-3 text-slate-900', c.color)}>
                    <div className="flex items-center justify-between"><div className="text-3xl font-black">{o.queue_no}</div>
                      <div className={cx('flex items-center gap-1 text-sm font-semibold', mins >= 15 ? 'text-rose-600' : 'text-slate-500')}><Clock className="h-4 w-4" />{mins}m</div></div>
                    <div className="text-xs text-slate-500">{o.order_no} · {o.channel}</div>
                    <ul className="mt-2 space-y-1">{o.items?.map((i: any) => (
                      <li key={i.id}><b className="text-lg">{i.qty}×</b> {i.name}
                        {i.modifiers?.map((m: any, k: number) => <div key={k} className="pl-6 text-sm text-amber-700">+ {m.option}</div>)}
                        {i.notes && <div className="pl-6 text-sm italic text-rose-600">“{i.notes}”</div>}</li>
                    ))}</ul>
                    {o.notes && <div className="mt-1 text-sm italic text-slate-600">{o.notes}</div>}
                    <button onClick={() => move(o, c.next)} className={cx('mt-3 w-full rounded-lg py-3 text-lg font-bold text-white', c.btn)}>{c.next === 'COMPLETED' ? 'PICKED UP' : `→ ${c.next}`}</button>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
