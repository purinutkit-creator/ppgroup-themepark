import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, CheckCircle2, FerrisWheel, Home, Loader2, Minus, Plus, Printer, Search, Ticket, UserPlus, Utensils, Wallet } from 'lucide-react';
import { papi, sapi, errorMessage, newKey } from '../../lib/api';
import { useKeyboardScanner } from '../../lib/scanner';
import { useRealtime } from '../../lib/socket';
import { LANGS, useLang, useT } from '../../lib/i18n';
import { fmtDate, thb, today, toSatang } from '../../lib/format';
import { useSurfaceFont, usePublicConfig } from '../../lib/config';
import { CameraScanner } from '../../components/CameraScanner';
import { QR } from '../../components/Codes';
import { printNode, TicketsPrint } from '../../components/Print';
import { Badge, cx, toast } from '../../components/ui';
import { DeviceGuard } from './DeviceShell';

type Screen = 'home' | 'card' | 'topup' | 'ticket' | 'food' | 'rides' | 'register';

export function Kiosk() { return <DeviceGuard need="KIOSK"><KioskInner /></DeviceGuard>; }

function KioskInner() {
  useSurfaceFont('kiosk');
  const t = useT();
  const { lang, setLang } = useLang();
  const [screen, setScreen] = useState<Screen>('home');
  const idle = useRef<number | null>(null);
  useEffect(() => {
    const reset = () => { if (idle.current) clearTimeout(idle.current); idle.current = window.setTimeout(() => setScreen('home'), 90_000); };
    reset();
    window.addEventListener('pointerdown', reset);
    return () => { window.removeEventListener('pointerdown', reset); if (idle.current) clearTimeout(idle.current); };
  }, []);
  const tiles: Array<{ s: Screen; icon: any; label: string; color: string }> = [
    { s: 'ticket', icon: Ticket, label: t('buyTickets'), color: 'from-brand-500 to-brand-700' },
    { s: 'topup', icon: Wallet, label: t('topup'), color: 'from-violet-500 to-violet-700' },
    { s: 'card', icon: Search, label: `${t('checkBalance')} / ${t('tickets')} / ${t('checkQueue')}`, color: 'from-sky-500 to-sky-700' },
    { s: 'food', icon: Utensils, label: t('buyFood'), color: 'from-orange-500 to-rose-600' },
    { s: 'rides', icon: FerrisWheel, label: t('rideStatus'), color: 'from-emerald-500 to-emerald-700' },
    { s: 'register', icon: UserPlus, label: t('register'), color: 'from-amber-500 to-amber-600' },
  ];
  return (
    <div className="flex h-full flex-col bg-slate-100">
      <header className="flex items-center justify-between bg-white px-6 py-4 shadow-sm">
        <button onClick={() => setScreen('home')} className="flex items-center gap-3 text-2xl font-black"><span className="text-3xl">🎡</span>{t('appName')}</button>
        <div className="flex gap-2">{LANGS.map((l) => <button key={l.code} onClick={() => setLang(l.code)} className={cx('rounded-xl px-3 py-2 text-lg font-semibold', lang === l.code ? 'bg-brand-600 text-white' : 'bg-slate-100')}>{l.flag} {l.label}</button>)}</div>
      </header>
      <main className="flex-1 overflow-y-auto p-6">
        {screen !== 'home' && <button onClick={() => setScreen('home')} className="mb-4 flex items-center gap-2 rounded-xl bg-white px-4 py-3 text-lg font-semibold shadow-sm"><ArrowLeft className="h-5 w-5" />{t('back')}</button>}
        {screen === 'home' && (
          <div className="mx-auto grid max-w-5xl grid-cols-2 gap-5 lg:grid-cols-3">
            {tiles.map((x) => (
              <button key={x.s} onClick={() => setScreen(x.s)} className={cx('flex aspect-[4/3] flex-col items-center justify-center gap-4 rounded-3xl bg-gradient-to-br p-6 text-white shadow-lg active:scale-[0.98]', x.color)}>
                <x.icon className="h-16 w-16" /><span className="text-center text-2xl font-bold">{x.label}</span>
              </button>
            ))}
          </div>
        )}
        {screen === 'card' && <CardCheck />}
        {screen === 'topup' && <KioskTopup done={() => setScreen('home')} />}
        {screen === 'ticket' && <KioskTicket done={() => setScreen('home')} />}
        {screen === 'food' && <KioskFood done={() => setScreen('home')} />}
        {screen === 'rides' && <KioskRides />}
        {screen === 'register' && <KioskRegister done={() => setScreen('home')} />}
      </main>
    </div>
  );
}

