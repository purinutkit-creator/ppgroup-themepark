import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { sapi, qs } from '../../lib/api';
import { useBranchId } from '../../lib/auth';
import { useRealtime } from '../../lib/socket';
import { Badge, Card, Loading, PageHeader, Select, Table } from '../../components/ui';

export function RideDashboard() {
  const branchId = useBranchId();
  const qc = useQueryClient();
  const [sort, setSort] = useState('queue');
  const q = useQuery({ queryKey: ['rides', branchId], queryFn: () => sapi.get(`/api/rides${qs({ branchId })}`), enabled: !!branchId, refetchInterval: 30_000 });
  useRealtime([branchId ? `branch:${branchId}` : null], { 'ride.status': () => qc.invalidateQueries({ queryKey: ['rides', branchId] }), 'dashboard.changed': () => qc.invalidateQueries({ queryKey: ['rides', branchId] }) });
  if (!q.data) return <Loading />;
  const rows = [...q.data].sort((a: any, b: any) => sort === 'queue' ? b.queue_guests - a.queue_guests : sort === 'popular' ? b.guests_today - a.guests_today
    : sort === 'closed' ? Number(a.status === 'OPEN') - Number(b.status === 'OPEN') : Number(b.status === 'MAINTENANCE') - Number(a.status === 'MAINTENANCE'));
  return (
    <div className="space-y-4">
      <PageHeader title="Ride Dashboard" actions={<Select value={sort} onChange={(e) => setSort(e.target.value)} className="w-auto">
        <option value="queue">Longest queue</option><option value="popular">Most popular</option><option value="closed">Closed first</option><option value="maint">Maintenance first</option></Select>} />
      <Card padded={false}>
        <Table rows={rows} columns={[
          { key: 'name', header: 'Ride', render: (r: any) => <Link className="font-semibold text-brand-700" to={`/staff/rides/${r.id}`}>{r.name}</Link> }, { key: 'zone_name', header: 'Zone' },
          { key: 'status', header: 'Status', render: (r: any) => <span className="flex gap-1"><Badge>{r.status}</Badge>{r.entry_paused && <Badge tone="amber">PAUSED</Badge>}</span> },
          { key: 'queue_guests', header: 'Current queue', align: 'right' }, { key: 'wait_min', header: 'Wait (min)', align: 'right' }, { key: 'guests_today', header: 'Guests today', align: 'right' },
          { key: 'operator_name', header: 'Operator' }, { key: 'links', header: '', render: (r: any) => <Link className="text-xs text-slate-500 hover:text-brand-600" to={`/ride/${r.id}/scanner`} target="_blank">scanner ↗</Link> }]} />
      </Card>
    </div>
  );
}
