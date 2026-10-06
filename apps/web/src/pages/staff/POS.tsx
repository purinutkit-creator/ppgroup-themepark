import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Minus, Percent, Plus, Printer, Search, ShoppingCart, Trash2, User, Wallet, X } from 'lucide-react';
import { sapi, errorMessage, newKey, qs, ApiError } from '../../lib/api';
import { useBranchId } from '../../lib/auth';
import { useKeyboardScanner } from '../../lib/scanner';
import { offlineQueue, useOnline } from '../../lib/offline';
import { useRealtime } from '../../lib/socket';
import { thb } from '../../lib/format';
import { useSurfaceFont } from '../../lib/config';
import { requestApproval } from '../../components/Approval';
import { PaymentDialog, type PaymentLine } from '../../components/Payment';
import { printNode, ReceiptPrint } from '../../components/Print';
import { ScanBox } from '../../components/ScanBox';
import { Badge, Button, Card, Empty, Field, Input, Loading, Modal, Select, cx, toast } from '../../components/ui';

interface CartLine { key: string; product: any; qty: number; modifiers: Array<{ group: string; option: string; price: number }>; notes?: string }

export function POS() {
  useSurfaceFont('pos');
  const branchId = useBranchId();
  const qc = useQueryClient();
  const online = useOnline();
  const stores = useQuery({ queryKey: ['stores', branchId], queryFn: () => sapi.get(`/api/public/stores${qs({ branchId })}`), enabled: !!branchId });
  const [storeId, setStoreId] = useState<string>(() => localStorage.getItem('tp.posStore') ?? '');
  useEffect(() => { if (!storeId && stores.data?.length) setStoreId(stores.data.find((s: any) => s.type === 'RESTAURANT')?.id ?? stores.data[0].id); }, [stores.data, storeId]);
  useEffect(() => { if (storeId) localStorage.setItem('tp.posStore', storeId); }, [storeId]);
  const catalog = useQuery({ queryKey: ['pos-catalog', storeId], queryFn: () => sapi.get(`/api/pos/catalog?storeId=${storeId}`), enabled: !!storeId });
  const [cat, setCat] = useState('ALL');
  const [search, setSearch] = useState('');
  const [cart, setCart] = useState<CartLine[]>([]);
  const [cred, setCred] = useState<any>(null);
  const [coupon, setCoupon] = useState('');
  const [discount, setDiscount] = useState<{ percent?: number; amount?: number; reason: string; approvalId?: string } | null>(null);
  const [modPick, setModPick] = useState<any>(null);
  const [paying, setPaying] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<any>(null);
  const [idem, setIdem] = useState(newKey());
  useRealtime([cred?.credential.accountId ? `account:${cred.credential.accountId}` : null], {
    'wallet.updated': (e) => setCred((c: any) => (c ? { ...c, wallet: { ...c.wallet, balance: e.balance } } : c)),
  });
  const products: any[] = catalog.data?.products ?? [];
  const cats = useMemo(() => ['ALL', ...new Set(products.map((p) => p.category_name).filter(Boolean))], [products]);
  const shown = products.filter((p) => (cat === 'ALL' || p.category_name === cat) && (!search || `${p.name} ${p.sku} ${p.barcode ?? ''}`.toLowerCase().includes(search.toLowerCase())));
  const lineTotal = (l: CartLine) => ((cred?.member && l.product.member_price != null ? l.product.member_price : l.product.price) + l.modifiers.reduce((s, m) => s + m.price, 0)) * l.qty;
  const subtotal = cart.reduce((s, l) => s + lineTotal(l), 0);
  const estDiscount = discount ? (discount.percent ? Math.round((subtotal * discount.percent) / 100) : Math.min(discount.amount ?? 0, subtotal)) : 0;
  const estTotal = subtotal - estDiscount;

  const add = (p: any) => {
    if (p.stock !== null && p.stock !== undefined && p.stock <= 0) return toast.error(`${p.name} out of stock`);
    if (p.modifiers?.length) return setModPick({ product: p, sel: {} as Record<string, string[]> });
    setCart((c) => { const ex = c.find((l) => l.product.id === p.id && !l.modifiers.length); return ex ? c.map((l) => (l === ex ? { ...l, qty: l.qty + 1 } : l)) : [...c, { key: newKey(), product: p, qty: 1, modifiers: [] }]; });
  };
  const onScan = async (code: string) => {
    const p = products.find((x) => x.barcode === code || x.sku === code.toUpperCase());
    if (p) return add(p);
    try { const prof = await sapi.post('/api/credentials/scan', { scan: code }); setCred(prof); toast.success(`Card ${prof.credential.code} · ${thb(prof.wallet?.balance ?? 0)}`); }
    catch (e) { toast.error(errorMessage(e)); }
  };
  useKeyboardScanner(onScan, { enabled: !paying && !modPick });

  const checkout = async (lines: PaymentLine[]) => {
    const body = {
      storeId, items: cart.map((l) => ({ type: 'PRODUCT', productId: l.product.id, qty: l.qty, modifiers: l.modifiers.map(({ group, option }) => ({ group, option })), notes: l.notes })),
      scan: undefined as string | undefined, memberId: cred?.member?.id, couponCode: coupon || null, manualDiscount: discount, payments: lines.map((l) => ({ ...l, credentialId: l.method === 'WALLET' ? l.credentialId ?? cred?.credential.id : undefined })),
    };
    setBusy(true);
    try {
      const r = await sapi.post('/api/pos/checkout', body, { idempotencyKey: idem });
      if (r.rejectedCoupon) toast.warning(r.rejectedCoupon);
      setDone(r); setPaying(false); setCart([]); setCoupon(''); setDiscount(null); setIdem(newKey());
      if (cred) setCred({ ...cred, wallet: { ...cred.wallet, balance: r.walletBalance ?? cred.wallet?.balance } });
      qc.invalidateQueries({ queryKey: ['pos-catalog', storeId] });
    } catch (e) {
      if (e instanceof ApiError && e.code === 'APPROVAL_REQUIRED') {
        const id = await requestApproval('DISCOUNT_OVER_LIMIT', discount?.reason);
        if (id) { setDiscount({ ...discount!, approvalId: id }); toast.info('Approved — confirm payment again'); }
      } else if (e instanceof ApiError && e.status === 0 && lines.every((l) => l.method === 'CASH')) {
        offlineQueue.add('pos.cash_sale', body as any, `Cash sale ${thb(estTotal)}`);
        toast.warning('OFFLINE — cash sale saved locally and will sync automatically');
        setDone({ offline: true, total: estTotal }); setPaying(false); setCart([]); setIdem(newKey());
      } else toast.error(errorMessage(e));
    } finally { setBusy(false); }
  };

  if (!stores.data) return <Loading />;
  return (
    <div className="flex h-full flex-col gap-3 lg:flex-row">
      <div className="flex min-h-0 flex-1 flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Select value={storeId} onChange={(e) => { setStoreId(e.target.value); setCart([]); }} className="w-auto font-semibold">{stores.data.map((s: any) => <option key={s.id} value={s.id}>{s.name} ({s.type})</option>)}</Select>
          <div className="relative flex-1"><Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" /><Input className="pl-9" placeholder="Search product / SKU / barcode" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
          {!online && <Badge tone="red">OFFLINE — cash only</Badge>}
        </div>
        <div className="flex gap-1 overflow-x-auto">{cats.map((c) => <button key={c} onClick={() => setCat(c)} className={cx('whitespace-nowrap rounded-full px-3 py-1.5 text-sm font-medium', cat === c ? 'bg-brand-600 text-white' : 'bg-white text-slate-600 shadow-sm')}>{c}</button>)}</div>
        <div className="grid flex-1 auto-rows-min grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
          {catalog.isLoading ? <Loading /> : shown.map((p) => (
            <button key={p.id} onClick={() => add(p)} className="flex min-h-[96px] flex-col justify-between rounded-xl border border-slate-200 bg-white p-3 text-left shadow-sm active:scale-[0.98] disabled:opacity-40" disabled={p.stock === 0}>
              <div className="text-sm font-semibold leading-tight">{p.name}</div>
              <div className="flex items-end justify-between"><span className="text-base font-bold text-brand-700">{thb(p.price)}</span>{p.stock != null && <span className={cx('text-[10px]', p.stock <= p.low_stock_threshold ? 'text-rose-600' : 'text-slate-400')}>stock {p.stock}</span>}</div>
            </button>
          ))}
        </div>
      </div>
      <Card className="flex w-full flex-col lg:w-[400px]" padded={false}>
        <div className="border-b border-slate-100 p-3">
          {cred ? (
            <div className="flex items-center justify-between rounded-lg bg-violet-50 p-2 text-sm">
              <div><div className="font-semibold"><User className="mr-1 inline h-4 w-4" />{cred.customerName ?? cred.credential.code}</div><div className="text-xs text-slate-500">{cred.member ? `${cred.member.tier_name ?? 'Member'} · ${cred.member.points} pts` : 'Guest wristband'}</div></div>
              <div className="text-right"><div className="font-bold text-violet-700"><Wallet className="mr-1 inline h-4 w-4" />{thb(cred.wallet?.balance ?? 0)}</div><button className="text-xs text-slate-500" onClick={() => setCred(null)}>remove</button></div>
            </div>
          ) : <ScanBox compact global={false} placeholder="Scan wristband / member card" onScan={onScan} />}
        </div>
        <div className="flex-1 space-y-1 overflow-y-auto p-3">
          {cart.length === 0 ? <Empty title="Cart is empty" icon={<ShoppingCart className="h-8 w-8" />} /> : cart.map((l) => (
            <div key={l.key} className="rounded-lg border border-slate-100 p-2">
              <div className="flex items-start justify-between gap-2"><div className="text-sm font-medium">{l.product.name}{l.modifiers.map((m) => <div key={m.option} className="text-xs text-slate-500">+ {m.option}{m.price ? ` ${thb(m.price)}` : ''}</div>)}</div><div className="text-sm font-semibold">{thb(lineTotal(l))}</div></div>
              <div className="mt-1 flex items-center gap-2">
                <button onClick={() => setCart(cart.map((x) => (x === l ? { ...x, qty: x.qty - 1 } : x)).filter((x) => x.qty > 0))} className="rounded bg-slate-100 p-1"><Minus className="h-3.5 w-3.5" /></button>
                <span className="w-6 text-center text-sm font-bold">{l.qty}</span>
                <button onClick={() => setCart(cart.map((x) => (x === l ? { ...x, qty: x.qty + 1 } : x)))} className="rounded bg-slate-100 p-1"><Plus className="h-3.5 w-3.5" /></button>
                <input placeholder="note" value={l.notes ?? ''} onChange={(e) => setCart(cart.map((x) => (x === l ? { ...x, notes: e.target.value } : x)))} className="ml-2 flex-1 rounded border border-slate-200 px-2 py-0.5 text-xs" />
                <button onClick={() => setCart(cart.filter((x) => x !== l))} className="text-slate-400 hover:text-rose-600"><Trash2 className="h-4 w-4" /></button>
              </div>
            </div>
          ))}
        </div>
        <div className="space-y-2 border-t border-slate-100 p-3">
          <div className="flex gap-2">
            <Input placeholder="Coupon" value={coupon} onChange={(e) => setCoupon(e.target.value.toUpperCase())} />
            <Button variant="outline" icon={<Percent className="h-4 w-4" />} onClick={() => { const v = prompt('Discount % (e.g. 10) or amount with ฿ (e.g. ฿50)'); if (!v) return; const reason = prompt('Reason?') ?? 'Manual discount';
              setDiscount(v.startsWith('฿') ? { amount: Math.round(Number(v.slice(1)) * 100), reason } : { percent: Number(v), reason }); }}>Disc.</Button>
          </div>
          {discount && <div className="flex justify-between text-sm text-emerald-700"><span>Manual discount ({discount.percent ? `${discount.percent}%` : thb(discount.amount)}) {discount.approvalId && '✓ approved'}</span><button onClick={() => setDiscount(null)}><X className="h-4 w-4" /></button></div>}
          <div className="flex justify-between text-sm"><span>Subtotal</span><span>{thb(subtotal)}</span></div>
          <div className="flex justify-between text-2xl font-black"><span>Total</span><span>{thb(estTotal)}</span></div>
          <div className="text-[11px] text-slate-400">Promotions, member & tier discounts are applied by the server at checkout.</div>
          <div className="grid grid-cols-3 gap-2">
            <Button variant="ghost" onClick={() => { setCart([]); setDiscount(null); }}>Clear</Button>
            <Button className="col-span-2" size="lg" variant="success" disabled={!cart.length} onClick={() => setPaying(true)}>PAY</Button>
          </div>
        </div>
      </Card>
      <PaymentDialog open={paying} onClose={() => setPaying(false)} total={estTotal} onConfirm={checkout} busy={busy} allowed={online ? undefined : ['CASH']}
        credential={cred ? { id: cred.credential.id, code: cred.credential.code, walletBalance: cred.wallet?.balance, memberPoints: cred.member?.points } : null} />
      <Modal open={!!modPick} onClose={() => setModPick(null)} title={modPick?.product.name} footer={<Button onClick={() => {
        const p = modPick.product;
        const missing = p.modifiers.find((g: any) => g.required && !(modPick.sel[g.group]?.length));
        if (missing) return toast.error(`Choose ${missing.group}`);
        const mods = Object.entries(modPick.sel as Record<string, string[]>).flatMap(([group, opts]) => opts.map((option) => ({ group, option, price: p.modifiers.find((g: any) => g.group === group).options.find((o: any) => o.name === option).price })));
        setCart([...cart, { key: newKey(), product: p, qty: 1, modifiers: mods }]); setModPick(null);
      }}>Add to cart</Button>}>
        {modPick?.product.modifiers.map((g: any) => (
          <Field key={g.group} label={`${g.group}${g.required ? ' *' : ''}${g.max ? ` (max ${g.max})` : ''}`} className="mb-3">
            <div className="flex flex-wrap gap-2">{g.options.map((o: any) => {
              const sel = modPick.sel[g.group]?.includes(o.name);
              return <button key={o.name} onClick={() => { const cur: string[] = modPick.sel[g.group] ?? []; const next = sel ? cur.filter((x) => x !== o.name) : g.max === 1 ? [o.name] : [...cur, o.name].slice(0, g.max ?? 99); setModPick({ ...modPick, sel: { ...modPick.sel, [g.group]: next } }); }}
                className={cx('rounded-lg border-2 px-3 py-2 text-sm', sel ? 'border-brand-600 bg-brand-50 text-brand-700' : 'border-slate-200')}>{o.name}{o.price ? ` +${thb(o.price)}` : ''}</button>;
            })}</div>
          </Field>
        ))}
      </Modal>
      <Modal open={!!done} onClose={() => setDone(null)} title={done?.offline ? 'Saved offline' : 'Payment complete'} footer={<>
        {!done?.offline && <Button variant="outline" icon={<Printer className="h-4 w-4" />} onClick={async () => printNode(<ReceiptPrint d={await sapi.get(`/api/print/receipt/${done.order.id}`)} />)}>Print receipt</Button>}
        <Button onClick={() => setDone(null)}>New order</Button></>}>
        {done && (done.offline ? <div className="text-center text-lg">Cash {thb(done.total)} — will sync when online.</div> : (
          <div className="space-y-2 text-center">
            {done.order.queue_no && <><div className="text-sm text-slate-500">Queue number</div><div className="text-6xl font-black text-brand-700">{done.order.queue_no}</div></>}
            <div className="text-2xl font-bold">{thb(done.order.total)}</div><div className="text-sm text-slate-500">{done.order.order_no}</div>
            {done.order.payments.filter((p: any) => p.change_amount).map((p: any) => <div key={p.id} className="text-xl font-bold text-emerald-600">Change {thb(p.change_amount)}</div>)}
            {done.walletBalance != null && <div className="text-sm">Wallet balance {thb(done.walletBalance)}</div>}
            {done.order.points_earned > 0 && <div className="text-sm text-amber-600">+{done.order.points_earned} points</div>}
          </div>
        ))}
      </Modal>
    </div>
  );
}
