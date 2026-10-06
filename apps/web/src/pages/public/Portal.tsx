import { useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, Clock, CreditCard, Gift, History, Lock, LogOut, QrCode, ShieldCheck, Star, Ticket, Utensils, Wallet } from 'lucide-react';
import { mapi, errorMessage, newKey } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useRealtime } from '../../lib/socket';
import { useT } from '../../lib/i18n';
import { fmtDate, fmtDateTime, thb, toSatang } from '../../lib/format';
import { Badge, Button, Card, Empty, Field, Input, KV, Loading, Modal, Table, Tabs, cx, toast } from '../../components/ui';
import { Barcode, QR } from '../../components/Codes';
import { usePublicConfig } from '../../lib/config';

type Tab = 'card' | 'tickets' | 'wallet' | 'rewards' | 'rides' | 'queue' | 'orders' | 'membership' | 'profile' | 'notifications';

export function Portal() {
  const t = useT();
  const token = useAuth((s) => s.memberToken);
  const logout = useAuth((s) => s.logoutMember);
  const nav = useNavigate();
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>('card');
  const me = useQuery({ queryKey: ['me'], queryFn: () => mapi.get('/api/member/me'), enabled: !!token });
  useRealtime([], {
    'wallet.updated': () => { qc.invalidateQueries({ queryKey: ['me'] }); qc.invalidateQueries({ queryKey: ['m-wallet'] }); },
    'points.updated': () => qc.invalidateQueries({ queryKey: ['me'] }),
    'membership.updated': () => qc.invalidateQueries({ queryKey: ['me'] }),
    'queue.updated': () => qc.invalidateQueries({ queryKey: ['m-queues'] }),
    'entitlements.updated': () => qc.invalidateQueries({ queryKey: ['m-ent'] }),
    'ticket.updated': () => qc.invalidateQueries({ queryKey: ['m-tickets'] }),
    'order.kitchen': (e) => { qc.invalidateQueries({ queryKey: ['m-orders'] }); if (e.status === 'READY') toast.success(`🍔 ${t('ready')} ${e.queueNo}`); },
    notification: (n) => { qc.invalidateQueries({ queryKey: ['m-notif'] }); toast.info(`${n.title} — ${n.message}`); },
  }, { ctx: 'member' });
  if (!token) return <Navigate to="/login?next=/account" replace />;
  if (me.isLoading) return <Loading />;
  const m = me.data;
  if (!m) return null;
  const tabs: Array<{ value: Tab; label: string; icon: any }> = [
    { value: 'card', label: t('memberCard'), icon: QrCode }, { value: 'tickets', label: t('tickets'), icon: Ticket }, { value: 'wallet', label: t('wallet'), icon: Wallet },
    { value: 'rewards', label: t('rewards'), icon: Gift }, { value: 'rides', label: t('rides'), icon: History }, { value: 'queue', label: t('checkQueue'), icon: Clock },
    { value: 'orders', label: t('orderFood'), icon: Utensils }, { value: 'membership', label: t('membership'), icon: Star }, { value: 'notifications', label: 'Notifications', icon: Bell },
    { value: 'profile', label: t('profile'), icon: ShieldCheck },
  ];
  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-sm text-slate-500">{t('welcome')}</div>
          <div className="text-2xl font-bold">{m.first_name} {m.last_name}</div>
          <div className="mt-1 flex items-center gap-2 text-sm"><span className="rounded px-2 py-0.5 text-xs font-bold text-white" style={{ background: m.tier_color ?? '#64748b' }}>{m.tier_name ?? 'BASIC'}</span>{m.member_code}</div>
        </div>
        <div className="flex gap-3">
          <div className="rounded-xl bg-violet-50 px-4 py-2"><div className="text-xs text-violet-600">{t('wallet')}</div><div className="text-xl font-bold text-violet-800">{thb(m.wallet_balance)}</div></div>
          <div className="rounded-xl bg-amber-50 px-4 py-2"><div className="text-xs text-amber-600">{t('points')}</div><div className="text-xl font-bold text-amber-800">{m.points.toLocaleString()}</div></div>
          <Button variant="ghost" icon={<LogOut className="h-4 w-4" />} onClick={async () => { await mapi.post('/api/auth/logout').catch(() => {}); logout(); nav('/'); }} />
        </div>
      </div>
      <div className="mb-4 flex gap-1 overflow-x-auto pb-1">
        {tabs.map((x) => (
          <button key={x.value} onClick={() => setTab(x.value)} className={cx('flex items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-2 text-sm font-medium', tab === x.value ? 'bg-brand-600 text-white' : 'bg-white text-slate-600 shadow-sm')}>
            <x.icon className="h-4 w-4" />{x.label}
          </button>
        ))}
      </div>
      {tab === 'card' && <DigitalCard member={m} />}
      {tab === 'tickets' && <MyTickets />}
      {tab === 'wallet' && <MyWallet balance={m.wallet_balance} />}
      {tab === 'rewards' && <MyRewards points={m.points} />}
      {tab === 'rides' && <MyRides />}
      {tab === 'queue' && <MyQueue />}
      {tab === 'orders' && <MyOrders />}
      {tab === 'membership' && <MyMembership m={m} />}
      {tab === 'notifications' && <MyNotifications />}
      {tab === 'profile' && <MyProfile m={m} />}
    </div>
  );
}

