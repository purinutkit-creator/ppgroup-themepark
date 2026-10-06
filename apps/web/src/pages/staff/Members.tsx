import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Search, Star } from 'lucide-react';
import { sapi, errorMessage, qs } from '../../lib/api';
import { useCan } from '../../lib/auth';
import { fmtDate, fmtDateTime, thb } from '../../lib/format';
import { withApproval } from '../../components/Approval';
import { Badge, Button, Card, Field, Input, KV, Loading, Modal, PageHeader, Select, Table, Tabs, toast } from '../../components/ui';

export function Members() {
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const list = useQuery({ queryKey: ['members', q], queryFn: () => sapi.get(`/api/members${qs({ q })}`) });
  return (
    <div className="space-y-4">
      <PageHeader title="Members" />
      <Card padded={false}>
        <div className="border-b border-slate-100 p-3"><div className="relative"><Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" /><Input className="pl-9" placeholder="Search phone / email / member ID / name" value={q} onChange={(e) => setQ(e.target.value)} /></div></div>
        {list.isLoading ? <Loading /> : <Table rows={list.data ?? []} onRowClick={(r: any) => nav(`/staff/members/${r.id}`)} columns={[
          { key: 'member_code', header: 'Member ID', render: (r: any) => <span className="font-mono">{r.member_code}</span> }, { key: 'name', header: 'Name', render: (r: any) => `${r.first_name} ${r.last_name}` },
          { key: 'phone', header: 'Phone' }, { key: 'tier', header: 'Tier', render: (r: any) => <span className="rounded px-2 py-0.5 text-xs font-bold text-white" style={{ background: r.tier_color ?? '#94a3b8' }}>{r.tier_name ?? 'BASIC'}</span> },
          { key: 'points', header: 'Points', align: 'right' }, { key: 'wallet_balance', header: 'Wallet', align: 'right', render: (r: any) => thb(r.wallet_balance ?? 0) },
          { key: 'visit_count', header: 'Visits', align: 'right' }, { key: 'total_spend', header: 'Total spend', align: 'right', render: (r: any) => thb(r.total_spend) }, { key: 'status', header: 'Status', render: (r: any) => <Badge>{r.status}</Badge> }]} />}
      </Card>
    </div>
  );
}