function ScanPrompt({ onScan, title }: { onScan: (c: string) => void; title?: string }) {
  const t = useT();
  useKeyboardScanner(onScan);
  return (
    <div className="mx-auto max-w-xl space-y-4 text-center">
      <div className="text-3xl font-bold">{title ?? t('scanCard')}</div>
      <CameraScanner className="aspect-square w-full rounded-3xl" onScan={onScan} facing="user" />
    </div>
  );
}

function CardCheck() {
  const t = useT();
  const [info, setInfo] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const scan = async (code: string) => { setBusy(true); try { setInfo(await sapi.post('/api/kiosk/card', { code })); } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); } };
  if (busy) return <div className="flex justify-center p-20"><Loader2 className="h-16 w-16 animate-spin text-brand-600" /></div>;
  if (!info) return <ScanPrompt onScan={scan} />;
  return (
    <div className="mx-auto grid max-w-4xl gap-4 md:grid-cols-2">
      <div className="rounded-3xl bg-gradient-to-br from-slate-900 to-brand-900 p-6 text-white md:col-span-2">
        <div className="font-mono text-xl">{info.credential.code}</div><div className="text-2xl font-bold">{info.customerName ?? 'Guest'}</div>
        <div className="mt-3 text-sm text-white/70">{t('balance')}</div><div className="text-5xl font-black">{thb(info.wallet?.balance ?? 0)}</div>
        {info.member && <div className="mt-2 text-amber-300">{info.member.tier ?? 'Member'} · {info.member.points} {t('points')}</div>}
        <Badge className="mt-2">{info.credential.status}</Badge>
      </div>
      <div className="rounded-3xl bg-white p-5"><div className="mb-2 text-xl font-bold">{t('tickets')}</div>
        {info.tickets.map((tk: any) => <div key={tk.id} className="mb-2 rounded-xl bg-slate-50 p-3"><b>{tk.package}</b> · {tk.ticketType}<div className="text-sm text-slate-500">{fmtDate(tk.validFrom)} · <Badge>{tk.presence === 'INSIDE' ? 'INSIDE' : tk.status}</Badge></div></div>)}
        <div className="mt-2 flex flex-wrap gap-1">{info.entitlements.map((e: any) => <Badge key={e.id} tone="green">{e.ride}{e.usesRemaining != null ? ` ×${e.usesRemaining}` : ''}</Badge>)}</div>
      </div>
      <div className="rounded-3xl bg-white p-5"><div className="mb-2 text-xl font-bold">{t('checkQueue')}</div>
        {info.queues.length ? info.queues.map((q: any) => <div key={q.id} className="mb-2 flex items-center justify-between rounded-xl bg-slate-50 p-3"><span>{q.ride_name}</span><span className="text-2xl font-black">{q.queue_no}</span><Badge>{q.status}</Badge></div>) : <div className="text-slate-400">—</div>}
        {info.lockers.map((l: any) => <div key={l.id} className="mt-2 text-sm">🔒 Locker {l.locker_code}</div>)}
      </div>
    </div>
  );
}