function DigitalCard({ member }: { member: any }) {
  const t = useT();
  const card = useQuery({ queryKey: ['m-card'], queryFn: () => mapi.get('/api/member/card'), refetchInterval: (q) => ((q.state.data as any)?.dynamic ? 25_000 : false) });
  const [left, setLeft] = useState(0);
  useEffect(() => {
    if (!card.data?.dynamic) return;
    setLeft(card.data.expiresInSec);
    const i = setInterval(() => setLeft((s) => { if (s <= 1) { card.refetch(); return 30; } return s - 1; }), 1000);
    return () => clearInterval(i);
  }, [card.data]);
  if (card.isLoading) return <Loading />;
  if (!card.data) return <Empty title="No digital card" />;
  const c = card.data;
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div className="relative overflow-hidden rounded-3xl p-6 text-white shadow-2xl" style={{ background: `linear-gradient(135deg, ${member.tier_color ?? '#334155'}, #0f172a)` }}>
        <div className="absolute -right-10 -top-10 h-40 w-40 rounded-full bg-white/10" />
        <div className="text-xs uppercase tracking-[0.3em] text-white/70">{t('memberCard')}</div>
        <div className="mt-6 text-2xl font-bold">{c.member.name}</div>
        <div className="font-mono text-white/80">{c.member.memberCode}</div>
        <div className="mt-6 flex items-end justify-between">
          <div><div className="text-xs text-white/60">Tier</div><div className="text-xl font-black">{c.member.tier ?? 'BASIC'}</div></div>
          <div className="text-right"><div className="text-xs text-white/60">{t('expires')}</div><div className="font-semibold">{c.member.expiresAt ? fmtDate(c.member.expiresAt) : '—'}</div></div>
        </div>
      </div>
      <Card className="text-center">
        <QR value={c.qr} size={230} className="mx-auto" />
        <Barcode value={c.barcode} height={46} width={1.5} className="mx-auto" />
        {c.dynamic && <div className="mt-2 text-xs text-slate-500">QR เปลี่ยนทุก 30 วินาที (ป้องกันการแคปหน้าจอ) · refresh in {left}s</div>}
        <div className="mt-1 font-mono text-xs text-slate-400">{c.code}</div>
      </Card>
    </div>
  );
}

