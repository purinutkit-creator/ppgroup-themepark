import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, Loader2, ShieldAlert, UserCheck, XCircle } from 'lucide-react';
import { sapi, ApiError } from '../../lib/api';
import { useRealtime } from '../../lib/socket';
import { useKeyboardScanner } from '../../lib/scanner';
import { offlineQueue, useOnline } from '../../lib/offline';
import { useSurfaceFont } from '../../lib/config';
import { CameraScanner } from '../../components/CameraScanner';
import { cx } from '../../components/ui';
import { DeviceGuard } from './DeviceShell';

type Mode = 'WAITING' | 'VALIDATING' | 'WAITING_APPROVAL' | 'GRANTED' | 'DENIED' | 'EMERGENCY' | 'OFFLINE';
interface DisplayState { mode: Mode; reason?: { th: string; en: string }; customer?: string | null; ticketType?: string | null; direction?: string; manual?: boolean }

export function GateDisplay() {
  return <DeviceGuard need="GATE_SCANNER"><GateDisplayInner /></DeviceGuard>;
}

/**
 * Customer-facing gate display: full-screen camera scanner + USB scanner support.
 * Shows WAITING → VALIDATING → GRANTED (green) / DENIED (red + reason) → auto reset.
 * Decisions taken on the Gate Operator Console arrive in realtime.
 */
