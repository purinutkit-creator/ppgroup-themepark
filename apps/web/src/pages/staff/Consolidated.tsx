import { useQuery } from '@tanstack/react-query';
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { sapi } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useRealtime } from '../../lib/socket';
import { num, thb0 } from '../../lib/format';
import { Badge, Card, Loading, PageHeader, Stat, Table } from '../../components/ui';
import { useNavigate } from 'react-router-dom';

export function Consolidated() {
  const setBranch = useAuth((s) => s.setBranch);
  const nav = useNavigate();
  const q = useQuery({ queryKey: ['consolidated'], queryFn: () => sapi.get('/api/dashboard/consolidated'), refetchInterval: 60_000 });
  useRealtime(['owner'], { 'occupancy.changed': () => q.refetch(), 'dashboard.changed': () => q.refetch() });
  if (!q.data) return <Loading />;
  const t = q.data.totals;
  return (
    <div className="space-y-4">
      <PageHeader title="Consolidated Dashboard" subtitle={`All branches · ${q.data.date}`} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Visitors today" value={num(t.visitors)} tone="brand" /><Stat label="Inside now" value={num(t.inside)} tone="emerald" />
        <Stat label="Total revenue" value={thb0(t.revenue)} tone="emerald" /><Stat label="Wallet top-up" value={thb0(t.topup)} tone="sky" />
      </div>
      <Card title="Revenue by branch">
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={q.data.branches.map((b: any) => ({ name: b.branch.code, ticket: b.sales.ticket_sales / 100, food: b.sales.food_sales / 100, retail: b.sales.retail_sales / 100 }))}>
            <XAxis dataKey="name" /><YAxis /><Tooltip /><Bar dataKey="ticket" stackId="a" fill="#4f46e5" /><Bar dataKey="food" stackId="a" fill="#f59e0b" /><Bar dataKey="retail" stackId="a" fill="#8b5cf6" />
          </BarChart>
        </ResponsiveContainer>
      </Card>
      <Card padded={false}>
        <Table rows={q.data.branches} rowKey={(r: any) => r.branch.id} onRowClick={(r: any) => { setBranch(r.branch.id); nav('/staff'); }} columns={[
          { key: 'branch', header: 'Branch', render: (r: any) => <b>{r.branch.code} · {r.branch.name}</b> },
          { key: 'inside', header: 'Inside', align: 'right', render: (r: any) => `${num(r.occupancy.inside)} / ${num(r.occupancy.capacity)}` },
          { key: 'visitors', header: 'Visitors', align: 'right', render: (r: any) => num(r.occupancy.visitorsToday) },
          { key: 'ticket', header: 'Tickets', align: 'right', render: (r: any) => thb0(r.sales.ticket_sales) }, { key: 'food', header: 'Food', align: 'right', render: (r: any) => thb0(r.sales.food_sales) },
          { key: 'retail', header: 'Retail', align: 'right', render: (r: any) => thb0(r.sales.retail_sales) }, { key: 'rev', header: 'Revenue', align: 'right', render: (r: any) => <b>{thb0(r.sales.total_revenue)}</b> },
          { key: 'dev', header: 'Devices', render: (r: any) => <Badge tone={r.devices.offline ? 'red' : 'green'}>{r.devices.online}/{r.devices.total}</Badge> }]} />
      </Card>
    </div>
  );
}