function MyTickets() {
  const t = useT();
  const q = useQuery({ queryKey: ['m-tickets'], queryFn: () => mapi.get('/api/member/tickets') });
  const ent = useQuery({ queryKey: ['m-ent'], queryFn: () => mapi.get('/api/member/entitlements') });
  const [attach, setAttach] = useState(false);
  const [f, setF] = useState({ bookingNo: '', phone: '' });
  if (q.isLoading) return <Loading />;
  return (
    <div className="space-y-4">
      <div className="flex justify-end"><Button variant="outline" onClick={() => setAttach(true)}>+ Add booking to my account</Button></div>
      <div className="grid gap-3 sm:grid-cols-2">
        {q.data?.length ? q.data.map((tk: any) => (
          <Card key={tk.id}>
            <div className="flex items-center gap-3">
              {tk.qr ? <QR value={tk.qr} size={96} /> : <div className="flex h-24 w-24 items-center justify-center rounded bg-slate-100 text-xs text-slate-400">{tk.status}</div>}
              <div className="text-sm">
                <div className="font-bold">{tk.package_name}</div><div>{tk.ticket_type} · {fmtDate(tk.visit_date)}</div>
                <div className="font-mono text-xs text-slate-500">{tk.ticket_code}</div>
                <div className="mt-1 flex gap-1"><Badge>{tk.status}</Badge>{tk.presence === 'INSIDE' && <Badge>INSIDE</Badge>}</div>
              </div>
            </div>
          </Card>
        )) : <Empty title={t('tickets')} hint="—" />}
      </div>
      <Card title="Ride rights">
        <div className="flex flex-wrap gap-2">{ent.data?.map((e: any) => <Badge key={e.id} tone="green">{e.ride_name ?? 'ALL RIDES'}{e.uses_remaining != null ? ` · ${e.uses_remaining} left` : ''}</Badge>)}
          {!ent.data?.length && <span className="text-sm text-slate-400">—</span>}</div>
      </Card>
      <Modal open={attach} onClose={() => setAttach(false)} title="Add booking" footer={<Button onClick={async () => {
        try { await mapi.post('/api/member/tickets/attach', f); toast.success('Added'); setAttach(false); q.refetch(); } catch (e) { toast.error(errorMessage(e)); }
      }}>Add</Button>}>
        <div className="space-y-3"><Field label="Booking No."><Input value={f.bookingNo} onChange={(e) => setF({ ...f, bookingNo: e.target.value.toUpperCase() })} placeholder="BK-261006-82931" /></Field>
          <Field label="Phone used for booking"><Input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field></div>
      </Modal>
    </div>
  );
}

function MyWallet({ balance }: { balance: number }) {
  const t = useT();
  const cfg = usePublicConfig();
  const w = useQuery({ queryKey: ['m-wallet'], queryFn: () => mapi.get('/api/member/wallet') });
  const [topup, setTopup] = useState(false);
  const [amount, setAmount] = useState('300');
  const [method, setMethod] = useState('PROMPTPAY');
  const [payment, setPayment] = useState<any>(null);
  const nav = useNavigate();
  const branches = useQuery({ queryKey: ['pub-branches'], queryFn: () => mapi.get('/api/public/branches') });
  const go = async () => {
    try {
      const r = await mapi.post('/api/member/checkout', { kind: 'TOPUP', branchId: branches.data?.[0]?.id, amount: toSatang(amount), method }, { idempotencyKey: newKey() });
      if (r.payment?.provider_payload?.checkoutUrl) nav(`${r.payment.provider_payload.checkoutUrl}?return=/account`);
      else setPayment(r.payment);
    } catch (e) { toast.error(errorMessage(e)); }
  };
  return (
    <div className="space-y-4">
      <Card>
        <div className="flex items-center justify-between">
          <div><div className="text-sm text-slate-500">{t('balance')}</div><div className="text-4xl font-extrabold text-violet-700">{thb(balance)}</div></div>
          <Button size="lg" onClick={() => { setTopup(true); setPayment(null); }}>{t('topup')}</Button>
        </div>
      </Card>
      <Card title={t('history')} padded={false}>
        {w.isLoading ? <Loading /> : <Table dense rows={w.data?.ledger ?? []} columns={[
          { key: 'created_at', header: 'Time', render: (r: any) => fmtDateTime(r.created_at) }, { key: 'type', header: 'Type', render: (r: any) => <Badge tone={r.credit ? 'green' : 'red'}>{r.type}</Badge> },
          { key: 'store_name', header: 'Where' }, { key: 'amount', header: 'Amount', align: 'right', render: (r: any) => (r.credit ? <span className="text-emerald-600">+{thb(r.credit)}</span> : <span className="text-rose-600">-{thb(r.debit)}</span>) },
          { key: 'balance_after', header: 'Balance', align: 'right', render: (r: any) => thb(r.balance_after) }]} />}
      </Card>
      <Modal open={topup} onClose={() => setTopup(false)} title={t('topup')}>
        {!payment ? (
          <div className="space-y-3">
            <div className="grid grid-cols-4 gap-2">{(cfg.data?.wallet.topupPresets ?? [10000, 30000, 50000, 100000]).map((p) => <Button key={p} variant={toSatang(amount) === p ? 'primary' : 'outline'} onClick={() => setAmount(String(p / 100))}>{thb(p)}</Button>)}</div>
            <Field label="Custom amount (THB)"><Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
            <div className="flex gap-2">{['PROMPTPAY', 'CARD'].map((m) => <Button key={m} variant={method === m ? 'primary' : 'outline'} onClick={() => setMethod(m)}>{m}</Button>)}</div>
            <Button block size="lg" onClick={go}>{t('payNow')} {thb(toSatang(amount))}</Button>
          </div>
        ) : (
          <div className="text-center">
            <QR value={payment.provider_payload?.qrPayload} size={220} className="mx-auto" />
            <div className="mt-2 text-lg font-bold">{thb(payment.amount)}</div>
            <div className="text-sm text-slate-500">{t('scanToPay')} — balance updates automatically</div>
            {cfg.data?.simulator && <Button className="mt-3" variant="outline" size="sm" onClick={() => mapi.post(`/api/public/payments/${payment.id}/simulate`, { outcome: 'SUCCESS' }).then(() => { toast.success(t('paymentSuccess')); setTopup(false); })}>Simulate payment (dev)</Button>}
          </div>
        )}
      </Modal>
    </div>
  );
}