function GateDisplayInner() {
  useSurfaceFont('gate');
  const { gateId } = useParams();
  const online = useOnline();
  const gate = useQuery({ queryKey: ['gate', gateId], queryFn: () => sapi.get(`/api/gates/${gateId}`) });
  const [st, setSt] = useState<DisplayState>({ mode: 'WAITING' });
  const timer = useRef<number | null>(null);
  const show = (s: DisplayState, resetAfterMs?: number) => {
    setSt(s);
    if (timer.current) window.clearTimeout(timer.current);
    if (resetAfterMs) timer.current = window.setTimeout(() => setSt({ mode: 'WAITING' }), resetAfterMs);
  };
  useRealtime([gateId ? `gate:${gateId}` : null], {
    'gate.display': (d) => {
      if (d.mode === 'WAITING') return show({ mode: 'WAITING' });
      if (d.mode === 'EMERGENCY') return show({ mode: 'EMERGENCY' });
      show({ mode: d.mode, reason: d.reason, customer: d.customer, ticketType: d.ticketType, direction: d.direction, manual: d.manual }, d.mode === 'GRANTED' || d.mode === 'DENIED' ? d.resetAfterMs ?? 2500 : undefined);
    },
    'gate.state': (d) => { if (d.state === 'EMERGENCY') show({ mode: 'EMERGENCY' }); else if (d.state === 'IDLE' && st.mode === 'EMERGENCY') show({ mode: 'WAITING' }); },
  });
  useEffect(() => { if (gate.data?.emergency) setSt({ mode: 'EMERGENCY' }); }, [gate.data]);
  const locked = st.mode !== 'WAITING';
  const onScan = async (code: string) => {
    if (locked && st.mode !== 'OFFLINE') return;
    show({ mode: 'VALIDATING' });
    try {
      const r = await sapi.post(`/api/gates/${gateId}/scan`, { code });
      if (r.result === 'DENIED') show({ mode: 'DENIED', reason: r.reason, customer: r.customer }, 2800);
      else if (r.result === 'PENDING') show({ mode: 'WAITING_APPROVAL', customer: r.customer, ticketType: r.ticketType });
      else show({ mode: 'GRANTED', customer: r.customer, ticketType: r.ticketType, direction: r.direction }, 2800);
    } catch (e) {
      if (e instanceof ApiError && e.status === 0) {
        if (gate.data?.direction === 'EXIT') { offlineQueue.add('gate.exit', { gateId, code }, `Exit scan ${gate.data?.name}`); show({ mode: 'GRANTED', direction: 'OUT' }, 2500); }
        else show({ mode: 'OFFLINE' }, 3500);
      } else if (e instanceof ApiError && e.code === 'GATE_BUSY') show({ mode: 'WAITING_APPROVAL' });
      else show({ mode: 'DENIED', reason: { th: (e as Error).message, en: (e as ApiError).code ?? 'ERROR' } }, 3000);
    }
  };
  useKeyboardScanner(onScan, { enabled: !locked });

  const bg = { WAITING: 'bg-slate-900', VALIDATING: 'bg-slate-800', WAITING_APPROVAL: 'bg-amber-500', GRANTED: 'bg-emerald-600', DENIED: 'bg-rose-600', EMERGENCY: 'bg-rose-700', OFFLINE: 'bg-slate-700' }[st.mode];
  return (
    <div className={cx('relative flex h-full flex-col text-white transition-colors duration-200', bg)}>
      <div className="flex items-center justify-between px-6 py-3 text-lg font-bold">
        <span>{gate.data?.name ?? 'Gate'}</span>
        <span className={cx('rounded-full px-3 py-1 text-xs', online ? 'bg-white/15' : 'bg-rose-500')}>{online ? (gate.data?.direction === 'EXIT' ? 'EXIT' : 'ENTRANCE') : 'OFFLINE'}</span>
      </div>
      {st.mode === 'WAITING' || st.mode === 'VALIDATING' ? (
        <div className="relative flex-1">
          <CameraScanner className="absolute inset-0" onScan={onScan} locked={locked} />
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-8 text-center">
            {st.mode === 'VALIDATING' ? (
              <div className="flex items-center justify-center gap-3 text-4xl font-bold"><Loader2 className="h-10 w-10 animate-spin" />กำลังตรวจสอบ… <span className="text-2xl text-white/70">Checking…</span></div>
            ) : (
              <><div className="text-4xl font-bold md:text-5xl">กรุณาแสดง QR Code / Barcode</div><div className="mt-2 text-2xl text-white/80">Please show your QR Code / Barcode</div><div className="mt-1 text-xl text-white/60">请出示二维码 / 条形码</div></>
            )}
          </div>
        </div>
      ) : (
        <div className="pop flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
          {st.mode === 'GRANTED' && <><CheckCircle2 className="h-40 w-40" strokeWidth={2.5} /><div className="text-6xl font-black md:text-7xl">✓ ACCESS GRANTED</div>
            <div className="text-5xl font-bold">{st.direction === 'OUT' ? 'ขอบคุณที่มาเที่ยว' : 'ผ่านได้'}</div>
            {st.customer && <div className="text-3xl text-white/90">{st.customer}</div>}{st.ticketType && <div className="text-2xl text-white/80">{st.ticketType}</div>}</>}
          {st.mode === 'DENIED' && <><XCircle className="h-40 w-40" strokeWidth={2.5} /><div className="text-6xl font-black md:text-7xl">✕ ACCESS DENIED</div>
            <div className="text-5xl font-bold">{st.reason?.th}</div><div className="text-3xl text-white/80">{st.reason?.en}</div></>}
          {st.mode === 'WAITING_APPROVAL' && <><UserCheck className="h-32 w-32" /><div className="text-5xl font-black">กรุณารอเจ้าหน้าที่ตรวจสอบ</div><div className="text-3xl">Please wait for staff approval</div>
            {st.customer && <div className="text-2xl">{st.customer}</div>}</>}
          {st.mode === 'EMERGENCY' && <><ShieldAlert className="h-40 w-40" /><div className="text-6xl font-black">EMERGENCY</div><div className="text-4xl">ประตูเปิดฉุกเฉิน — กรุณาปฏิบัติตามเจ้าหน้าที่</div></>}
          {st.mode === 'OFFLINE' && <><ShieldAlert className="h-32 w-32" /><div className="text-5xl font-black">OFFLINE</div><div className="text-3xl">ระบบออฟไลน์ กรุณาติดต่อเจ้าหน้าที่ / Please see staff</div></>}
        </div>
      )}
    </div>
  );
}
