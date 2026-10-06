import { useState } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Clock, Download, Printer, Upload } from 'lucide-react';
import { papi, errorMessage } from '../../lib/api';
import { useRealtime } from '../../lib/socket';
import { useT } from '../../lib/i18n';
import { fmtDate, thb } from '../../lib/format';
import { Badge, Button, Card, ErrorBox, Field, Input, KV, Loading, cx, toast } from '../../components/ui';
import { Barcode, QR } from '../../components/Codes';
import { printNode, TicketsPrint } from '../../components/Print';
import { usePublicConfig } from '../../lib/config';

export function BookingView() {
  const t = useT();
  const { no } = useParams();
  const [params] = useSearchParams();
  const token = params.get('token') ?? undefined;
  const qc = useQueryClient();
  const nav = useNavigate();
  const cfg = usePublicConfig();
  const q = useQuery({ queryKey: ['booking', no, token], queryFn: () => papi.get(`/api/public/bookings/${no}${token ? `?token=${token}` : ''}`) });
  const b = q.data;
  const [justPaid, setJustPaid] = useState(false);
  useRealtime([b ? `booking:${b.id}` : null], {
    'booking.updated': (e) => {
      qc.invalidateQueries({ queryKey: ['booking', no] });
      if (e.paymentStatus === 'PAID' || e.status === 'CONFIRMED') { setJustPaid(true); toast.success(t('paymentSuccess')); }
      if (e.paymentStatus === 'REJECTED') toast.error('Payment slip rejected — please upload a new slip');
      if (e.paymentStatus === 'NEW_SLIP_REQUESTED') toast.warning('Please upload a new slip');
    },
  }, { ctx: 'public', bookingToken: token });
  if (q.isLoading) return <Loading />;
  if (q.error) return <div className="mx-auto max-w-xl p-6"><ErrorBox error={q.error} /></div>;
  const paid = b.paymentStatus === 'PAID';
  const pending = b.payments.find((p: any) => ['PENDING', 'WAITING_VERIFICATION'].includes(p.status));
  const statusLabel = b.status === 'RESERVED' ? 'RESERVED — PAYMENT PENDING' : b.status;
  return (
    <div className="mx-auto max-w-3xl space-y-4 px-4 py-8">
      <div className={cx('rounded-3xl p-6 text-center text-white shadow-xl', paid ? 'bg-gradient-to-br from-emerald-500 to-emerald-700' : 'bg-gradient-to-br from-brand-600 to-brand-900')}>
        {paid ? <CheckCircle2 className={cx('mx-auto h-14 w-14', justPaid && 'pop')} /> : <Clock className="mx-auto h-12 w-12" />}
        <div className="mt-2 text-2xl font-extrabold">{paid ? (justPaid ? `✓ ${t('paymentSuccess')}` : t('bookingConfirmed')) : b.status === 'PENDING_VERIFICATION' ? t('waitingVerification') : statusLabel}</div>
        <div className="mt-1 text-white/80">{t('bookingNo')}</div>
        <div className="font-mono text-3xl font-bold tracking-wider">{b.booking_no}</div>
        {b.qr && (
          <div className="mx-auto mt-4 w-fit rounded-2xl bg-white p-4">
            <QR value={b.qr} size={200} />
            <Barcode value={b.barcode} height={50} width={1.6} />
          </div>
        )}
        <div className="mt-3 text-sm text-white/90">{t('saveScreen')}</div>
      </div>

      <Card>
        <KV k={t('visitDate')} v={fmtDate(b.visit_date)} />
        <KV k={t('package')} v={b.items.filter((i: any) => i.item_type === 'PACKAGE').map((i: any) => `${i.qty}× ${i.name}`).join(', ')} />
        <KV k={t('guests')} v={b.guests} />
        <KV k={t('total')} v={thb(b.total)} />
        <KV k={t('paymentStatus')} v={<Badge>{b.paymentStatus}</Badge>} />
        <KV k="Status" v={<Badge>{b.status}</Badge>} />
        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="outline" icon={<Printer className="h-4 w-4" />} onClick={() => printNode(<TicketsPrint d={{ parkName: cfg.data?.park.name, tickets: b.tickets.map((x: any) => ({ ...x, barcode: null })) }} />)}>{t('print')}</Button>
          <Button variant="outline" icon={<Download className="h-4 w-4" />} onClick={() => { navigator.clipboard?.writeText(window.location.href); toast.success('Link copied — bookmark this page'); }}>Save Ticket</Button>
        </div>
      </Card>

      {!paid && ['PENDING_PAYMENT', 'RESERVED', 'PENDING_VERIFICATION'].includes(b.status) && (
        <PaymentPanel booking={b} pending={pending} token={token} onRefresh={() => qc.invalidateQueries({ queryKey: ['booking', no] })} onCheckout={(url) => nav(`${url}?return=${encodeURIComponent(window.location.pathname + window.location.search)}`)} />
      )}

      {paid && (
        <Card title={t('tickets')}>
          <div className="grid gap-3 sm:grid-cols-2">
            {b.tickets.map((tk: any) => (
              <div key={tk.id} className="flex items-center gap-3 rounded-xl border border-slate-200 p-3">
                {tk.qr && ['ACTIVE', 'PAID'].includes(tk.status) ? <QR value={tk.qr} size={96} /> : <div className="h-24 w-24 rounded bg-slate-100" />}
                <div className="text-sm">
                  <div className="font-bold">{tk.ticket_type}</div><div className="font-mono text-xs">{tk.ticket_code}</div>
                  <Badge>{tk.presence === 'INSIDE' ? 'INSIDE' : tk.status}</Badge>
                  {tk.wristbands?.length > 0 && <div className="mt-1 text-xs text-slate-500">Wristband {tk.wristbands.map((w: any) => w.code).join(', ')}</div>}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

function PaymentPanel({ booking, pending, token, onRefresh, onCheckout }: { booking: any; pending: any; token?: string; onRefresh: () => void; onCheckout: (url: string) => void }) {
  const t = useT();
  const cfg = usePublicConfig();
  const [busy, setBusy] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [ref, setRef] = useState('');
  const methods = cfg.data?.paymentMethods.filter((m) => m.online && !['WALLET', 'POINTS', 'CASH'].includes(m.method)) ?? [];
  const pay = async (method: string) => {
    setBusy(true);
    try {
      const p = await papi.post(`/api/public/bookings/${booking.booking_no}/pay`, { token, method });
      if (p.checkoutUrl) onCheckout(p.checkoutUrl); else onRefresh();
    } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  };
  const submitSlip = async () => {
    if (!pending) return;
    setBusy(true);
    try {
      if (file) {
        const form = new FormData();
        form.append('token', token ?? '');
        form.append('reference', ref);
        form.append('slip', file);
        await papi.upload(`/api/public/payments/${pending.id}/slip`, form);
      } else {
        await papi.post(`/api/public/payments/${pending.id}/slip`, { token, reference: ref });
      }
      toast.success(t('waitingVerification'));
      onRefresh();
    } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  };
  const qr = pending?.provider_payload?.qrPayload;
  return (
    <Card title={t('payment')}>
      {booking.status === 'PENDING_VERIFICATION' ? (
        <div className="flex items-center gap-3 rounded-xl bg-amber-50 p-4 text-amber-800"><Clock className="h-6 w-6 animate-pulse" />
          <div><div className="font-bold">{t('waitingVerification')}</div><div className="text-sm">ระบบจะอัปเดตหน้านี้อัตโนมัติเมื่อตรวจสอบเสร็จ / This page updates automatically.</div></div></div>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap gap-2">{methods.map((m) => <Button key={m.method} variant={pending?.method === m.method ? 'primary' : 'outline'} onClick={() => pay(m.method)} loading={busy}>{m.method.replace('_', ' ')}</Button>)}</div>
          {qr && (
            <div className="grid items-center gap-4 sm:grid-cols-[auto_1fr]">
              <div className="rounded-2xl border border-slate-200 p-3 text-center"><div className="mb-1 text-xs font-bold text-sky-800">PromptPay</div><QR value={qr} size={200} /><div className="mt-1 font-bold">{thb(pending.amount)}</div></div>
              <div className="space-y-3">
                <div className="text-sm text-slate-600">{t('scanToPay')} — หลังโอนแล้วกรุณาอัปโหลดสลิป หรือกด “{t('checkPayment')}”</div>
                <Field label={t('uploadSlip')}><Input type="file" accept="image/png,image/jpeg,application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></Field>
                <Field label="Reference (optional)"><Input value={ref} onChange={(e) => setRef(e.target.value)} /></Field>
                <Button onClick={submitSlip} loading={busy} icon={<Upload className="h-4 w-4" />}>{file ? t('uploadSlip') : t('checkPayment')}</Button>
              </div>
            </div>
          )}
          {cfg.data?.simulator && pending && <div className="mt-3 rounded-lg bg-slate-50 p-2 text-xs text-slate-500">Dev: <button className="underline" onClick={async () => { await papi.post(`/api/public/payments/${pending.id}/simulate`, { outcome: 'SUCCESS' }); }}>simulate gateway payment</button></div>}
        </>
      )}
    </Card>
  );
}