function KioskTopup({ done }: { done: () => void }) {
  const t = useT();
  const cfg = usePublicConfig();
  const [code, setCode] = useState<string | null>(null);
  const [info, setInfo] = useState<any>(null);
  const [amount, setAmount] = useState(30000);
  const [pay, setPay] = useState<any>(null);
  const [paid, setPaid] = useState<number | null>(null);
  useEffect(() => {
    if (!pay) return;
    const i = setInterval(async () => {
      const p = await papi.get(`/api/public/payments/${pay.paymentId}`).catch(() => null);
      if (p?.status === 'PAID') { clearInterval(i); const c = await sapi.post('/api/kiosk/card', { code }); setPaid(c.wallet.balance); }
    }, 2000);
    return () => clearInterval(i);
  }, [pay, code]);
  if (!code) return <ScanPrompt onScan={async (c) => { try { setInfo(await sapi.post('/api/kiosk/card', { code: c })); setCode(c); } catch (e) { toast.error(errorMessage(e)); } }} />;
  if (paid != null) return <Success title={t('paymentSuccess')} sub={`${t('balance')} ${thb(paid)}`} done={done} />;
  if (pay) return (
    <div className="mx-auto max-w-md space-y-3 rounded-3xl bg-white p-8 text-center">
      <div className="text-2xl font-bold">{t('scanToPay')}</div><QR value={pay.qrPayload} size={280} className="mx-auto" /><div className="text-4xl font-black">{thb(pay.amount)}</div>
      <div className="flex items-center justify-center gap-2 text-slate-500"><Loader2 className="h-5 w-5 animate-spin" />Waiting for payment…</div>
      {cfg.data?.simulator && <button className="text-sm underline" onClick={() => papi.post(`/api/public/payments/${pay.paymentId}/simulate`, { outcome: 'SUCCESS' })}>simulate (dev)</button>}
    </div>
  );
  return (
    <div className="mx-auto max-w-2xl space-y-5 rounded-3xl bg-white p-8">
      <div className="text-center"><div className="text-slate-500">{info.credential.code}</div><div className="text-xl">{t('balance')}</div><div className="text-5xl font-black text-violet-700">{thb(info.wallet?.balance ?? 0)}</div></div>
      <div className="grid grid-cols-2 gap-3">{[10000, 30000, 50000, 100000].map((a) => <button key={a} onClick={() => setAmount(a)} className={cx('rounded-2xl border-4 p-6 text-3xl font-black', amount === a ? 'border-brand-600 bg-brand-50' : 'border-slate-200')}>{thb(a)}</button>)}</div>
      <input inputMode="decimal" className="w-full rounded-2xl border-2 border-slate-200 p-4 text-center text-2xl" placeholder="Custom ฿" onChange={(e) => e.target.value && setAmount(toSatang(e.target.value))} />
      <button onClick={async () => { try { setPay(await sapi.post('/api/kiosk/topup', { code, amount, method: 'PROMPTPAY' })); } catch (e) { toast.error(errorMessage(e)); } }} className="w-full rounded-2xl bg-brand-600 p-5 text-2xl font-bold text-white">PromptPay {thb(amount)}</button>
    </div>
  );
}

