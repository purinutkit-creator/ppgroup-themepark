import { useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Banknote, CheckCircle2, Clock, CreditCard, Loader2, QrCode, Users, Wallet, XCircle } from 'lucide-react';
import { sapi, ApiError, newKey } from '../../lib/api';
import { useRealtime } from '../../lib/socket';
import { useKeyboardScanner } from '../../lib/scanner';
import { useT, useLang, LANGS } from '../../lib/i18n';
import { thb } from '../../lib/format';
import { useSurfaceFont } from '../../lib/config';
import { CameraScanner } from '../../components/CameraScanner';
import { QR } from '../../components/Codes';
import { cx } from '../../components/ui';
import { DeviceGuard } from './DeviceShell';

type View =
  | { k: 'idle' } | { k: 'checking' }
  | { k: 'granted'; r: any; purchased?: boolean }
  | { k: 'denied'; r: any }
  | { k: 'offer'; r: any; code: string }
  | { k: 'confirmWallet'; r: any; code: string }
  | { k: 'waiting'; r: any; code: string; method: string; qr?: string | null; requestId?: string }
  | { k: 'queue'; q: any } | { k: 'error'; msg: string };

export function RideScanner() { return <DeviceGuard need="RIDE_SCANNER"><Inner /></DeviceGuard>; }

