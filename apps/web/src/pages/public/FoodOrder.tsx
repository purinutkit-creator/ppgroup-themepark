import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Minus, Plus, ShoppingCart } from 'lucide-react';
import { mapi, papi, errorMessage, newKey } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useT, useLang } from '../../lib/i18n';
import { thb } from '../../lib/format';
import { Button, Card, Loading, Modal, cx, toast } from '../../components/ui';
import { QR } from '../../components/Codes';

interface Line { key: string; product: any; qty: number; modifiers: Array<{ group: string; option: string }> }

/** QR / mobile food ordering — member pays with wallet or PromptPay; order goes straight to KDS. */
export function FoodOrder() {
  const t = useT();
  const lang = useLang((s) => s.lang);
  const { storeId } = useParams();
  const member = useAuth((s) => s.member);
  const menu = useQuery({ queryKey: ['menu', storeId], queryFn: () => papi.get(`/api/public/menu?storeId=${storeId}`) });
  const [cart, setCart] = useState<Line[]>([]);
  const [pick, setPick] = useState<any>(null);
  const [mods, setMods] = useState<Record<string, string[]>>({});
  const [done, setDone] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const total = useMemo(() => cart.reduce((s, l) => s + (l.product.price + l.modifiers.reduce((a, m) => a + (l.product.modifiers.find((g: any) => g.group === m.group)?.options.find((o: any) => o.name === m.option)?.price ?? 0), 0)) * l.qty, 0), [cart]);
  if (menu.isLoading) return <Loading />;
  const cats = [...new Set(menu.data.products.map((p: any) => p.category))] as string[];
  const add = (p: any) => {
    if (p.modifiers?.length) { setPick(p); setMods({}); return; }
    setCart((c) => { const ex = c.find((l) => l.product.id === p.id && !l.modifiers.length); return ex ? c.map((l) => (l === ex ? { ...l, qty: l.qty + 1 } : l)) : [...c, { key: newKey(), product: p, qty: 1, modifiers: [] }]; });
  };
  const order = async (payWith: 'WALLET' | 'PROMPTPAY') => {
    setBusy(true);
    try {
      const r = await mapi.post('/api/public/food-orders', { storeId, payWith, items: cart.map((l) => ({ productId: l.product.id, qty: l.qty, modifiers: l.modifiers })) }, { idempotencyKey: newKey() });
      setDone(r); setCart([]);
    } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  };
  return (
    <div className="mx-auto max-w-3xl px-4 py-6 pb-32">
      <h1 className="text-2xl font-bold">{menu.data.store.name}</h1>
      {cats.map((c) => (
        <div key={c} className="mt-5">
          <div className="mb-2 font-semibold text-slate-500">{c}</div>
          <div className="grid gap-2 sm:grid-cols-2">
            {menu.data.products.filter((p: any) => p.category === c).map((p: any) => (
              <button key={p.id} disabled={p.stock === 0} onClick={() => add(p)} className="flex items-center justify-between rounded-xl border border-slate-200 bg-white p-3 text-left disabled:opacity-40">
                <div><div className="font-medium">{lang === 'en' ? p.name_en ?? p.name : p.name}</div><div className="text-sm text-brand-700">{thb(p.price)}</div></div><Plus className="h-5 w-5 text-brand-600" />
              </button>
            ))}
          </div>
        </div>
      ))}
      {cart.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 border-t border-slate-200 bg-white p-4 shadow-2xl">
          <div className="mx-auto max-w-3xl">
            {cart.map((l) => (
              <div key={l.key} className="flex items-center justify-between py-1 text-sm">
                <span>{l.product.name}{l.modifiers.length ? ` (${l.modifiers.map((m) => m.option).join(', ')})` : ''}</span>
                <span className="flex items-center gap-2"><button onClick={() => setCart(cart.map((x) => (x === l ? { ...x, qty: x.qty - 1 } : x)).filter((x) => x.qty > 0))}><Minus className="h-4 w-4" /></button>{l.qty}
                  <button onClick={() => setCart(cart.map((x) => (x === l ? { ...x, qty: x.qty + 1 } : x)))}><Plus className="h-4 w-4" /></button></span>
              </div>
            ))}
            <div className="mt-2 flex items-center gap-2">
              <div className="flex-1 text-lg font-bold"><ShoppingCart className="mr-1 inline h-5 w-5" />{thb(total)}</div>
              {member ? <>
                <Button onClick={() => order('WALLET')} loading={busy}>Pay with Wallet</Button>
                <Button variant="outline" onClick={() => order('PROMPTPAY')} loading={busy}>PromptPay</Button>
              </> : <Link to={`/login?next=/order/${storeId}`}><Button>{t('login')}</Button></Link>}
            </div>
          </div>
        </div>
      )}
      <Modal open={!!pick} onClose={() => setPick(null)} title={pick?.name} footer={<Button onClick={() => {
        const missing = pick.modifiers.find((g: any) => g.required && !(mods[g.group]?.length));
        if (missing) return toast.error(`Choose ${missing.group}`);
        setCart([...cart, { key: newKey(), product: pick, qty: 1, modifiers: Object.entries(mods).flatMap(([group, opts]) => opts.map((option) => ({ group, option }))) }]);
        setPick(null);
      }}>Add</Button>}>
        {pick?.modifiers.map((g: any) => (
          <div key={g.group} className="mb-3">
            <div className="mb-1 text-sm font-semibold">{g.group}{g.required && ' *'}</div>
            <div className="flex flex-wrap gap-2">{g.options.map((o: any) => {
              const sel = mods[g.group]?.includes(o.name);
              return <button key={o.name} onClick={() => setMods({ ...mods, [g.group]: g.max === 1 ? [o.name] : sel ? mods[g.group].filter((x) => x !== o.name) : [...(mods[g.group] ?? []), o.name] })}
                className={cx('rounded-lg border px-3 py-1.5 text-sm', sel ? 'border-brand-600 bg-brand-50 text-brand-700' : 'border-slate-300')}>{o.name}{o.price ? ` +${thb(o.price)}` : ''}</button>;
            })}</div>
          </div>
        ))}
      </Modal>
      <Modal open={!!done} onClose={() => setDone(null)} title={t('done')}>
        {done && (done.order.queueNo ? (
          <div className="text-center"><div className="text-sm text-slate-500">{t('queueNo')}</div><div className="text-6xl font-black text-brand-700">{done.order.queueNo}</div><div className="mt-2 text-sm">We will notify you when it is ready.</div></div>
        ) : done.payment?.qrPayload ? (
          <Card className="text-center"><QR value={done.payment.qrPayload} size={200} className="mx-auto" /><div className="mt-2 font-bold">{thb(done.order.total)}</div></Card>
        ) : <div>Order {done.order.orderNo}</div>)}
      </Modal>
    </div>
  );
}