function KioskTicket({ done }: { done: () => void }) {
  const t = useT();
  const cfg = usePublicConfig();
  const branches = useQuery({ queryKey: ['pub-branches'], queryFn: () => papi.get('/api/public/branches') });
  const branchId = branches.data?.[0]?.id;
  const pkgs = useQuery({ queryKey: ['kiosk-pkgs', branchId], queryFn: () => sapi.get(`/api/public/packages?branchId=${branchId}&date=${today()}&channel=KIOSK`), enabled: !!branchId });
  const [pkg, setPkg] = useState<any>(null);
  const [guests, setGuests] = useState<Record<string, number>>({});
  const [phone, setPhone] = useState('');
  const [booking, setBooking] = useState<any>(null);
  const [pay, setPay] = useState<any>(null);
  const [confirmed, setConfirmed] = useState<any>(null);
  const idem = useMemo(() => newKey(), [pkg]);
  useRealtime([booking ? `booking:${booking.id}` : null], {
    'booking.updated': async (e) => { if (e.status === 'CONFIRMED' || e.paymentStatus === 'PAID') setConfirmed(await papi.get(`/api/public/bookings/${booking.booking_no}?token=${booking.token}`)); },
  }, { ctx: 'public', bookingToken: booking?.token });
  const total = pkg ? pkg.prices.reduce((s: number, p: any) => s + (guests[p.ticket_type_id] ?? 0) * p.price, 0) : 0;
  if (confirmed) return (
    <div className="mx-auto max-w-3xl space-y-4 text-center">
      <Success title={t('paymentSuccess')} sub={confirmed.booking_no} done={done} />
      <div className="grid gap-3 sm:grid-cols-2">{confirmed.tickets.map((tk: any) => <div key={tk.id} className="rounded-2xl bg-white p-4"><QR value={tk.qr} size={160} className="mx-auto" /><div className="font-bold">{tk.ticket_type}</div><div className="font-mono text-xs">{tk.ticket_code}</div></div>)}</div>
      <button onClick={() => printNode(<TicketsPrint d={{ parkName: cfg.data?.park.name, tickets: confirmed.tickets }} />)} className="mx-auto flex items-center gap-2 rounded-2xl bg-slate-900 px-8 py-4 text-xl font-bold text-white"><Printer />{t('print')}</button>
    </div>
  );
  if (pay) return (
    <div className="mx-auto max-w-md space-y-3 rounded-3xl bg-white p-8 text-center">
      <div className="text-2xl font-bold">{t('scanToPay')}</div><QR value={pay.qrPayload} size={280} className="mx-auto" /><div className="text-4xl font-black">{thb(pay.amount)}</div>
      <div className="flex items-center justify-center gap-2 text-slate-500"><Loader2 className="h-5 w-5 animate-spin" />{booking.booking_no}</div>
      {cfg.data?.simulator && <button className="text-sm underline" onClick={() => papi.post(`/api/public/payments/${pay.paymentId}/simulate`, { outcome: 'SUCCESS' })}>simulate (dev)</button>}
    </div>
  );
  if (!pkg) return (
    <div className="mx-auto grid max-w-5xl gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {pkgs.data?.filter((p: any) => p.pricing_mode === 'PER_GUEST' && p.available.ok).map((p: any) => (
        <button key={p.id} onClick={() => setPkg(p)} className="rounded-3xl bg-white p-6 text-left shadow-sm"><div className="text-2xl font-bold">{p.name}</div><div className="text-slate-500">{p.description}</div>
          <div className="mt-3 text-3xl font-black text-brand-700">{thb(Math.min(...p.prices.map((x: any) => x.price)))}+</div></button>
      ))}
    </div>
  );
  return (
    <div className="mx-auto max-w-2xl space-y-4 rounded-3xl bg-white p-8">
      <div className="text-3xl font-bold">{pkg.name}</div>
      {pkg.prices.map((p: any) => (
        <div key={p.ticket_type_id} className="flex items-center justify-between border-b py-4 text-2xl">
          <div><div className="font-semibold">{p.ticket_type_name}</div><div className="text-lg text-slate-500">{thb(p.price)}</div></div>
          <div className="flex items-center gap-4">
            <button onClick={() => setGuests({ ...guests, [p.ticket_type_id]: Math.max(0, (guests[p.ticket_type_id] ?? 0) - 1) })} className="rounded-full bg-slate-100 p-3"><Minus /></button>
            <span className="w-8 text-center font-black">{guests[p.ticket_type_id] ?? 0}</span>
            <button onClick={() => setGuests({ ...guests, [p.ticket_type_id]: (guests[p.ticket_type_id] ?? 0) + 1 })} className="rounded-full bg-brand-600 p-3 text-white"><Plus /></button>
          </div>
        </div>
      ))}
      <input inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value.replace(/\D/g, ''))} placeholder={t('phone')} className="w-full rounded-2xl border-2 border-slate-200 p-4 text-2xl" />
      <button disabled={!total || phone.length < 9} onClick={async () => {
        try {
          const b = await sapi.post('/api/public/bookings', { branchId, packageId: pkg.id, visitDate: today(), guests: Object.entries(guests).filter(([, q]) => q > 0).map(([ticketTypeId, qty]) => ({ ticketTypeId, qty })),
            customerName: 'Kiosk Guest', phone, paymentMode: 'PAY_NOW', channel: 'KIOSK' }, { idempotencyKey: idem });
          setBooking(b);
          setPay(await papi.post(`/api/public/bookings/${b.booking_no}/pay`, { token: b.token, method: 'PROMPTPAY' }));
        } catch (e) { toast.error(errorMessage(e)); }
      }} className="w-full rounded-2xl bg-brand-600 p-5 text-2xl font-bold text-white disabled:opacity-40">{t('payNow')} {thb(total)}</button>
    </div>
  );
}