export function MemberDetail() {
  const { id } = useParams();
  const can = useCan();
  const qc = useQueryClient();
  const nav = useNavigate();
  const q = useQuery({ queryKey: ['member', id], queryFn: () => sapi.get(`/api/members/${id}`) });
  const [tab, setTab] = useState('overview');
  const [edit, setEdit] = useState(false);
  const [f, setF] = useState<any>({});
  if (!q.data) return <Loading />;
  const m = q.data;
  return (
    <div className="space-y-4">
      <PageHeader title={`${m.first_name} ${m.last_name}`} subtitle={`${m.member_code} · joined ${fmtDate(m.join_date)} via ${m.registered_via}`} actions={<>
        {can('member.edit') && <Button variant="outline" onClick={() => { setF({ firstName: m.first_name, lastName: m.last_name, phone: m.phone, email: m.email ?? '', birthday: m.birthday ?? '', status: m.status }); setEdit(true); }}>Edit</Button>}
        {can('points.adjust') && <Button variant="outline" icon={<Star className="h-4 w-4" />} onClick={async () => {
          const v = prompt('Points (+/−)?'); const reason = v && prompt('Reason?'); if (!v || !reason) return;
          try { await withApproval('POINTS_ADJUST', (approvalId) => sapi.post(`/api/members/${id}/points`, { points: Number(v), reason, approvalId }), reason); qc.invalidateQueries({ queryKey: ['member', id] }); } catch (e) { toast.error(errorMessage(e)); }
        }}>Adjust points</Button>}</>} />
      <div className="grid gap-3 md:grid-cols-4">
        <Card><div className="text-xs text-slate-500">Tier</div><div className="text-xl font-black" style={{ color: m.tier_color ?? undefined }}>{m.tier_name ?? 'BASIC'}</div><div className="text-xs">{m.membership ? `${m.membership.product_name} → ${m.membership.end_date ? fmtDate(m.membership.end_date) : 'Lifetime'}` : 'No membership'}</div></Card>
        <Card><div className="text-xs text-slate-500">Points</div><div className="text-xl font-black">{m.points}</div></Card>
        <Card><div className="text-xs text-slate-500">Wallet</div><div className="text-xl font-black">{thb(m.wallet_balance)}</div></Card>
        <Card><div className="text-xs text-slate-500">Visits / Spend</div><div className="text-xl font-black">{m.visit_count} · {thb(m.total_spend)}</div></Card>
      </div>
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'overview', label: 'Overview' }, { value: 'tickets', label: 'Tickets' }, { value: 'orders', label: 'Transactions' }, { value: 'rides', label: 'Rides' }, { value: 'points', label: 'Points' }, { value: 'cards', label: 'Cards' }]} />
      {tab === 'overview' && <Card><div className="grid gap-x-8 md:grid-cols-2"><KV k="Phone" v={m.phone} /><KV k="Email" v={m.email ?? '-'} /><KV k="Birthday" v={fmtDate(m.birthday)} /><KV k="Gender" v={m.gender ?? '-'} /><KV k="Address" v={m.address ?? '-'} /><KV k="Emergency" v={m.emergency_contact ?? '-'} /><KV k="Status" v={<Badge>{m.status}</Badge>} />
        <KV k="Benefits" v={m.benefits.map((b: any) => b.label ?? b.type).join(', ') || '-'} /></div></Card>}
      {tab === 'tickets' && <Card padded={false}><Table dense rows={m.tickets} columns={[{ key: 'ticket_code', header: 'Ticket' }, { key: 'package_name', header: 'Package' }, { key: 'visit_date', header: 'Visit', render: (r: any) => fmtDate(r.visit_date) }, { key: 'status', header: 'Status', render: (r: any) => <Badge>{r.status}</Badge> }]} /></Card>}
      {tab === 'orders' && <Card padded={false}><Table dense rows={m.orders} columns={[{ key: 'created_at', header: 'Time', render: (r: any) => fmtDateTime(r.created_at) }, { key: 'order_no', header: 'Order' }, { key: 'type', header: 'Type' }, { key: 'status', header: 'Status', render: (r: any) => <Badge>{r.status}</Badge> }, { key: 'total', header: 'Total', align: 'right', render: (r: any) => thb(r.total) }]} /></Card>}
      {tab === 'rides' && <Card padded={false}><Table dense rows={m.rides} columns={[{ key: 'scanned_at', header: 'Time', render: (r: any) => fmtDateTime(r.scanned_at) }, { key: 'ride_name', header: 'Ride' }, { key: 'result', header: 'Result', render: (r: any) => <Badge>{r.result}</Badge> }]} /></Card>}
      {tab === 'points' && <Card padded={false}><Table dense rows={m.points} columns={[{ key: 'created_at', header: 'Time', render: (r: any) => fmtDateTime(r.created_at) }, { key: 'type', header: 'Type' }, { key: 'points', header: 'Points', align: 'right' }, { key: 'balance_after', header: 'Balance', align: 'right' }, { key: 'note', header: 'Note' }]} /></Card>}
      {tab === 'cards' && <Card padded={false}><Table dense rows={m.credentials} onRowClick={(r: any) => nav(`/staff/cards?id=${r.id}`)} columns={[{ key: 'code', header: 'Card' }, { key: 'type', header: 'Type' }, { key: 'status', header: 'Status', render: (r: any) => <Badge>{r.status}</Badge> }, { key: 'issued_at', header: 'Issued', render: (r: any) => fmtDate(r.issued_at) }]} /></Card>}
      <Modal open={edit} onClose={() => setEdit(false)} title="Edit member" footer={<Button onClick={async () => { try { await sapi.patch(`/api/members/${id}`, { ...f, email: f.email || null, birthday: f.birthday || null }); setEdit(false); qc.invalidateQueries({ queryKey: ['member', id] }); } catch (e) { toast.error(errorMessage(e)); } }}>Save</Button>}>
        <div className="grid grid-cols-2 gap-3">
          {[['firstName', 'First name'], ['lastName', 'Last name'], ['phone', 'Phone'], ['email', 'Email'], ['birthday', 'Birthday']].map(([k, l]) => <Field key={k} label={l}><Input type={k === 'birthday' ? 'date' : 'text'} value={f[k] ?? ''} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></Field>)}
          <Field label="Status"><Select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>{['ACTIVE', 'SUSPENDED', 'CLOSED'].map((s) => <option key={s}>{s}</option>)}</Select></Field>
        </div>
      </Modal>
    </div>
  );
}