function MyRewards({ points }: { points: number }) {
  const q = useQuery({ queryKey: ['m-rewards'], queryFn: () => mapi.get('/api/member/rewards') });
  const v = useQuery({ queryKey: ['m-vouchers'], queryFn: () => mapi.get('/api/member/vouchers') });
  const c = useQuery({ queryKey: ['m-coupons'], queryFn: () => mapi.get('/api/member/coupons') });
  const redeem = async (r: any) => {
    if (!confirm(`Redeem ${r.name} for ${r.points_required} points?`)) return;
    try { const x = await mapi.post(`/api/member/rewards/${r.id}/redeem`, {}, { idempotencyKey: newKey() }); toast.success(`Voucher ${x.voucher_code}`); q.refetch(); v.refetch(); c.refetch(); }
    catch (e) { toast.error(errorMessage(e)); }
  };
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {q.data?.map((r: any) => (
          <Card key={r.id}>
            <div className="flex items-start justify-between"><div className="font-bold">{r.name}</div><Badge tone="amber">{r.points_required} pts</Badge></div>
            <div className="mt-1 text-xs text-slate-500">{r.type.replace('_', ' ')}{r.stock != null ? ` · ${r.stock} left` : ''}</div>
            <Button className="mt-3" block size="sm" disabled={!r.eligible || !r.inStock || points < r.points_required} onClick={() => redeem(r)}>{!r.eligible ? 'Tier required' : points < r.points_required ? 'Not enough points' : 'Redeem'}</Button>
          </Card>
        ))}
      </div>
      <Card title="My vouchers & coupons">
        <Table dense rows={[...(v.data ?? []).map((x: any) => ({ ...x, kind: 'Voucher', code: x.voucher_code })), ...(c.data ?? []).map((x: any) => ({ ...x, kind: 'Coupon' }))]} columns={[
          { key: 'kind', header: 'Kind' }, { key: 'name', header: 'Name' }, { key: 'code', header: 'Code', render: (r: any) => <span className="font-mono">{r.code}</span> },
          { key: 'status', header: 'Status', render: (r: any) => <Badge>{r.status}</Badge> }, { key: 'expires_at', header: 'Expires', render: (r: any) => fmtDate(r.expires_at) }]} />
      </Card>
    </div>
  );
}

function MyRides() {
  const q = useQuery({ queryKey: ['m-rides'], queryFn: () => mapi.get('/api/member/rides') });
  return <Card padded={false}>{q.isLoading ? <Loading /> : <Table rows={q.data ?? []} columns={[{ key: 'scanned_at', header: 'Time', render: (r: any) => fmtDateTime(r.scanned_at) }, { key: 'ride_name', header: 'Ride' }, { key: 'result', header: 'Result', render: (r: any) => <Badge>{r.result}</Badge> }]} />}</Card>;
}

