import { useQuery, useQueryClient } from '@tanstack/react-query';
import { sapi, qs } from '../../lib/api';
import { useBranchId } from '../../lib/auth';
import { useRealtime } from '../../lib/socket';
import { Badge, Card, Loading, PageHeader } from '../../components/ui';

/** Live park map: zones coloured by crowd level (Green = Normal, Yellow = Busy, Red = Crowded) with ride status & queues. */
export function LiveMap() {
  const branchId = useBranchId();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['occ', branchId], queryFn: () => sapi.get(`/api/occupancy${qs({ branchId })}`), enabled: !!branchId, refetchInterval: 30_000 });
  useRealtime([branchId ? `branch:${branchId}` : null], { 'occupancy.changed': () => qc.invalidateQueries({ queryKey: ['occ', branchId] }), 'ride.status': () => qc.invalidateQueries({ queryKey: ['occ', branchId] }), 'dashboard.changed': () => qc.invalidateQueries({ queryKey: ['occ', branchId] }) });
  if (!q.data) return <Loading />;
  const color = (lv: string) => (lv === 'CROWDED' ? '#ef4444' : lv === 'BUSY' ? '#f59e0b' : '#22c55e');
  return (
    <div className="space-y-4">
      <PageHeader title="Live Park Map" subtitle={`${q.data.inside} / ${q.data.capacity} guests inside (${q.data.percent}%)`} actions={<div className="flex gap-2 text-xs"><Badge tone="green">Normal</Badge><Badge tone="amber">Busy</Badge><Badge tone="red">Crowded</Badge></div>} />
      <Card padded={false}>
        <div className="relative aspect-[16/10] w-full overflow-hidden rounded-xl bg-gradient-to-br from-emerald-50 to-sky-50">
          {q.data.zones.map((z: any) => (
            <div key={z.id} className="absolute flex flex-col rounded-2xl border-4 p-2 shadow-sm transition" style={{ left: `${z.map_x}%`, top: `${z.map_y}%`, width: `${z.map_w}%`, height: `${z.map_h}%`, borderColor: color(z.level), background: `${color(z.level)}22` }}>
              <div className="flex items-center justify-between"><div className="text-sm font-black md:text-base">{z.name}</div><Badge tone={z.level === 'CROWDED' ? 'red' : z.level === 'BUSY' ? 'amber' : 'green'}>{z.percent}%</Badge></div>
              <div className="text-xs text-slate-600">{z.inside} / {z.capacity} guests</div>
              <div className="mt-1 flex flex-wrap gap-1 overflow-hidden">
                {(z.rides ?? []).map((r: any) => <span key={r.id} className={`rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${r.status === 'OPEN' ? 'bg-white/80 text-slate-700' : 'bg-rose-500 text-white'}`}>{r.name.split(' ').slice(-2).join(' ')}{r.status === 'OPEN' ? ` · Q${r.queue}` : ` · ${r.status}`}</span>)}
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
