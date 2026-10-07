import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CreditCard, Minus, Plus, Printer, QrCode, Search, Ticket, UserPlus, Wallet } from 'lucide-react';
import { sapi, errorMessage, newKey, qs } from '../../lib/api';
import { useBranchId, useCan } from '../../lib/auth';
import { fmtDate, thb, today, toSatang } from '../../lib/format';
import { Badge, Button, Card, Empty, Field, Input, KV, Loading, Modal, PageHeader, Select, Tabs, cx, toast } from '../../components/ui';
import { ScanBox } from '../../components/ScanBox';
import { LinkCardButton } from '../../components/LinkCard';
import { PaymentDialog, type PaymentLine } from '../../components/Payment';
import { CardProfileView } from '../../components/CardProfile';
import { Barcode, QR } from '../../components/Codes';
import { printNode, ReceiptPrint, WristbandPrint } from '../../components/Print';

type Tab = 'sell' | 'booking' | 'topup' | 'member' | 'card' | 'cashout';

export function Counter() {
  const can = useCan();
  const [tab, setTab] = useState<Tab>('sell');
  const shift = useQuery({ queryKey: ['shift-current'], queryFn: () => sapi.get('/api/shifts/current'), enabled: can('shift.open') });
  return (
    <div className="space-y-4">
      <PageHeader title="Ticket Counter / Box Office" actions={shift.data === null && <Link to="/staff/shifts"><Badge tone="amber">Open a shift to accept cash →</Badge></Link>} />
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'sell', label: 'Sell tickets' }, { value: 'booking', label: 'Booking check-in' }, { value: 'topup', label: 'Wallet top-up' },
        { value: 'member', label: 'Membership' }, { value: 'card', label: 'Card lookup' }, { value: 'cashout', label: 'Balance refund' }]} />
      {tab === 'sell' && <SellTickets />}
      {tab === 'booking' && <BookingCheckin />}
      {tab === 'topup' && <TopUp />}
      {tab === 'member' && <MemberDesk />}
      {tab === 'card' && <CardLookup />}
      {tab === 'cashout' && <CashOut />}
    </div>
  );
}