function MyQueue() {
  const t = useT();
  const q = useQuery({ queryKey: ['m-queues'], queryFn: () => mapi.get('/api/member/queues'), refetchInterval: 30_000 });
  const branches = useQuery({ queryKey: ['pub-branches'], queryFn: () => mapi.get('/api/public/branches') });
  const rides = useQuery({ queryKey: ['pub-rides', branches.data?.[0]?.id], queryFn: () => mapi.get(`/api/public/rides?branchId=${branches.data[0].id}`), enabled: !!branches.data?.[0] });
  const join = async (rideId: string) => { try { await mapi.post(`/api/member/queues/${rideId}/join`, { partySize: 1 }); q.refetch(); } catch (e) { toast.error(errorMessage(e)); } };
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        {q.data?.map((e: any) => (
          <Card key={e.id} className={e.status === 'CALLED' ? 'border-emerald-400 ring-4 ring-emerald-100' : ''}>
            <div className="flex items-center justify-between"><div><div className="text-sm text-slate-500">{e.rideName}</div><div className="text-4xl font-black text-brand-700">{e.queueNo}</div></div><Badge>{e.status}</Badge></div>
            {e.status === 'WAITING' ? <div className="mt-2 text-sm">{e.peopleAhead} {t('peopleAhead')} · ~{e.estimatedWaitMin} {t('minutes')}</div>
              : <div className="mt-2 text-sm font-semibold text-emerald-700">ถึงคิวของคุณแล้ว กรุณาไปที่ {e.rideName} ก่อน {fmtDateTime(e.callExpiresAt)}</div>}
            <Button className="mt-2" size="xs" variant="ghost" onClick={() => mapi.post(`/api/member/queues/entry/${e.id}/cancel`).then(() => q.refetch())}>{t('cancel')}</Button>
          </Card>
        ))}
        {!q.data?.length && <Empty title="Not in any queue" />}
      </div>
      <Card title={t('joinQueue')}>
        <div className="grid gap-2 sm:grid-cols-2">
          {rides.data?.filter((r: any) => r.queue_enabled && r.status === 'OPEN').map((r: any) => (
            <div key={r.id} className="flex items-center justify-between rounded-lg border border-slate-200 p-2 text-sm"><span>{r.name} <span className="text-slate-400">~{r.wait_min} min</span></span><Button size="xs" onClick={() => join(r.id)}>{t('joinQueue')}</Button></div>
          ))}
        </div>
      </Card>
    </div>
  );
}

function MyOrders() {
  const t = useT();
  const q = useQuery({ queryKey: ['m-orders'], queryFn: () => mapi.get('/api/member/orders') });
  const tx = useQuery({ queryKey: ['m-tx'], queryFn: () => mapi.get('/api/member/transactions') });
  const lockers = useQuery({ queryKey: ['m-lockers'], queryFn: () => mapi.get('/api/member/lockers') });
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        {q.data?.filter((o: any) => ['NEW', 'PREPARING', 'READY'].includes(o.kitchen_status)).map((o: any) => (
          <Card key={o.id} className={o.kitchen_status === 'READY' ? 'border-emerald-400' : ''}><div className="text-sm text-slate-500">{o.store_name}</div><div className="text-3xl font-black">{o.queue_no}</div><Badge>{o.kitchen_status === 'READY' ? t('ready') : t('preparing')}</Badge></Card>
        ))}
      </div>
      <Card title={<span className="flex items-center gap-2"><Lock className="h-4 w-4" /> Lockers</span>}>
        {lockers.data?.length ? lockers.data.map((l: any) => <KV key={l.id} k={`${l.locker_code} (${l.size})`} v={<span>{fmtDateTime(l.start_at)} → {fmtDateTime(l.expire_at)} <Badge>{l.status}</Badge></span>} />) : <div className="text-sm text-slate-400">—</div>}
      </Card>
      <Card title="Transactions" padded={false}>
        <Table dense rows={tx.data ?? []} columns={[{ key: 'created_at', header: 'Time', render: (r: any) => fmtDateTime(r.created_at) }, { key: 'order_no', header: 'Order' }, { key: 'type', header: 'Type' },
          { key: 'store_name', header: 'Store' }, { key: 'items', header: 'Items', render: (r: any) => (r.items ?? []).map((i: any) => `${i.qty}× ${i.name}`).join(', ') },
          { key: 'total', header: 'Total', align: 'right', render: (r: any) => thb(r.total) }, { key: 'points_earned', header: 'Pts', align: 'right' }]} />
      </Card>
    </div>
  );
}

