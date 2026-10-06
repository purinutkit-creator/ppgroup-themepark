import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Clock, CreditCard, Lock, Star, Ticket, Wallet } from 'lucide-react';
import { Badge, Card, KV, Loading, Table, Tabs } from './ui';
import { sapi } from '../lib/api';
import { useRealtime } from '../lib/socket';
import { fmtDate, fmtDateTime, thb } from '../lib/format';

export type Profile = any;

/** CARD PROFILE — single view of the customer behind any credential (updates live). */
export function CardProfileView({ profile, actions }: { profile: Profile; actions?: React.ReactNode }) {
  const [tab, setTab] = useState<'overview' | 'wallet' | 'tickets' | 'rides' | 'orders' | 'transactions' | 'points' | 'history'>('overview');
  const qc = useQueryClient();
  const id = profile.credential.id;
  useRealtime([profile.credential.accountId ? `account:${profile.credential.accountId}` : null], {
    'wallet.updated': () => qc.invalidateQueries({ queryKey: ['card', id] }),
    'entitlements.updated': () => qc.invalidateQueries({ queryKey: ['card', id] }),
    'credential.updated': () => qc.invalidateQueries({ queryKey: ['card', id] }),
    'ticket.updated': () => qc.invalidateQueries({ queryKey: ['card', id] }),
  });
  const history = useQuery({ queryKey: ['card-history', id], queryFn: () => sapi.get(`/api/credentials/${id}/history`), enabled: tab !== 'overview' && tab !== 'tickets' });
  const c = profile.credential;
  const m = profile.member;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3 rounded-2xl bg-gradient-to-br from-slate-900 to-brand-900 p-5 text-white">
        <div>
          <div className="text-xs uppercase tracking-widest text-white/60">{c.type.replaceAll('_', ' ')}</div>
          <div className="font-mono text-2xl font-bold">{c.code}</div>
          <div className="mt-1 text-lg">{profile.customerName ?? 'Guest'}</div>
          {m && <div className="mt-1 flex items-center gap-2 text-sm"><span className="rounded px-2 py-0.5 text-xs font-bold" style={{ background: m.tier_color ?? '#64748b' }}>{m.tier_name ?? 'BASIC'}</span>{m.member_code}</div>}
        </div>
        <div className="text-right">
          <Badge>{c.status}</Badge>
          <div className="mt-2 text-xs text-white/60">Wallet</div>
          <div className="text-3xl font-bold tabular-nums">{thb(profile.wallet?.balance ?? 0)}</div>
          {m && <div className="text-sm text-amber-300"><Star className="mr-1 inline h-4 w-4" />{m.points} pts</div>}
        </div>
      </div>
      {actions}
      <Tabs value={tab} onChange={setTab as any} tabs={[
        { value: 'overview', label: 'Overview' }, { value: 'wallet', label: 'Wallet' }, { value: 'tickets', label: 'Tickets', count: profile.tickets.length },
        { value: 'rides', label: 'Rides' }, { value: 'orders', label: 'Orders' }, { value: 'transactions', label: 'Transactions' }, { value: 'points', label: 'Points' }, { value: 'history', label: 'History' }]} />
      {tab === 'overview' && (
        <div className="grid gap-4 md:grid-cols-2">
          <Card title={<span className="flex items-center gap-2"><CreditCard className="h-4 w-4" /> Credential</span>}>
            <KV k="Status" v={<Badge>{c.status}</Badge>} />
            <KV k="Issued" v={fmtDateTime(c.issuedAt)} />
            <KV k="Expires" v={c.expiresAt ? fmtDateTime(c.expiresAt) : 'No expiry'} />
            {c.physicalSerial && <KV k="Serial" v={c.physicalSerial} />}
            {m && <><KV k="Member" v={`${m.first_name} ${m.last_name}`} /><KV k="Phone" v={m.phone} /><KV k="Membership" v={m.membership_name ? `${m.membership_name} → ${fmtDate(m.membership_end)}` : 'Basic'} /></>}
            {profile.otherCredentials?.length > 0 && <KV k="Linked credentials" v={profile.otherCredentials.map((o: any) => o.code).join(', ')} />}
          </Card>
          <Card title={<span className="flex items-center gap-2"><Ticket className="h-4 w-4" /> Active package & ride rights</span>}>
            {profile.tickets.filter((t: any) => t.status === 'ACTIVE').slice(0, 3).map((t: any) => (
              <div key={t.id} className="mb-2 rounded-lg bg-slate-50 p-2 text-sm">
                <div className="flex justify-between"><b>{t.package}</b><Badge>{t.presence === 'INSIDE' ? 'INSIDE' : t.status}</Badge></div>
                <div className="text-xs text-slate-500">{t.code} · {t.ticketType} · {fmtDate(t.validFrom)}–{fmtDate(t.validTo)}</div>
              </div>
            ))}
            <div className="flex flex-wrap gap-1.5">
              {profile.entitlements.map((e: any) => (
                <span key={e.id} className="rounded-full bg-emerald-50 px-2 py-1 text-xs text-emerald-700">{e.ride}{e.usesRemaining != null ? ` · ${e.usesRemaining} left` : ` · ${e.type.replace('_', ' ').toLowerCase()}`}</span>
              ))}
              {!profile.entitlements.length && <span className="text-sm text-slate-400">No ride rights</span>}
            </div>
          </Card>
          <Card title={<span className="flex items-center gap-2"><Clock className="h-4 w-4" /> Queue</span>}>
            {profile.queues.length ? profile.queues.map((q: any) => <KV key={q.id} k={q.ride_name} v={<span>{q.queue_no} <Badge>{q.status}</Badge></span>} />) : <div className="text-sm text-slate-400">Not in queue</div>}
          </Card>
          <Card title={<span className="flex items-center gap-2"><Lock className="h-4 w-4" /> Locker</span>}>
            {profile.lockers.length ? profile.lockers.map((l: any) => <KV key={l.id} k={`Locker ${l.locker_code} (${l.size})`} v={`until ${fmtDateTime(l.expire_at)}`} />) : <div className="text-sm text-slate-400">No locker</div>}
          </Card>
        </div>
      )}
      {tab === 'tickets' && (
        <Table rows={profile.tickets} columns={[{ key: 'code', header: 'Ticket' }, { key: 'package', header: 'Package' }, { key: 'ticketType', header: 'Type' },
          { key: 'visitDate', header: 'Visit', render: (r: any) => fmtDate(r.visitDate) }, { key: 'status', header: 'Status', render: (r: any) => <Badge>{r.status}</Badge> },
          { key: 'presence', header: 'Presence', render: (r: any) => <Badge>{r.presence}</Badge> }, { key: 'entryCount', header: 'Entries', align: 'right' }]} />
      )}
      {tab !== 'overview' && tab !== 'tickets' && (history.isLoading ? <Loading /> : history.data && (
        <>
          {tab === 'wallet' && <Table dense rows={history.data.ledger} columns={[{ key: 'created_at', header: 'Time', render: (r: any) => fmtDateTime(r.created_at) }, { key: 'txn_no', header: 'Txn' },
            { key: 'type', header: 'Type', render: (r: any) => <Badge tone={r.credit ? 'green' : 'red'}>{r.type}</Badge> }, { key: 'credit', header: 'Credit', align: 'right', render: (r: any) => (r.credit ? thb(r.credit) : '') },
            { key: 'debit', header: 'Debit', align: 'right', render: (r: any) => (r.debit ? thb(r.debit) : '') }, { key: 'balance_before', header: 'Before', align: 'right', render: (r: any) => thb(r.balance_before) },
            { key: 'balance_after', header: 'After', align: 'right', render: (r: any) => thb(r.balance_after) }, { key: 'store_name', header: 'Store' }]} />}
          {tab === 'rides' && <Table dense rows={history.data.rides} columns={[{ key: 'scanned_at', header: 'Time', render: (r: any) => fmtDateTime(r.scanned_at) }, { key: 'ride_name', header: 'Ride' },
            { key: 'result', header: 'Result', render: (r: any) => <Badge>{r.result}</Badge> }, { key: 'reason', header: 'Reason' }]} />}
          {tab === 'orders' && <Table dense rows={history.data.orders} columns={[{ key: 'created_at', header: 'Time', render: (r: any) => fmtDateTime(r.created_at) }, { key: 'order_no', header: 'Order' },
            { key: 'type', header: 'Type' }, { key: 'store_name', header: 'Store' }, { key: 'status', header: 'Status', render: (r: any) => <Badge>{r.status}</Badge> }, { key: 'total', header: 'Total', align: 'right', render: (r: any) => thb(r.total) }]} />}
          {tab === 'transactions' && <Table dense rows={history.data.transactions} columns={[{ key: 'created_at', header: 'Time', render: (r: any) => fmtDateTime(r.created_at) }, { key: 'txn_no', header: 'Txn' },
            { key: 'type', header: 'Type' }, { key: 'category', header: 'Category' }, { key: 'method', header: 'Method' }, { key: 'amount', header: 'Amount', align: 'right', render: (r: any) => thb(r.amount) }]} />}
          {tab === 'points' && <Table dense rows={history.data.points} columns={[{ key: 'created_at', header: 'Time', render: (r: any) => fmtDateTime(r.created_at) }, { key: 'type', header: 'Type' },
            { key: 'points', header: 'Points', align: 'right' }, { key: 'balance_after', header: 'Balance', align: 'right' }, { key: 'reference_id', header: 'Ref' }]} />}
          {tab === 'history' && <div className="grid gap-4 md:grid-cols-2">
            <Card title="Gate scans"><Table dense rows={history.data.gates} columns={[{ key: 'scanned_at', header: 'Time', render: (r: any) => fmtDateTime(r.scanned_at) }, { key: 'gate_name', header: 'Gate' }, { key: 'result', header: 'Result', render: (r: any) => <Badge>{r.result}</Badge> }]} /></Card>
            <Card title="Card replacements"><Table dense rows={history.data.replacements} columns={[{ key: 'created_at', header: 'Time', render: (r: any) => fmtDateTime(r.created_at) }, { key: 'old_code', header: 'Old' }, { key: 'new_code', header: 'New' }, { key: 'reason', header: 'Reason' }]} /></Card>
          </div>}
        </>
      ))}
    </div>
  );
}

export function WalletPill({ balance }: { balance: number }) {
  return <span className="inline-flex items-center gap-1 rounded-full bg-violet-100 px-2 py-0.5 text-sm font-semibold text-violet-700"><Wallet className="h-3.5 w-3.5" />{thb(balance)}</span>;
}