function Inner() {
  useSurfaceFont('kiosk');
  const t = useT();
  const { lang, setLang } = useLang();
  const { rideId } = useParams();
  const [params] = useSearchParams();
  const sp = params.get('sp') ?? undefined;
  const ride = useQuery({ queryKey: ['ride-op', rideId], queryFn: () => sapi.get(`/api/rides/${rideId}/operator`), refetchInterval: 30_000 });
  const [view, setView] = useState<View>({ k: 'idle' });
  const [mode, setMode] = useState<'ride' | 'queue'>('ride');
  const reset = useRef<number | null>(null);
  const go = (v: View, ms?: number) => { setView(v); if (reset.current) clearTimeout(reset.current); if (ms) reset.current = window.setTimeout(() => setView({ k: 'idle' }), ms); };

  const scan = async (code: string) => {
    go({ k: 'checking' });
    try {
      if (mode === 'queue') { const q = await sapi.post(`/api/rides/${rideId}/queue/join`, { code, partySize: 1 }); go({ k: 'queue', q }, 8000); setMode('ride'); return; }
      const r = await sapi.post(`/api/rides/${rideId}/scan`, { code, scanPointId: sp });
      if (r.result === 'GRANTED') go({ k: 'granted', r }, 3000);
      else if (r.result === 'NOT_INCLUDED' && r.purchase?.available) go({ k: 'offer', r, code }, 20000);
      else go({ k: 'denied', r }, 3500);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'ALREADY_IN_QUEUE') { go({ k: 'queue', q: e.details }, 8000); setMode('ride'); return; }
      go({ k: 'error', msg: (e as Error).message }, 3500);
    }
  };
  const buy = async (method: string, code: string, r: any) => {
    if (method === 'WALLET' && view.k !== 'confirmWallet') return go({ k: 'confirmWallet', r, code }, 20000);
    go({ k: 'checking' });
    try {
      const p = await sapi.post(`/api/rides/${rideId}/purchase`, { code, method, scanPointId: sp }, { idempotencyKey: newKey() });
      if (p.status === 'PAID') go(p.access.result === 'GRANTED' ? { k: 'granted', r: { ...p.access, walletBalance: p.walletBalance }, purchased: true } : { k: 'denied', r: p.access }, 4500);
      else go({ k: 'waiting', r, code, method, qr: p.qrPayload, requestId: p.requestId });
    } catch (e) { go({ k: 'error', msg: (e as Error).message }, 4000); }
  };
  useRealtime([rideId ? `ride:${rideId}` : null], {
    'ride.purchase.updated': async (e) => {
      if (view.k !== 'waiting') return;
      if (e.status === 'PAID' && e.credentialId === view.r.credentialId) {
        // payment confirmed → revalidate on the same screen
        const r = await sapi.post(`/api/rides/${rideId}/scan`, { code: view.code, scanPointId: sp }).catch(() => null);
        if (r?.result === 'GRANTED') go({ k: 'granted', r, purchased: true }, 4500); else go({ k: 'denied', r: r ?? view.r }, 3500);
      } else if ((e.status === 'FAILED' || e.status === 'CANCELLED') && e.credentialId === view.r.credentialId) go({ k: 'error', msg: e.message ?? 'Payment failed' }, 3500);
    },
  });
  useKeyboardScanner(scan, { enabled: view.k === 'idle' });
  const r = ride.data?.ride;
  const big = 'flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center';
  return (
    <div className="flex h-full flex-col bg-slate-900 text-white">
      <div className="flex items-center justify-between px-5 py-3">
        <div><div className="text-2xl font-black">{r?.name ?? '…'}</div><div className="text-sm text-white/60">{r?.status}{r?.entry_paused ? ' · PAUSED' : ''}{r?.min_height_cm ? ` · ≥${r.min_height_cm} cm` : ''}</div></div>
        <div className="flex gap-1">{LANGS.map((l) => <button key={l.code} onClick={() => setLang(l.code)} className={cx('rounded-lg px-2 py-1 text-xl', lang === l.code && 'bg-white/20')}>{l.flag}</button>)}</div>
      </div>
      {view.k === 'idle' && (
        <div className="relative flex-1">
          <CameraScanner className="absolute inset-0" onScan={scan} />
          <div className="absolute inset-x-0 bottom-0 space-y-3 bg-gradient-to-t from-black/90 to-transparent p-6 text-center">
            <div className="text-3xl font-bold">{mode === 'queue' ? `${t('joinQueue')} — ${t('scanCard')}` : t('scanCard')}</div>
            {r?.queue_enabled && <button onClick={() => setMode(mode === 'queue' ? 'ride' : 'queue')} className={cx('mx-auto flex items-center gap-2 rounded-2xl px-6 py-3 text-xl font-bold', mode === 'queue' ? 'bg-amber-500' : 'bg-white/15')}>
              <Users className="h-6 w-6" />{t('joinQueue')} · ~{ride.data?.queue.estimatedWaitMin ?? 0} {t('minutes')}</button>}
          </div>
        </div>
      )}
      {view.k === 'checking' && <div className={big}><Loader2 className="h-24 w-24 animate-spin" /><div className="text-4xl font-bold">{t('checking')}</div></div>}
      {view.k === 'granted' && (
        <div className={cx(big, 'pop bg-emerald-600')}>
          {view.purchased && <div className="text-4xl font-black">✓ {t('purchaseSuccess')}</div>}
          <CheckCircle2 className="h-36 w-36" strokeWidth={2.5} /><div className="text-6xl font-black">✓ {t('rideGranted')}</div>
          {view.r.customer && <div className="text-3xl">{view.r.customer}</div>}
          {view.r.entitlement?.usesRemaining != null && <div className="text-2xl">Remaining uses: {view.r.entitlement.usesRemaining}</div>}
          {view.r.walletBalance != null && view.purchased && <div className="text-2xl">{t('balance')} {thb(view.r.walletBalance)}</div>}
        </div>
      )}
      {view.k === 'denied' && (
        <div className={cx(big, 'pop bg-rose-600')}><XCircle className="h-36 w-36" strokeWidth={2.5} /><div className="text-6xl font-black">✕ ACCESS DENIED</div>
          <div className="text-4xl font-bold">{lang === 'th' ? view.r.reason?.th : view.r.reason?.en}</div>
          {view.r.checks?.filter((c: any) => !c.ok).map((c: any) => <div key={c.code} className="text-xl text-white/80">{c.label}: {c.detail ?? ''}</div>)}</div>
      )}
      {view.k === 'error' && <div className={cx(big, 'bg-rose-700')}><XCircle className="h-28 w-28" /><div className="text-3xl font-bold">{view.msg}</div></div>}
      {view.k === 'offer' && (
        <div className={cx(big, 'bg-amber-500 text-slate-900')}>
          <div className="text-4xl font-black">✕ {view.r.reasonCode === 'EXHAUSTED' ? 'ALL RIDES USED' : 'RIDE NOT INCLUDED'}</div>
          <div className="text-2xl">{lang === 'en' ? view.r.reason?.en : view.r.reasonCode === 'EXHAUSTED' ? 'คุณใช้สิทธิ์ครบแล้ว' : t('rideNotIncluded')}</div>
          <div className="rounded-3xl bg-white/90 px-10 py-5"><div className="text-xl">Ride: <b>{view.r.ride.name}</b></div><div className="text-5xl font-black">{thb(view.r.purchase.price)}</div>
            {view.r.purchase.uses > 1 && <div className="text-lg">{view.r.purchase.uses} rounds</div>}</div>
          <div className="text-3xl font-bold">{t('buyRide')}</div>
          <div className="grid w-full max-w-3xl grid-cols-2 gap-3 sm:grid-cols-4">
            {view.r.purchase.methods.map((m: string) => {
              const Icon = { WALLET: Wallet, PROMPTPAY: QrCode, CARD: CreditCard, CASH: Banknote }[m] ?? Wallet;
              return <button key={m} onClick={() => buy(m, view.code, view.r)} className="flex flex-col items-center gap-2 rounded-2xl bg-slate-900 p-5 text-white"><Icon className="h-10 w-10" /><span className="font-bold">{m === 'CARD' ? 'CREDIT / DEBIT' : m}</span>
                {m === 'WALLET' && view.r.walletBalance != null && <span className="text-sm text-white/70">{thb(view.r.walletBalance)}</span>}</button>;
            })}
          </div>
          <button onClick={() => go({ k: 'idle' })} className="mt-2 rounded-2xl bg-white/50 px-8 py-3 text-xl font-bold">{t('no')}</button>
        </div>
      )}
      {view.k === 'confirmWallet' && (
        <div className={cx(big, 'bg-violet-700')}>
          <Wallet className="h-20 w-20" />
          <div className="grid gap-2 text-3xl"><div>{t('balance')}: <b>{thb(view.r.walletBalance)}</b></div><div>Ride: <b>{thb(view.r.purchase.price)}</b></div>
            <div className="border-t border-white/30 pt-2">New balance: <b>{thb((view.r.walletBalance ?? 0) - view.r.purchase.price)}</b></div></div>
          <div className="flex gap-3">
            <button onClick={() => go({ k: 'idle' })} className="rounded-2xl bg-white/20 px-8 py-4 text-2xl font-bold">{t('cancel')}</button>
            <button disabled={(view.r.walletBalance ?? 0) < view.r.purchase.price} onClick={() => buy('WALLET', view.code, view.r)} className="rounded-2xl bg-emerald-500 px-10 py-4 text-2xl font-black disabled:opacity-40">{t('confirm')}</button>
          </div>
          {(view.r.walletBalance ?? 0) < view.r.purchase.price && <div className="text-xl text-amber-300">ยอดเงินไม่พอ / Insufficient balance</div>}
        </div>
      )}
      {view.k === 'waiting' && (
        <div className={cx(big, 'bg-slate-800')}>
          {view.method === 'PROMPTPAY' && view.qr ? <><div className="text-3xl font-bold">{t('scanToPay')}</div><div className="rounded-3xl bg-white p-4"><QR value={view.qr} size={260} /></div><div className="text-4xl font-black">{thb(view.r.purchase.price)}</div></> : null}
          {view.method === 'CARD' && <><CreditCard className="h-24 w-24 animate-pulse" /><div className="text-4xl font-bold">{t('tapCard')}</div></>}
          {view.method === 'CASH' && <><Banknote className="h-24 w-24" /><div className="text-4xl font-black">{t('waitingCash')}</div><div className="text-2xl">WAITING FOR CASH PAYMENT — {thb(view.r.purchase.price)}</div></>}
          <div className="flex items-center gap-2 text-white/60"><Loader2 className="h-5 w-5 animate-spin" />Waiting for payment confirmation…</div>
          {view.requestId && <button onClick={async () => { await sapi.post(`/api/rides/purchase-requests/${view.requestId}/cancel`).catch(() => {}); go({ k: 'idle' }); }} className="rounded-xl bg-white/15 px-6 py-2">{t('cancel')}</button>}
        </div>
      )}
      {view.k === 'queue' && (
        <div className={cx(big, 'pop bg-brand-700')}><Clock className="h-20 w-20" /><div className="text-2xl">{t('queueNo')}</div><div className="text-8xl font-black">{view.q?.queueNo}</div>
          <div className="text-3xl">{view.q?.peopleAhead} {t('peopleAhead')} · ~{view.q?.estimatedWaitMin} {t('minutes')}</div><div className="text-lg text-white/70">We will notify you when it is your turn.</div></div>
      )}
    </div>
  );
}
