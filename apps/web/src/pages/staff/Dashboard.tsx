import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Activity, Coins, Cpu, DoorOpen, FerrisWheel, Lock, ShoppingBag, Ticket, Users, Utensils, Wallet } from 'lucide-react';
import { sapi, qs } from '../../lib/api';
import { useBranchId } from '../../lib/auth';
import { useRealtime } from '../../lib/socket';
import { num, thb0 } from '../../lib/format';
import { Badge, Card, Loading, PageHeader, Stat, Table } from '../../components/ui';

const COLORS = ['#4f46e5', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6'];

export function Dashboard() {
  const branchId = useBranchId();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['dashboard', branchId], queryFn: () => sapi.get(`/api/dashboard${qs({ branchId })}`), enabled: !!branchId, refetchInterval: 60_000 });
  useRealtime([branchId ? `branch:${branchId}` : null], {
    'occupancy.changed': (o) => qc.setQueryData(['dashboard', branchId], (d: any) => (d ? { ...d, occupancy: { ...d.occupancy, ...o } } : d)),
    'dashboard.changed': () => qc.invalidateQueries({ queryKey: ['dashboard', branchId] }),
    'order.paid': () => qc.invalidateQueries({ queryKey: ['dashboard', branchId] }),
  });
  if (!q.data) return <Loading />;
  const d = q.data;
  const s = d.sales;
  const occ = d.occupancy;
  return (
    <div className="space-y-4">
      <PageHeader title="Real-time Dashboard" subtitle={`Business day ${d.date} · updates live`} actions={<Badge tone="green"><Activity className="h-3 w-3" /> LIVE</Badge>} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Today Visitors" value={num(occ.visitorsToday)} sub={`${num(occ.entered)} entries · ${num(occ.exited)} exits`} icon={<Users className="h-5 w-5" />} tone="brand" />
        <Stat label="Current Inside" value={<span>{num(occ.inside)} <span className="text-base font-medium text-slate-400">/ {num(occ.capacity)}</span></span>}
          sub={<div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-100"><div className={`h-full ${occ.percent >= 90 ? 'bg-rose-500' : occ.percent >= 80 ? 'bg-amber-500' : 'bg-emerald-500'}`} style={{ width: `${Math.min(100, occ.percent)}%` }} /></div>}
          icon={<DoorOpen className="h-5 w-5" />} tone={occ.percent >= 90 ? 'rose' : 'emerald'} />
        <Stat label="Total Revenue" value={thb0(s.total_revenue)} sub="Cash-basis collections incl. top-ups" icon={<Coins className="h-5 w-5" />} tone="emerald" />
        <Stat label="Peak Time" value={d.peak.hour != null ? `${String(d.peak.hour).padStart(2, '0')}:00` : '-'} sub={`${num(d.peak.inside)} guests at peak`} icon={<Activity className="h-5 w-5" />} tone="amber" />
        <Stat label="Ticket Sales" value={thb0(s.ticket_sales)} icon={<Ticket className="h-5 w-5" />} tone="brand" />
        <Stat label="Food Sales" value={thb0(s.food_sales)} icon={<Utensils className="h-5 w-5" />} tone="amber" />
        <Stat label="Retail Sales" value={thb0(s.retail_sales)} icon={<ShoppingBag className="h-5 w-5" />} tone="violet" />
        <Stat label="Wallet Top-up" value={thb0(s.wallet_topup)} sub={`Other sales ${thb0(s.other_sales)} · Refunds ${thb0(s.refunds)}`} icon={<Wallet className="h-5 w-5" />} tone="sky" />
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <Card title="Visitors by Hour">
          <ResponsiveContainer width="100%" height={240}>
            <AreaChart data={d.hourly.filter((h: any) => h.hour >= 8 && h.hour <= 22)}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" /><XAxis dataKey="hour" tickFormatter={(h) => `${h}:00`} fontSize={11} /><YAxis fontSize={11} /><Tooltip />
              <Area type="monotone" dataKey="inside" name="Inside" stroke="#4f46e5" fill="#c7d2fe" /><Area type="monotone" dataKey="entries" name="Entries" stroke="#10b981" fill="#a7f3d0" />
            </AreaChart>
          </ResponsiveContainer>
        </Card>
        <Card title="Revenue by Hour">
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={d.hourly.filter((h: any) => h.hour >= 8 && h.hour <= 22).map((h: any) => ({ ...h, revenue: Number(h.revenue) / 100 }))}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" /><XAxis dataKey="hour" tickFormatter={(h) => `${h}:00`} fontSize={11} /><YAxis fontSize={11} /><Tooltip formatter={(v: any) => `฿${Number(v).toLocaleString()}`} />
              <Bar dataKey="revenue" fill="#4f46e5" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Card>
        <Card title="Ticket Type Mix">
          {d.ticketTypes.length ? (
            <ResponsiveContainer width="100%" height={240}>
              <PieChart><Pie data={d.ticketTypes.map((t: any) => ({ name: `${t.package} · ${t.ticket_type}`, value: t.qty }))} dataKey="value" nameKey="name" outerRadius={90} innerRadius={50}>
                {d.ticketTypes.map((_: any, i: number) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}</Pie><Tooltip /><Legend wrapperStyle={{ fontSize: 11 }} /></PieChart>
            </ResponsiveContainer>
          ) : <div className="p-10 text-center text-sm text-slate-400">No tickets activated today</div>}
        </Card>
        <Card title="Sales by Store">
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={d.stores.map((s: any) => ({ ...s, amount: Number(s.amount) / 100 }))} layout="vertical">
              <XAxis type="number" fontSize={11} /><YAxis type="category" dataKey="store" width={120} fontSize={11} /><Tooltip formatter={(v: any) => `฿${Number(v).toLocaleString()}`} />
              <Bar dataKey="amount" fill="#0ea5e9" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Card>
        <Card title={<span className="flex items-center gap-2"><FerrisWheel className="h-4 w-4" /> Ride Usage & Queue Time</span>} actions={<Link to="/staff/rides" className="text-sm text-brand-600">Rides →</Link>} padded={false}>
          <Table dense rows={d.rides} columns={[{ key: 'name', header: 'Ride' }, { key: 'status', header: 'Status', render: (r: any) => <Badge>{r.status}</Badge> },
            { key: 'rides', header: 'Rides', align: 'right' }, { key: 'queue_guests', header: 'Queue', align: 'right' }, { key: 'wait_min', header: 'Wait (min)', align: 'right' }]} />
        </Card>
        <Card title={<span className="flex items-center gap-2"><DoorOpen className="h-4 w-4" /> Gate Traffic</span>} actions={<Link to="/staff/gates" className="text-sm text-brand-600">Console →</Link>} padded={false}>
          <Table dense rows={d.gates} columns={[{ key: 'name', header: 'Gate' }, { key: 'state', header: 'State', render: (r: any) => <Badge>{r.state}</Badge> },
            { key: 'scans', header: 'Scans', align: 'right' }, { key: 'approved', header: 'Approved', align: 'right' }, { key: 'denied', header: 'Denied', align: 'right' }, { key: 'duplicate', header: 'Dup.', align: 'right' }]} />
        </Card>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Devices online" value={`${d.devices.online}/${d.devices.total}`} sub={d.devices.offline ? `${d.devices.offline} offline` : 'All good'} icon={<Cpu className="h-5 w-5" />} tone={d.devices.offline ? 'rose' : 'emerald'} />
        <Stat label="Lockers in use" value={`${d.lockers.occupied}/${d.lockers.total}`} icon={<Lock className="h-5 w-5" />} tone="violet" />
        <Stat label="New members" value={num(d.members.new_today)} icon={<Users className="h-5 w-5" />} tone="sky" />
        <Stat label="Transactions" value={num(s.sale_count)} icon={<Coins className="h-5 w-5" />} />
      </div>
    </div>
  );
}