function SellTickets() {
  const branchId = useBranchId();
  const [date, setDate] = useState(today());
  const pkgs = useQuery({ queryKey: ['counter-pkgs', branchId, date], queryFn: () => sapi.get(`/api/public/packages${qs({ branchId, date, channel: 'COUNTER' })}`), enabled: !!branchId });
  const [pkg, setPkg] = useState<any>(null);
  const [guests, setGuests] = useState<Record<string, number>>({});
  const [bundles, setBundles] = useState(1);
  const [member, setMember] = useState<any>(null);
  const [coupon, setCoupon] = useState('');
  const [customer, setCustomer] = useState({ name: '', phone: '' });
  const [booking, setBooking] = useState<any>(null);
  const [paying, setPaying] = useState(false);
  const [busy, setBusy] = useState(false);
  const idem = useMemo(() => newKey(), [pkg, guests, bundles, member, coupon]);
  const body = pkg ? { branchId, packageId: pkg.id, visitDate: date, guests: Object.entries(guests).filter(([, q]) => q > 0).map(([ticketTypeId, qty]) => ({ ticketTypeId, qty })),
    bundles: pkg.pricing_mode === 'BUNDLE' ? bundles : undefined, memberId: member?.member?.id ?? null, couponCode: coupon || null } : null;
  const count = pkg?.pricing_mode === 'BUNDLE' ? bundles : Object.values(guests).reduce((s, n) => s + n, 0);
  const quote = useQuery({ queryKey: ['counter-quote', body], queryFn: () => sapi.post('/api/bookings/quote', body), enabled: !!body && count > 0, retry: false });
  const create = async () => {
    setBusy(true);
    try {
      const b = await sapi.post('/api/bookings', { ...body, customerName: customer.name || member?.customerName || 'Walk-in', phone: customer.phone || member?.member?.phone || '-' }, { idempotencyKey: idem });
      setBooking(b);
      setPaying(true);
    } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  };
  const pay = async (lines: PaymentLine[]) => {
    setBusy(true);
    try {
      for (const l of lines) await sapi.post(`/api/orders/${booking.order_id}/payments`, l, { idempotencyKey: newKey() });
      setPaying(false);
      setBooking(await sapi.get(`/api/bookings/${booking.id}`));
      toast.success('Payment received');
    } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  };
  const reset = () => { setBooking(null); setGuests({}); setMember(null); setCoupon(''); setCustomer({ name: '', phone: '' }); };
  if (booking && booking.paymentStatus === 'PAID') return <IssueWristbands booking={booking} onDone={reset} />;
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
      <div className="space-y-4">
        <Card title="1. Package" actions={<Input type="date" value={date} min={today()} onChange={(e) => setDate(e.target.value)} className="w-auto py-1" />}>
          {pkgs.isLoading ? <Loading /> : (
            <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-4">
              {pkgs.data?.map((p: any) => (
                <button key={p.id} disabled={!p.available.ok} onClick={() => { setPkg(p); setGuests({}); }} className={cx('rounded-xl border-2 p-3 text-left transition disabled:opacity-40', pkg?.id === p.id ? 'border-brand-600 bg-brand-50' : 'border-slate-200 hover:border-slate-300')}>
                  <div className="text-sm font-bold leading-tight">{p.name}</div>
                  <div className="text-xs text-slate-500">{p.pricing_mode === 'BUNDLE' ? thb(p.bundle_price) : p.prices.map((x: any) => `${x.ticket_type_code[0]} ${thb(x.price).replace('.00', '')}`).join(' · ')}</div>
                  {!p.available.ok && <div className="text-[10px] text-rose-600">{p.available.reason}</div>}
                </button>
              ))}
            </div>
          )}
        </Card>
        {pkg && (
          <Card title="2. Guests">
            {pkg.pricing_mode === 'BUNDLE' ? <Qty label={`${pkg.name} bundle`} price={pkg.bundle_price} value={bundles} onChange={(v) => setBundles(Math.max(1, v))} />
              : pkg.prices.map((p: any) => <Qty key={p.ticket_type_id} label={p.ticket_type_name} price={member && p.member_price ? p.member_price : p.price} value={guests[p.ticket_type_id] ?? 0} onChange={(v) => setGuests({ ...guests, [p.ticket_type_id]: Math.max(0, v) })} />)}
          </Card>
        )}
        <Card title="3. Customer (optional)">
          <div className="space-y-3">
            {member ? (
              <div className="flex items-center justify-between rounded-lg bg-brand-50 p-3 text-sm"><span><b>{member.customerName}</b> · {member.member?.member_code} · {member.member?.tier_name ?? 'Basic'}</span><Button size="xs" variant="ghost" onClick={() => setMember(null)}>Remove</Button></div>
            ) : <ScanBox compact global={false} placeholder="Scan member card for member price & points" onScan={async (c) => { try { const p = await sapi.post('/api/credentials/scan', { scan: c }); if (!p.member) throw new Error('Not a member card'); setMember(p); } catch (e) { toast.error(errorMessage(e)); } }} />}
            <div className="grid grid-cols-2 gap-3"><Input placeholder="Name" value={customer.name} onChange={(e) => setCustomer({ ...customer, name: e.target.value })} /><Input placeholder="Phone" value={customer.phone} onChange={(e) => setCustomer({ ...customer, phone: e.target.value })} /></div>
            <Input placeholder="Coupon code" value={coupon} onChange={(e) => setCoupon(e.target.value.toUpperCase())} />
          </div>
        </Card>
      </div>
      <Card title="Order" className="h-fit lg:sticky lg:top-0">
        {quote.isFetching && <Loading label="" />}
        {quote.error && <div className="text-sm text-rose-600">{errorMessage(quote.error)}</div>}
        {quote.data ? (
          <div className="space-y-1 text-sm">
            {quote.data.items.map((i: any, idx: number) => <div key={idx} className="flex justify-between"><span>{i.qty} × {i.name}</span><span>{thb(i.unitPrice * i.qty)}</span></div>)}
            {quote.data.promotions.map((p: any, idx: number) => <div key={idx} className="flex justify-between text-emerald-600"><span>{p.name}</span><span>-{thb(p.discount)}</span></div>)}
            {quote.data.rejectedCoupon && <div className="text-xs text-rose-600">{quote.data.rejectedCoupon}</div>}
            <div className="flex justify-between border-t pt-2 text-2xl font-black"><span>Total</span><span>{thb(quote.data.total)}</span></div>
            <Button block size="lg" className="mt-3" onClick={create} loading={busy} disabled={!quote.data}>Charge {thb(quote.data.total)}</Button>
          </div>
        ) : <Empty title="Select package & guests" />}
      </Card>
      {booking && <PaymentDialog open={paying} onClose={() => setPaying(false)} total={booking.total - booking.paid_total} onConfirm={pay} busy={busy}
        credential={member ? { id: member.credential.id, code: member.credential.code, walletBalance: member.wallet?.balance, memberPoints: member.member?.points } : null} title={`Payment · ${booking.booking_no}`} />}
    </div>
  );
}