function KioskFood({ done }: { done: () => void }) {
  const t = useT();
  const branches = useQuery({ queryKey: ['pub-branches'], queryFn: () => papi.get('/api/public/branches') });
  const stores = useQuery({ queryKey: ['kiosk-stores', branches.data?.[0]?.id], queryFn: () => papi.get(`/api/public/stores?branchId=${branches.data[0].id}&type=RESTAURANT`), enabled: !!branches.data?.[0] });
  const [store, setStore] = useState<string | null>(null);
  const menu = useQuery({ queryKey: ['menu', store], queryFn: () => papi.get(`/api/public/menu?storeId=${store}`), enabled: !!store });
  const [cart, setCart] = useState<Record<string, number>>({});
  const [scan, setScan] = useState(false);
  const [result, setResult] = useState<any>(null);
  const items = menu.data?.products.filter((p: any) => !(p.modifiers?.length && p.modifiers.some((g: any) => g.required))) ?? [];
  const total = items.reduce((s: number, p: any) => s + (cart[p.id] ?? 0) * p.price, 0);
  if (result) return <Success title={`${t('queueNo')} ${result.queueNo ?? ''}`} sub={`${t('balance')} ${thb(result.balance)}`} done={done} />;
  if (scan) return <ScanPrompt title={`${t('scanCard')} — ${thb(total)}`} onScan={async (code) => {
    try { setResult(await sapi.post('/api/kiosk/food-order', { storeId: store, code, items: Object.entries(cart).filter(([, q]) => q > 0).map(([productId, qty]) => ({ productId, qty })) }, { idempotencyKey: newKey() })); }
    catch (e) { toast.error(errorMessage(e)); setScan(false); }
  }} />;
  if (!store) return <div className="mx-auto grid max-w-3xl gap-4 sm:grid-cols-2">{stores.data?.map((s: any) => <button key={s.id} onClick={() => setStore(s.id)} className="rounded-3xl bg-white p-8 text-2xl font-bold shadow-sm">{s.name}</button>)}</div>;
  return (
    <div className="mx-auto max-w-5xl">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {items.map((p: any) => (
          <button key={p.id} onClick={() => setCart({ ...cart, [p.id]: (cart[p.id] ?? 0) + 1 })} className="relative rounded-2xl bg-white p-4 text-left shadow-sm">
            <div className="text-lg font-bold">{p.name}</div><div className="text-brand-700">{thb(p.price)}</div>
            {cart[p.id] ? <span className="absolute right-2 top-2 rounded-full bg-brand-600 px-2 text-white">{cart[p.id]}</span> : null}
          </button>
        ))}
      </div>
      <div className="sticky bottom-0 mt-4 flex items-center gap-3 rounded-2xl bg-white p-4 shadow-lg">
        <div className="flex-1 text-3xl font-black">{thb(total)}</div>
        <button onClick={() => setCart({})} className="rounded-xl bg-slate-100 px-5 py-3 text-lg">{t('cancel')}</button>
        <button disabled={!total} onClick={() => setScan(true)} className="rounded-xl bg-brand-600 px-8 py-3 text-xl font-bold text-white disabled:opacity-40"><Wallet className="mr-2 inline" />{t('wallet')}</button>
      </div>
    </div>
  );
}

function KioskRides() {
  const branches = useQuery({ queryKey: ['pub-branches'], queryFn: () => papi.get('/api/public/branches') });
  const rides = useQuery({ queryKey: ['pub-rides', branches.data?.[0]?.id], queryFn: () => papi.get(`/api/public/rides?branchId=${branches.data[0].id}`), enabled: !!branches.data?.[0], refetchInterval: 20_000 });
  return (
    <div className="mx-auto grid max-w-5xl gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {rides.data?.map((r: any) => (
        <div key={r.id} className="rounded-2xl bg-white p-5 shadow-sm"><div className="flex justify-between"><div className="text-xl font-bold">{r.name}</div><Badge>{r.status}</Badge></div>
          {r.status === 'OPEN' && <div className="mt-2 text-4xl font-black text-brand-700">{r.wait_min}<span className="text-lg text-slate-500"> min</span></div>}</div>
      ))}
    </div>
  );
}

function KioskRegister({ done }: { done: () => void }) {
  const t = useT();
  const [f, setF] = useState({ phone: '', firstName: '', lastName: '', password: '' });
  const [r, setR] = useState<any>(null);
  if (r) return <Success title={`Member ${r.member.member_code}`} sub="Digital member card is ready in the app / website" done={done} />;
  return (
    <div className="mx-auto max-w-xl space-y-3 rounded-3xl bg-white p-8">
      <div className="text-3xl font-bold">{t('register')}</div>
      {(['phone', 'firstName', 'lastName', 'password'] as const).map((k) => (
        <input key={k} type={k === 'password' ? 'password' : 'text'} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} placeholder={k === 'phone' ? t('phone') : k === 'password' ? `${t('password')} (8+)` : k}
          className="w-full rounded-2xl border-2 border-slate-200 p-4 text-xl" />
      ))}
      <button onClick={async () => { try { setR(await papi.post('/api/member/register', f)); } catch (e) { toast.error(errorMessage(e)); } }} className="w-full rounded-2xl bg-brand-600 p-5 text-2xl font-bold text-white">{t('register')}</button>
    </div>
  );
}

function Success({ title, sub, done }: { title: string; sub?: string; done: () => void }) {
  const t = useT();
  useEffect(() => { const i = setTimeout(done, 20_000); return () => clearTimeout(i); }, [done]);
  return (
    <div className="pop mx-auto flex max-w-xl flex-col items-center gap-3 rounded-3xl bg-emerald-600 p-10 text-center text-white">
      <CheckCircle2 className="h-24 w-24" /><div className="text-4xl font-black">{title}</div>{sub && <div className="text-2xl">{sub}</div>}
      <button onClick={done} className="mt-3 flex items-center gap-2 rounded-2xl bg-white/20 px-6 py-3 text-xl font-bold"><Home />{t('done')}</button>
    </div>
  );
}
