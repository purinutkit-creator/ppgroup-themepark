import { useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { papi } from '../../lib/api';
import { useRealtime } from '../../lib/socket';
import { useSurfaceFont } from '../../lib/config';

/** Customer "order ready" queue display — queue numbers only. */
export function OrderBoard() {
  useSurfaceFont('kiosk');
  const { storeId } = useParams();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['board', storeId], queryFn: () => papi.get(`/api/public/kitchen/${storeId}/board`), refetchInterval: 15_000 });
  useRealtime([`kdsready:${storeId}`], { 'kitchen.order': () => qc.invalidateQueries({ queryKey: ['board', storeId] }) }, { ctx: 'public' });
  const preparing = (q.data ?? []).filter((o: any) => o.kitchen_status === 'PREPARING');
  const ready = (q.data ?? []).filter((o: any) => o.kitchen_status === 'READY');
  return (
    <div className="grid h-full grid-cols-2 bg-slate-950 text-white">
      <div className="border-r border-white/10 p-8"><div className="mb-6 text-4xl font-black text-amber-400">กำลังเตรียม · PREPARING</div>
        <div className="grid grid-cols-3 gap-4">{preparing.map((o: any) => <div key={o.queue_no} className="rounded-2xl bg-white/10 p-6 text-center text-5xl font-black">{o.queue_no}</div>)}</div></div>
      <div className="p-8"><div className="mb-6 text-4xl font-black text-emerald-400">พร้อมรับ · READY</div>
        <div className="grid grid-cols-2 gap-4">{ready.map((o: any) => <div key={o.queue_no} className="pop rounded-2xl bg-emerald-500 p-8 text-center text-7xl font-black">{o.queue_no}</div>)}</div></div>
    </div>
  );
}