function Qty({ label, price, value, onChange }: { label: string; price: number; value: number; onChange: (v: number) => void }) {
  return (
    <div className="flex items-center justify-between border-b border-slate-100 py-2 last:border-0">
      <div><div className="font-medium">{label}</div><div className="text-xs text-slate-500">{thb(price)}</div></div>
      <div className="flex items-center gap-2">
        <button onClick={() => onChange(value - 1)} className="rounded-lg bg-slate-100 p-2"><Minus className="h-4 w-4" /></button>
        <input value={value} onChange={(e) => onChange(Number(e.target.value.replace(/\D/g, '') || 0))} className="w-12 rounded-lg border border-slate-200 py-1 text-center text-lg font-bold" />
        <button onClick={() => onChange(value + 1)} className="rounded-lg bg-brand-600 p-2 text-white"><Plus className="h-4 w-4" /></button>
      </div>
    </div>
  );
}

/** Issue / bind wristbands for every ticket of a paid booking, then print. */
function IssueWristbands({ booking, onDone }: { booking: any; onDone: () => void }) {
  const [assign, setAssign] = useState<Record<string, { mode: 'GENERATE' | 'SCAN' | 'MEMBER_CARD'; scan?: string; heightCm?: string; guestName?: string }>>(
    Object.fromEntries(booking.tickets.filter((t: any) => t.status === 'ACTIVE').map((t: any) => [t.id, { mode: 'GENERATE' }])));
  const [issued, setIssued] = useState<any[] | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      const r = await sapi.post(`/api/bookings/${booking.id}/checkin`, { assignments: Object.entries(assign).map(([ticketId, a]) => ({ ticketId, mode: a.mode, scan: a.scan || undefined, heightCm: a.heightCm ? Number(a.heightCm) : undefined, guestName: a.guestName || undefined })) });
      setIssued(r);
      toast.success(`${r.length} wristband(s) activated`);
    } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  };
  const printAll = async () => {
    for (const w of issued ?? []) { const d = await sapi.get(`/api/print/wristband/${w.credentialId}`); printNode(<WristbandPrint w={d} />); await new Promise((r) => setTimeout(r, 1200)); }
  };
  if (issued) return (
    <Card title={`Wristbands issued · ${booking.booking_no}`} actions={<><Button variant="outline" icon={<Printer className="h-4 w-4" />} onClick={printAll}>Print wristbands</Button>
      <Button variant="outline" onClick={async () => printNode(<ReceiptPrint d={await sapi.get(`/api/print/receipt/${booking.order_id}`)} />)}>Receipt</Button><Button onClick={onDone}>New sale</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {issued.map((w) => (
          <div key={w.credentialId} className="flex items-center gap-3 rounded-xl border border-slate-200 p-3">
            <QR value={w.qr} size={90} />
            <div className="text-sm"><div className="font-mono font-bold">{w.code}</div><div>{w.ticketType} · {w.packageName}</div><div className="text-xs text-slate-500">{fmtDate(w.visitDate)} · {w.ticketCode}</div><Barcode value={w.barcode} height={28} width={1} displayValue={false} /></div>
          </div>
        ))}
      </div>
    </Card>
  );
  return (
    <Card title={`Issue wristbands · ${booking.booking_no}`} actions={<Button onClick={submit} loading={busy}>Activate & bind</Button>}>
      <div className="space-y-2">
        {booking.tickets.filter((t: any) => t.status === 'ACTIVE').map((t: any) => {
          const a = assign[t.id];
          return (
            <div key={t.id} className="grid items-center gap-2 rounded-xl border border-slate-200 p-3 md:grid-cols-[1fr_170px_1fr_90px_140px]">
              <div className="text-sm"><b>{t.ticket_type}</b> · <span className="font-mono text-xs">{t.ticket_code}</span>{t.wristbands?.length ? <div className="text-xs text-amber-600">has {t.wristbands.map((w: any) => w.code).join(', ')}</div> : null}</div>
              <Select value={a.mode} onChange={(e) => setAssign({ ...assign, [t.id]: { ...a, mode: e.target.value as any } })}>
                <option value="GENERATE">Print new wristband</option><option value="SCAN">Scan pre-printed band</option><option value="MEMBER_CARD">Use member card</option>
              </Select>
              {a.mode !== 'GENERATE' ? <Input data-scan-capture="1" placeholder="Scan / type band serial" value={a.scan ?? ''} onChange={(e) => setAssign({ ...assign, [t.id]: { ...a, scan: e.target.value } })} /> : <div className="text-xs text-slate-400">New WB-… code will be generated</div>}
              <Input placeholder="Height cm" value={a.heightCm ?? ''} onChange={(e) => setAssign({ ...assign, [t.id]: { ...a, heightCm: e.target.value.replace(/\D/g, '') } })} />
              <Input placeholder="Guest name" value={a.guestName ?? ''} onChange={(e) => setAssign({ ...assign, [t.id]: { ...a, guestName: e.target.value } })} />
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function BookingCheckin() {
  const [booking, setBooking] = useState<any>(null);
  const [paying, setPaying] = useState(false);
  const [busy, setBusy] = useState(false);
  const qc = useQueryClient();
  const load = async (scan: string) => { try { setBooking(await sapi.post('/api/bookings/scan', { scan })); } catch (e) { toast.error(errorMessage(e)); } };
  const pay = async (lines: PaymentLine[]) => {
    setBusy(true);
    try { for (const l of lines) await sapi.post(`/api/orders/${booking.order_id}/payments`, l, { idempotencyKey: newKey() }); setPaying(false); setBooking(await sapi.get(`/api/bookings/${booking.id}`)); qc.invalidateQueries(); }
    catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  };
  if (booking && booking.paymentStatus === 'PAID' && ['CONFIRMED', 'CHECKED_IN'].includes(booking.status)) {
    return <div className="space-y-3"><Button variant="ghost" onClick={() => setBooking(null)}>← Scan another booking</Button><BookingSummary b={booking} /><IssueWristbands booking={booking} onDone={() => setBooking(null)} /></div>;
  }
  return (
    <div className="space-y-4">
      <Card><ScanBox onScan={load} placeholder="Scan booking barcode / QR or type BK-…" autoFocus /></Card>
      {booking && <>
        <BookingSummary b={booking} />
        {booking.paymentStatus !== 'PAID' && ['RESERVED', 'PENDING_PAYMENT', 'PENDING_VERIFICATION'].includes(booking.status) && (
          <Card className="border-amber-300 bg-amber-50"><div className="flex items-center justify-between"><div><div className="font-bold text-amber-800">Outstanding {thb(booking.total - booking.paid_total)}</div><div className="text-sm text-amber-700">RESERVED — PAYMENT PENDING</div></div>
            <Button size="lg" onClick={() => setPaying(true)}>Receive payment</Button></div></Card>
        )}
        <PaymentDialog open={paying} onClose={() => setPaying(false)} total={booking.total - booking.paid_total} onConfirm={pay} busy={busy} title={`Payment · ${booking.booking_no}`} />
      </>}
    </div>
  );
}

function BookingSummary({ b }: { b: any }) {
  return (
    <Card>
      <div className="grid gap-x-8 md:grid-cols-2">
        <KV k="Booking No." v={<span className="font-mono">{b.booking_no}</span>} /><KV k="Status" v={<Badge>{b.status}</Badge>} />
        <KV k="Customer" v={b.customer_name} /><KV k="Phone" v={b.phone} />
        <KV k="Package" v={b.items.filter((i: any) => i.item_type === 'PACKAGE').map((i: any) => `${i.qty}× ${i.name}`).join(', ')} /><KV k="Visit date" v={fmtDate(b.visit_date)} />
        <KV k="Guests" v={b.guests} /><KV k="Amount" v={thb(b.total)} /><KV k="Payment" v={<Badge>{b.paymentStatus}</Badge>} />{b.member_code && <KV k="Member" v={b.member_code} />}
      </div>
    </Card>
  );
}

function TopUp() {
  const [profile, setProfile] = useState<any>(null);
  const [amount, setAmount] = useState(30000);
  const [custom, setCustom] = useState('');
  const [paying, setPaying] = useState(false);
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState<any>(null);
  const value = custom ? toSatang(custom) : amount;
  const pay = async (lines: PaymentLine[]) => {
    setBusy(true);
    try {
      const r = await sapi.post('/api/wallet/topup', { credentialId: profile.credential.id, amount: value, payments: lines }, { idempotencyKey: newKey() });
      setLast(r); setPaying(false); setProfile(await sapi.get(`/api/credentials/${profile.credential.id}`)); toast.success(`New balance ${thb(r.balance)}`);
    } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  };
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
      <div className="space-y-4">
        <Card><ScanBox onScan={async (c) => { try { setProfile(await sapi.post('/api/credentials/scan', { scan: c })); setLast(null); } catch (e) { toast.error(errorMessage(e)); } }} autoFocus /></Card>
        {profile && <Card><div className="flex items-center justify-between"><div><div className="font-mono font-bold">{profile.credential.code}</div><div className="text-sm text-slate-500">{profile.customerName ?? 'Guest'}</div></div>
          <div className="text-right"><div className="text-xs text-slate-500">Current Balance</div><div className="text-3xl font-black text-violet-700">{thb(profile.wallet?.balance ?? 0)}</div></div></div></Card>}
        {last && <Card className="border-emerald-300 bg-emerald-50"><div className="text-lg font-bold text-emerald-700">✓ TOP UP {thb(last.amount)} — New Balance {thb(last.balance)}</div>{last.change > 0 && <div>Change {thb(last.change)}</div>}</Card>}
      </div>
      <Card title="Amount">
        <div className="grid grid-cols-2 gap-2">{[10000, 30000, 50000, 100000].map((a) => <button key={a} onClick={() => { setAmount(a); setCustom(''); }} className={cx('rounded-xl border-2 p-4 text-xl font-black', !custom && amount === a ? 'border-brand-600 bg-brand-50' : 'border-slate-200')}>{thb(a).replace('.00', '')}</button>)}</div>
        <Field label="Custom" className="mt-3"><Input inputMode="decimal" value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="฿" /></Field>
        <Button block size="lg" className="mt-3" disabled={!profile || profile.credential.status !== 'ACTIVE' || value <= 0} onClick={() => setPaying(true)} icon={<Wallet className="h-5 w-5" />}>TOP UP {thb(value)}</Button>
      </Card>
      <PaymentDialog open={paying} onClose={() => setPaying(false)} total={value} onConfirm={pay} busy={busy} allowed={['CASH', 'PROMPTPAY', 'CARD', 'DEBIT', 'EWALLET']} title="Top-up payment" />
    </div>
  );
}

function MemberDesk() {
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<any>(null);
  const [registering, setRegistering] = useState(false);
  const [f, setF] = useState<Record<string, string>>({});
  const [product, setProduct] = useState('');
  const [mode, setMode] = useState<'NEW' | 'RENEWAL' | 'UPGRADE'>('NEW');
  const [physical, setPhysical] = useState(false);
  const [cardScan, setCardScan] = useState('');
  const [paying, setPaying] = useState(false);
  const [busy, setBusy] = useState(false);
  const list = useQuery({ queryKey: ['members', q], queryFn: () => sapi.get(`/api/members${qs({ q })}`), enabled: q.length >= 2 });
  const products = useQuery({ queryKey: ['mprods'], queryFn: () => sapi.get('/api/public/membership-products') });
  const p = products.data?.find((x: any) => x.id === product);
  const price = p ? (mode === 'RENEWAL' ? p.renewal_price ?? p.annual_fee : p.annual_fee + (mode === 'NEW' ? p.registration_fee : 0)) + (physical ? p.physical_card_fee : 0) : 0;
  const register = async () => {
    setBusy(true);
    try {
      const r = await sapi.post('/api/members', { ...f, birthday: f.birthday || null, email: f.email || null });
      toast.success(`Member ${r.member.member_code}`);
      if (cardScan.trim()) {
        try { const l = await sapi.post(`/api/members/${r.member.id}/link-card`, { scan: cardScan.trim() }); toast.success(`Card linked: ${l.credential.physicalSerial ?? l.credential.code}`); }
        catch (e) { toast.error(errorMessage(e)); }
      }
      setSelected(await sapi.get(`/api/members/${r.member.id}`)); setRegistering(false); setF({}); setCardScan('');
    }
    catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  };
  const sell = async (lines: PaymentLine[]) => {
    setBusy(true);
    try { const r = await sapi.post(`/api/members/${selected.id}/membership`, { membershipProductId: product, mode, physicalCard: physical, payments: lines }, { idempotencyKey: newKey() }); setSelected({ ...selected, ...r.member }); setPaying(false); toast.success('Membership activated'); }
    catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  };
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title="Find member" actions={<Button size="sm" icon={<UserPlus className="h-4 w-4" />} onClick={() => setRegistering(true)}>Register</Button>}>
        <div className="relative"><Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" /><Input className="pl-9" placeholder="Phone / email / member ID / name" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <div className="mt-2 divide-y divide-slate-100">{list.data?.map((m: any) => <button key={m.id} onClick={async () => setSelected(await sapi.get(`/api/members/${m.id}`))} className="flex w-full justify-between py-2 text-left text-sm hover:bg-slate-50"><span><b>{m.first_name} {m.last_name}</b> · {m.phone}</span><span>{m.member_code} <Badge>{m.tier_name ?? 'BASIC'}</Badge></span></button>)}</div>
      </Card>
      {selected ? (
        <Card title={`${selected.first_name} ${selected.last_name} · ${selected.member_code}`}>
          <KV k="Tier" v={selected.tier_name ?? 'Basic'} /><KV k="Membership" v={selected.membership ? `${selected.membership.product_name} → ${selected.membership.end_date ? fmtDate(selected.membership.end_date) : 'Lifetime'}` : '—'} />
          <KV k="Points" v={selected.points} /><KV k="Wallet" v={thb(selected.wallet_balance)} />
          <KV k="Cards" v={selected.credentials?.filter((c: any) => c.status === 'ACTIVE' && c.type !== 'DIGITAL_CARD').map((c: any) => c.physical_serial ?? c.code).join(', ') || '—'} />
          <div className="mt-2"><LinkCardButton memberId={selected.id} block onLinked={async () => setSelected(await sapi.get(`/api/members/${selected.id}`))} /></div>
          <div className="mt-4 space-y-2 rounded-xl bg-slate-50 p-3">
            <div className="text-sm font-semibold">Sell membership</div>
            <div className="grid grid-cols-2 gap-2">
              <Select value={product} onChange={(e) => setProduct(e.target.value)}><option value="">Product…</option>{products.data?.map((x: any) => <option key={x.id} value={x.id}>{x.name} · {thb(x.annual_fee)}</option>)}</Select>
              <Select value={mode} onChange={(e) => setMode(e.target.value as any)}><option value="NEW">New</option><option value="RENEWAL">Renewal</option><option value="UPGRADE">Upgrade</option></Select>
            </div>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={physical} onChange={(e) => setPhysical(e.target.checked)} /> Issue a NEW physical member card {p ? `(${thb(p.physical_card_fee)})` : ''} — not needed when the customer's own card is linked</label>
            <Button block disabled={!product} onClick={() => setPaying(true)} icon={<CreditCard className="h-4 w-4" />}>Charge ~{thb(price)}</Button>
            <div className="text-xs text-slate-500">Final price (proration / early renewal) is computed by the server.</div>
          </div>
          <PaymentDialog open={paying} onClose={() => setPaying(false)} total={price} onConfirm={sell} busy={busy} title="Membership payment" />
        </Card>
      ) : <Card><Empty title="Select or register a member" /></Card>}
      <Modal open={registering} onClose={() => setRegistering(false)} title="Register member" footer={<Button onClick={register} loading={busy}>Register</Button>}>
        <div className="grid grid-cols-2 gap-3">
          {[['firstName', 'First name *'], ['lastName', 'Last name'], ['phone', 'Phone *'], ['email', 'Email'], ['birthday', 'Birthday']].map(([k, l]) => (
            <Field key={k} label={l}><Input type={k === 'birthday' ? 'date' : 'text'} value={f[k] ?? ''} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></Field>
          ))}
          <Field label="Existing card (scan to link — optional)" className="col-span-2">
            <ScanBox compact global={false} placeholder={cardScan ? `Card: ${cardScan}` : 'Scan / type the card number'} onScan={(c) => { setCardScan(c); toast.info(`Card captured: ${c}`); }} />
          </Field>
        </div>
      </Modal>
    </div>
  );
}

function CardLookup() {
  const [profile, setProfile] = useState<any>(null);
  const q = useQuery({ queryKey: ['card', profile?.credential.id], queryFn: () => sapi.get(`/api/credentials/${profile.credential.id}`), enabled: !!profile, initialData: profile });
  return (
    <div className="space-y-4">
      <Card><ScanBox onScan={async (c) => { try { setProfile(await sapi.post('/api/credentials/scan', { scan: c })); } catch (e) { toast.error(errorMessage(e)); } }} autoFocus /></Card>
      {q.data && <CardProfileView profile={q.data} actions={<Link to={`/staff/cards?id=${q.data.credential.id}`}><Button size="sm" variant="outline" icon={<QrCode className="h-4 w-4" />}>Manage card</Button></Link>} />}
    </div>
  );
}

function CashOut() {
  const [profile, setProfile] = useState<any>(null);
  const [scan, setScan] = useState('');
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try { const r = await sapi.post('/api/wallet/cashout', { scan, method: 'CASH' }, { idempotencyKey: newKey() }); toast.success(`Paid out ${thb(r.paidOut)}${r.fee ? ` (fee ${thb(r.fee)})` : ''}`); setProfile(await sapi.post('/api/credentials/scan', { scan })); }
    catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  };
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title="Remaining balance refund"><ScanBox onScan={async (c) => { try { setScan(c); setProfile(await sapi.post('/api/credentials/scan', { scan: c })); } catch (e) { toast.error(errorMessage(e)); } }} />
        <div className="mt-2 text-xs text-slate-500">Policy is configured in Settings → Wallet (refundable / partial / non-refundable / transfer to member / keep).</div></Card>
      {profile && <Card><div className="text-sm text-slate-500">{profile.credential.code} · {profile.customerName ?? 'Guest'}</div><div className="text-sm">Remaining Balance</div><div className="text-4xl font-black text-violet-700">{thb(profile.wallet?.balance ?? 0)}</div>
        <Button className="mt-3" variant="danger" onClick={run} loading={busy} disabled={!profile.wallet?.balance} icon={<Ticket className="h-4 w-4" />}>Refund balance in cash</Button></Card>}
    </div>
  );
}
