import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Check, ChevronLeft, ChevronRight, Minus, Plus } from 'lucide-react';
import { papi, errorMessage, newKey } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useT, useLang } from '../../lib/i18n';
import { addDays, thb, today } from '../../lib/format';
import { Badge, Button, Card, Field, Input, Loading, cx, toast } from '../../components/ui';
import { usePublicConfig } from '../../lib/config';

const STEPS = ['selectBranch', 'selectDate', 'selectPackage', 'guests', 'addons', 'details', 'payment'] as const;

export function BookingWizard() {
  const t = useT();
  const lang = useLang((s) => s.lang);
  const nav = useNavigate();
  const [params] = useSearchParams();
  const member = useAuth((s) => s.member);
  const cfg = usePublicConfig();
  const [step, setStep] = useState(0);
  const [branchId, setBranchId] = useState<string>('');
  const [date, setDate] = useState<string>('');
  const [packageId, setPackageId] = useState<string>(params.get('package') ?? '');
  const [guests, setGuests] = useState<Record<string, number>>({});
  const [bundles, setBundles] = useState(1);
  const [addons, setAddons] = useState<Record<string, number>>({});
  const [guest, setGuest] = useState(!!member ? false : false);
  const [form, setForm] = useState({ customerName: member ? `${member.firstName} ${member.lastName}` : '', phone: '', email: '' });
  const [coupon, setCoupon] = useState('');
  const [appliedCoupon, setAppliedCoupon] = useState<string | null>(null);
  const [paymentMode, setPaymentMode] = useState<'PAY_NOW' | 'PAY_AT_PARK'>('PAY_NOW');
  const [method, setMethod] = useState('PROMPTPAY');
  const [busy, setBusy] = useState(false);
  const idemKey = useMemo(() => newKey(), []);

  const branches = useQuery({ queryKey: ['pub-branches'], queryFn: () => papi.get('/api/public/branches') });
  useEffect(() => { if (!branchId && branches.data?.length === 1) { setBranchId(branches.data[0].id); setStep(1); } }, [branches.data, branchId]);
  const month = (date || today()).slice(0, 7);
  const avail = useQuery({ queryKey: ['avail', branchId, month], queryFn: () => papi.get(`/api/public/availability?branchId=${branchId}&month=${month}`), enabled: !!branchId });
  const pkgs = useQuery({ queryKey: ['pub-pkgs', branchId, date, !!member], queryFn: () => papi.get(`/api/public/packages?branchId=${branchId}&date=${date}`), enabled: !!branchId && !!date });
  const addonList = useQuery({ queryKey: ['pub-addons', branchId], queryFn: () => papi.get(`/api/public/addons?branchId=${branchId}`), enabled: !!branchId });
  const pkg = pkgs.data?.find((p: any) => p.id === packageId);
  const guestCount = pkg?.pricing_mode === 'BUNDLE' ? bundles * (pkg.bundle_guests ?? []).reduce((s: number, g: any) => s + g.qty, 0) : Object.values(guests).reduce((s, n) => s + n, 0);
  const quoteBody = pkg && date ? {
    branchId, packageId, visitDate: date, guests: Object.entries(guests).filter(([, q]) => q > 0).map(([ticketTypeId, qty]) => ({ ticketTypeId, qty })),
    bundles: pkg.pricing_mode === 'BUNDLE' ? bundles : undefined, addons: Object.entries(addons).filter(([, q]) => q > 0).map(([productId, qty]) => ({ productId, qty })), couponCode: appliedCoupon,
  } : null;
  const quote = useQuery({ queryKey: ['quote', quoteBody, !!member], queryFn: () => papi.post('/api/public/quote', quoteBody), enabled: !!quoteBody && guestCount > 0 && step >= 3, retry: false });
  useEffect(() => { if (quote.data?.rejectedCoupon && appliedCoupon) { toast.error(quote.data.rejectedCoupon); setAppliedCoupon(null); } }, [quote.data, appliedCoupon]);
  const onlineMethods = cfg.data?.paymentMethods.filter((m) => m.online && !['WALLET', 'POINTS', 'CASH'].includes(m.method)) ?? [];

  const canNext = [!!branchId, !!date, !!packageId && pkg?.available?.ok !== false, guestCount > 0, true, !!(member || guest) && form.customerName.length > 1 && /^\+?\d{9,15}$/.test(form.phone), true][step];
  const submit = async () => {
    setBusy(true);
    try {
      const b = await papi.post('/api/public/bookings', { ...quoteBody, ...form, email: form.email || null, paymentMode, channel: 'ONLINE' }, { idempotencyKey: idemKey });
      if (paymentMode === 'PAY_NOW' && b.total > 0) {
        const p = await papi.post(`/api/public/bookings/${b.booking_no}/pay`, { token: b.token, method });
        if (p.checkoutUrl) { nav(`${p.checkoutUrl}?return=${encodeURIComponent(`/booking/${b.booking_no}?token=${b.token}`)}`); return; }
      }
      nav(`/booking/${b.booking_no}?token=${b.token}`);
    } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  };

  const days = Array.from({ length: 35 }, (_, i) => addDays(today(), i));
  const level = (d: string) => avail.data?.days.find((x: any) => x.date === d)?.level ?? 'AVAILABLE';
  const name = (o: any) => (lang === 'en' ? o.name_en ?? o.name : lang === 'zh' ? o.name_zh ?? o.name_en ?? o.name : o.name);

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <div className="mb-6 flex items-center gap-1 overflow-x-auto">
        {STEPS.map((s, i) => (
          <button key={s} onClick={() => i < step && setStep(i)} className={cx('flex items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-semibold',
            i === step ? 'bg-brand-600 text-white' : i < step ? 'bg-brand-100 text-brand-700' : 'bg-slate-100 text-slate-400')}>
            {i < step ? <Check className="h-3.5 w-3.5" /> : <span>{i + 1}</span>}{t(s)}
          </button>
        ))}
      </div>
      <div className="grid gap-6 md:grid-cols-[1fr_300px]">
        <div>
          {step === 0 && (
            <div className="grid gap-3 sm:grid-cols-2">
              {branches.data?.map((b: any) => (
                <button key={b.id} onClick={() => { setBranchId(b.id); setStep(1); }} className={cx('rounded-2xl border-2 bg-white p-5 text-left', branchId === b.id ? 'border-brand-600' : 'border-slate-200')}>
                  <div className="text-lg font-bold">{lang === 'th' ? b.name : b.name_en ?? b.name}</div><div className="text-sm text-slate-500">{b.address}</div>
                  <div className="mt-1 text-xs text-slate-400">{b.open_time?.slice(0, 5)}–{b.close_time?.slice(0, 5)}</div>
                </button>
              ))}
            </div>
          )}
          {step === 1 && (
            <Card title={t('selectDate')}>
              <div className="grid grid-cols-5 gap-2 sm:grid-cols-7">
                {days.map((d) => {
                  const lv = level(d);
                  const dt = new Date(`${d}T00:00:00`);
                  return (
                    <button key={d} disabled={lv === 'FULL'} onClick={() => setDate(d)} className={cx('rounded-xl border-2 p-2 text-center transition disabled:opacity-40',
                      date === d ? 'border-brand-600 bg-brand-50' : 'border-slate-200 hover:border-slate-300')}>
                      <div className="text-[10px] uppercase text-slate-400">{dt.toLocaleDateString(lang === 'th' ? 'th-TH' : lang === 'zh' ? 'zh-CN' : 'en-GB', { weekday: 'short' })}</div>
                      <div className="text-lg font-bold">{dt.getDate()}</div>
                      <div className="text-[10px] text-slate-500">{dt.toLocaleDateString('en-GB', { month: 'short' })}</div>
                      <div className={cx('mx-auto mt-1 h-1.5 w-1.5 rounded-full', lv === 'FULL' ? 'bg-rose-500' : lv === 'LIMITED' ? 'bg-amber-500' : 'bg-emerald-500')} />
                    </button>
                  );
                })}
              </div>
              <div className="mt-3 flex gap-4 text-xs text-slate-500"><span>● <span className="text-emerald-600">Available</span></span><span>● <span className="text-amber-600">Limited</span></span><span>● <span className="text-rose-600">Sold out</span></span></div>
            </Card>
          )}
          {step === 2 && (pkgs.isLoading ? <Loading /> : (
            <div className="grid gap-3 sm:grid-cols-2">
              {pkgs.data?.map((p: any) => {
                const from = p.pricing_mode === 'BUNDLE' ? (member && p.bundle_member_price ? p.bundle_member_price : p.bundle_price) : Math.min(...p.prices.map((x: any) => (member && x.member_price ? x.member_price : x.price)));
                return (
                  <button key={p.id} disabled={!p.available.ok} onClick={() => { setPackageId(p.id); setGuests({}); }} className={cx('rounded-2xl border-2 bg-white p-4 text-left transition disabled:opacity-50',
                    packageId === p.id ? 'border-brand-600 ring-4 ring-brand-100' : 'border-slate-200 hover:border-slate-300')}>
                    <div className="flex items-start justify-between gap-2"><div className="font-bold">{name(p)}</div><div className="text-lg font-extrabold text-brand-700">{thb(from)}</div></div>
                    <div className="mt-1 text-sm text-slate-500">{p.description}</div>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {p.ride_access === 'ALL' ? <Badge tone="green">ALL RIDES</Badge> : p.rides.slice(0, 6).map((r: any) => <Badge key={r.id} tone="gray">✓ {r.name.split(' ').slice(-2).join(' ')}</Badge>)}
                      {p.days > 1 && <Badge tone="violet">{p.days} days</Badge>}
                      {p.valid_time_start && <Badge tone="amber">from {p.valid_time_start.slice(0, 5)}</Badge>}
                      {p.wallet_credit > 0 && <Badge tone="brand">+{thb(p.wallet_credit)} wallet</Badge>}
                    </div>
                    {!p.available.ok && <div className="mt-2 text-sm font-medium text-rose-600">{p.available.reason}</div>}
                    {member && <div className="mt-2 text-xs text-emerald-600">✓ Member price applied</div>}
                  </button>
                );
              })}
            </div>
          ))}
          {step === 3 && pkg && (
            <Card title={t('guests')}>
              {pkg.pricing_mode === 'BUNDLE' ? (
                <Stepper label={`${name(pkg)} (${(pkg.bundle_guests ?? []).map((g: any) => `${g.qty} ${g.ticket_type_code}`).join(' + ')})`} price={pkg.bundle_price} value={bundles} onChange={(v) => setBundles(Math.max(1, v))} />
              ) : pkg.prices.map((pr: any) => (
                <Stepper key={pr.ticket_type_id} label={`${lang === 'th' ? pr.ticket_type_name : pr.ticket_type_name_en ?? pr.ticket_type_name}${pr.min_age != null ? ` (${pr.min_age}${pr.max_age ? `–${pr.max_age}` : '+'} yrs)` : ''}`}
                  price={member && pr.member_price ? pr.member_price : pr.price} value={guests[pr.ticket_type_id] ?? 0} onChange={(v) => setGuests({ ...guests, [pr.ticket_type_id]: Math.max(0, Math.min(v, cfg.data?.booking.maxGuests ?? 30)) })} />
              ))}
            </Card>
          )}
          {step === 4 && (
            <Card title={t('addons')}>
              {addonList.data?.length ? addonList.data.map((a: any) => (
                <Stepper key={a.id} label={lang === 'en' ? a.name_en ?? a.name : a.name} price={a.price} value={addons[a.id] ?? 0} onChange={(v) => setAddons({ ...addons, [a.id]: Math.max(0, v) })} />
              )) : <div className="text-sm text-slate-500">—</div>}
            </Card>
          )}
          {step === 5 && (
            <Card title={t('details')}>
              {!member && !guest && (
                <div className="grid gap-3 sm:grid-cols-3">
                  <Link to={`/login?next=/book`} className="rounded-xl border-2 border-brand-600 p-4 text-center font-semibold text-brand-700">{t('login')}<div className="text-xs font-normal text-slate-500">Member price & points</div></Link>
                  <Link to={`/register?next=/book`} className="rounded-xl border-2 border-slate-200 p-4 text-center font-semibold">{t('register')}</Link>
                  <button onClick={() => setGuest(true)} className="rounded-xl border-2 border-slate-200 p-4 font-semibold">{t('continueGuest')}</button>
                </div>
              )}
              {(member || guest) && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label={t('name')} className="sm:col-span-2"><Input value={form.customerName} onChange={(e) => setForm({ ...form, customerName: e.target.value })} /></Field>
                  <Field label={t('phone')}><Input inputMode="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value.replace(/[^\d+]/g, '') })} placeholder="08xxxxxxxx" /></Field>
                  <Field label={t('email')}><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
                </div>
              )}
            </Card>
          )}
          {step === 6 && (
            <Card title={t('payment')}>
              <div className="grid gap-3 sm:grid-cols-2">
                <button onClick={() => setPaymentMode('PAY_NOW')} className={cx('rounded-xl border-2 p-4 text-left', paymentMode === 'PAY_NOW' ? 'border-brand-600 bg-brand-50' : 'border-slate-200')}>
                  <div className="font-bold">{t('payNow')}</div><div className="text-xs text-slate-500">PromptPay · Card · Mobile Banking</div></button>
                {cfg.data?.booking.payAtParkEnabled && <button onClick={() => setPaymentMode('PAY_AT_PARK')} className={cx('rounded-xl border-2 p-4 text-left', paymentMode === 'PAY_AT_PARK' ? 'border-brand-600 bg-brand-50' : 'border-slate-200')}>
                  <div className="font-bold">{t('payAtPark')}</div><div className="text-xs text-slate-500">RESERVED — PAYMENT PENDING</div></button>}
              </div>
              {paymentMode === 'PAY_NOW' && (
                <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {onlineMethods.map((m) => (
                    <button key={m.method} onClick={() => setMethod(m.method)} className={cx('rounded-xl border-2 p-3 text-sm font-semibold', method === m.method ? 'border-brand-600 bg-brand-50 text-brand-700' : 'border-slate-200')}>
                      {m.method.replace('_', ' ')}</button>
                  ))}
                </div>
              )}
            </Card>
          )}
          <div className="mt-4 flex justify-between">
            <Button variant="ghost" onClick={() => setStep(Math.max(0, step - 1))} disabled={step === 0} icon={<ChevronLeft className="h-4 w-4" />}>{t('back')}</Button>
            {step < 6 ? <Button onClick={() => setStep(step + 1)} disabled={!canNext}>{t('continue')} <ChevronRight className="h-4 w-4" /></Button>
              : <Button size="lg" onClick={submit} loading={busy} disabled={!quote.data}>{paymentMode === 'PAY_NOW' ? `${t('payNow')} ${quote.data ? thb(quote.data.total) : ''}` : t('bookNow')}</Button>}
          </div>
        </div>
        <aside className="h-fit space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm md:sticky md:top-20">
          <div className="font-bold">{pkg ? name(pkg) : t('selectPackage')}</div>
          {date && <div className="text-sm text-slate-500">{t('visitDate')}: {date}</div>}
          {quote.isFetching && <Loading label="" />}
          {quote.error && <div className="text-sm text-rose-600">{errorMessage(quote.error)}</div>}
          {quote.data && (
            <div className="space-y-1 text-sm">
              {quote.data.items.map((i: any, idx: number) => <div key={idx} className="flex justify-between gap-2"><span className="text-slate-600">{i.qty} × {i.name}</span><span>{thb(i.unitPrice * i.qty)}</span></div>)}
              {quote.data.promotions.map((p: any, idx: number) => <div key={idx} className="flex justify-between text-emerald-600"><span>{p.name}</span><span>-{thb(p.discount)}</span></div>)}
              <div className="flex justify-between border-t pt-2 text-lg font-extrabold"><span>{t('total')}</span><span>{thb(quote.data.total)}</span></div>
            </div>
          )}
          {step >= 3 && (
            <div className="flex gap-2">
              <Input value={coupon} onChange={(e) => setCoupon(e.target.value.toUpperCase())} placeholder={t('coupon')} />
              <Button variant="outline" onClick={() => setAppliedCoupon(coupon || null)}>{t('apply')}</Button>
            </div>
          )}
          {appliedCoupon && <Badge tone="green">{appliedCoupon}</Badge>}
        </aside>
      </div>
    </div>
  );
}

function Stepper({ label, price, value, onChange }: { label: string; price: number; value: number; onChange: (v: number) => void }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-slate-100 py-3 last:border-0">
      <div><div className="font-medium">{label}</div><div className="text-sm text-slate-500">{thb(price)}</div></div>
      <div className="flex items-center gap-3">
        <button onClick={() => onChange(value - 1)} className="rounded-full border border-slate-300 p-2 hover:bg-slate-100"><Minus className="h-4 w-4" /></button>
        <span className="w-6 text-center text-lg font-bold tabular-nums">{value}</span>
        <button onClick={() => onChange(value + 1)} className="rounded-full bg-brand-600 p-2 text-white hover:bg-brand-700"><Plus className="h-4 w-4" /></button>
      </div>
    </div>
  );
}