function MyMembership({ m }: { m: any }) {
  const nav = useNavigate();
  const ms = m.membership;
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card title="Membership">
        {ms ? <>
          <KV k="Plan" v={ms.product_name} /><KV k="Status" v={<Badge>{ms.status}</Badge>} /><KV k="Start" v={fmtDate(ms.start_date)} /><KV k="Expiration" v={ms.end_date ? fmtDate(ms.end_date) : 'Lifetime'} />
          {ms.days_remaining != null && <KV k="Days remaining" v={<b className={ms.days_remaining < 30 ? 'text-rose-600' : ''}>{ms.days_remaining}</b>} />}
          <div className="mt-3 flex gap-2">
            {ms.end_date && <Button onClick={() => nav(`/membership?renew=${ms.product_id}`)}>RENEW MEMBERSHIP</Button>}
            <Button variant="outline" onClick={() => nav('/membership?upgrade=1')}>Upgrade</Button>
          </div>
        </> : <><div className="text-sm text-slate-500">Basic member (no paid membership)</div><Button className="mt-3" onClick={() => nav('/membership')}>Choose a membership</Button></>}
      </Card>
      <Card title="Benefits">
        {m.benefits?.length ? m.benefits.map((b: any, i: number) => <div key={i} className="flex items-center gap-2 py-1 text-sm"><Star className="h-4 w-4 text-amber-500" />{b.label ?? b.type}</div>) : <div className="text-sm text-slate-400">—</div>}
      </Card>
      <Card title="Cards" className="md:col-span-2">
        <Table dense rows={m.credentials} columns={[{ key: 'code', header: 'Card' }, { key: 'type', header: 'Type' }, { key: 'status', header: 'Status', render: (r: any) => <Badge>{r.status}</Badge> }, { key: 'issued_at', header: 'Issued', render: (r: any) => fmtDate(r.issued_at) }]} />
      </Card>
    </div>
  );
}

function MyNotifications() {
  const q = useQuery({ queryKey: ['m-notif'], queryFn: () => mapi.get('/api/member/notifications') });
  useEffect(() => { mapi.post('/api/member/notifications/read').catch(() => {}); }, []);
  return <Card padded={false}>{q.data?.length ? q.data.map((n: any) => <div key={n.id} className="border-b border-slate-100 p-3 last:border-0"><div className="font-semibold">{n.title}</div><div className="text-sm text-slate-600">{n.message}</div><div className="text-xs text-slate-400">{fmtDateTime(n.created_at)}</div></div>) : <Empty title="No notifications" />}</Card>;
}

function MyProfile({ m }: { m: any }) {
  const qc = useQueryClient();
  const logout = useAuth((s) => s.logoutMember);
  const [f, setF] = useState({ firstName: m.first_name, lastName: m.last_name, email: m.email ?? '', address: m.address ?? '', emergencyContact: m.emergency_contact ?? '' });
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '' });
  const sessions = useQuery({ queryKey: ['m-sessions'], queryFn: () => mapi.get('/api/member/sessions') });
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card title="Profile">
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3"><Field label="First name"><Input value={f.firstName} onChange={(e) => setF({ ...f, firstName: e.target.value })} /></Field><Field label="Last name"><Input value={f.lastName} onChange={(e) => setF({ ...f, lastName: e.target.value })} /></Field></div>
          <Field label="Phone"><Input value={m.phone} disabled /></Field>
          <Field label="Email"><Input value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
          <Field label="Address"><Input value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} /></Field>
          <Field label="Emergency contact"><Input value={f.emergencyContact} onChange={(e) => setF({ ...f, emergencyContact: e.target.value })} /></Field>
          <Button onClick={() => mapi.patch('/api/member/me', { ...f, email: f.email || null }).then(() => { toast.success('Saved'); qc.invalidateQueries({ queryKey: ['me'] }); }).catch((e) => toast.error(errorMessage(e)))}>Save</Button>
        </div>
      </Card>
      <div className="space-y-4">
        <Card title="Change password">
          <div className="space-y-3">
            <Field label="Current password"><Input type="password" value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} /></Field>
            <Field label="New password"><Input type="password" value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} /></Field>
            <Button onClick={() => mapi.post('/api/member/password/change', pw).then(() => { toast.success('Password changed — other sessions signed out'); setPw({ currentPassword: '', newPassword: '' }); }).catch((e) => toast.error(errorMessage(e)))}>Change</Button>
          </div>
        </Card>
        <Card title="Active sessions" actions={<Button size="sm" variant="danger" onClick={async () => { await mapi.post('/api/auth/logout-all'); logout(); }}>Logout all devices</Button>}>
          {sessions.data?.map((s: any) => <div key={s.id} className="border-b border-slate-100 py-1.5 text-xs last:border-0"><b>{s.current ? 'This device' : s.ip}</b> · {s.user_agent?.slice(0, 60)} · {fmtDateTime(s.created_at)}</div>)}
        </Card>
      </div>
    </div>
  );
}
