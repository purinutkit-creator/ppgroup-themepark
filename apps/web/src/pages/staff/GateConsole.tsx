import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertOctagon, Check, CheckCircle2, DoorOpen, Monitor, RotateCcw, ShieldAlert, Siren, Users, X, XCircle } from 'lucide-react';
import { Link } from 'react-router-dom';
import { sapi, errorMessage, qs } from '../../lib/api';
import { useBranchId, useCan } from '../../lib/auth';
import { useRealtime } from '../../lib/socket';
import { fmtDate, fmtTime, num } from '../../lib/format';
import { withApproval } from '../../components/Approval';
import { Badge, Button, Card, Loading, Modal, Toggle, cx, toast } from '../../components/ui';

interface ScanEvt {
  gateId: string; gateName: string; scanId: string; result: string; reasonCode?: string; reason?: { th: string; en: string } | null; direction: string;
  checks: Array<{ code: string; label: string; ok: boolean; detail?: string; warn?: boolean }>; isDuplicate?: boolean; duplicateOf?: any;
  customer?: string | null; ticketCode?: string | null; ticketType?: string | null; visitDate?: string | null; ticketStatus?: string | null; credentialCode?: string | null; scannedAt: string; mode?: string;
}

const STATE_STYLE: Record<string, string> = {
  IDLE: 'border-slate-200 bg-white', SCANNING: 'border-sky-300 bg-sky-50', VALIDATING: 'border-sky-400 bg-sky-50', WAITING_APPROVAL: 'border-amber-400 bg-amber-50 flash-ring',
  APPROVED: 'border-emerald-500 bg-emerald-50', OPENING: 'border-emerald-500 bg-emerald-100', OPEN: 'border-emerald-500 bg-emerald-200', CLOSING: 'border-emerald-300 bg-emerald-50',
  DENIED: 'border-rose-500 bg-rose-50', ERROR: 'border-rose-600 bg-rose-100', OFFLINE: 'border-slate-400 bg-slate-200', EMERGENCY: 'border-rose-700 bg-rose-200',
};

/** One screen, all gates: highlights the gate that scanned and lets the operator APPROVE / DENY. */
export function GateConsole() {
  const branchId = useBranchId();
  const can = useCan();
  const qc = useQueryClient();
  const gates = useQuery({ queryKey: ['gates', branchId], queryFn: () => sapi.get(`/api/gates${qs({ branchId })}`), enabled: !!branchId });
  const occ = useQuery({ queryKey: ['occ', branchId], queryFn: () => sapi.get(`/api/occupancy${qs({ branchId })}`), enabled: !!branchId });
  const [states, setStates] = useState<Record<string, string>>({});
  const [lastScan, setLastScan] = useState<Record<string, ScanEvt>>({});
  const [focus, setFocus] = useState<string | null>(null);
  const [alerts, setAlerts] = useState<any[]>([]);
  const [flash, setFlash] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const [emergency, setEmergency] = useState(false);
  const audio = useRef<AudioContext | null>(null);
  const beep = (freq = 880) => {
    try {
      audio.current ??= new AudioContext();
      const o = audio.current.createOscillator(); const g = audio.current.createGain();
      o.frequency.value = freq; o.connect(g); g.connect(audio.current.destination); g.gain.value = 0.08; o.start(); o.stop(audio.current.currentTime + 0.15);
    } catch { /* no audio */ }
  };
  useEffect(() => {
    if (!gates.data) return;
    setStates(Object.fromEntries(gates.data.map((g: any) => [g.id, g.state])));
    setEmergency(gates.data.some((g: any) => g.emergency));
  }, [gates.data]);
  useRealtime([branchId ? `gates:${branchId}` : null], {
    'gate.state': (e) => setStates((s) => ({ ...s, [e.gateId]: e.state })),
    'gate.scan': (e: ScanEvt) => {
      setLastScan((s) => ({ ...s, [e.gateId]: e }));
      setFlash((f) => ({ ...f, [e.gateId]: Date.now() }));
      if (e.result === 'PENDING') { setFocus(e.gateId); beep(880); } else { if (e.result === 'DENIED') beep(300); qc.invalidateQueries({ queryKey: ['gates', branchId] }); }
      qc.invalidateQueries({ queryKey: ['occ', branchId] });
    },
    'gate.decision': (e) => {
      qc.invalidateQueries({ queryKey: ['gates', branchId] });
      setLastScan((s) => (s[e.gateId] && s[e.gateId].scanId === e.scanId ? { ...s, [e.gateId]: { ...s[e.gateId], result: e.result } } : s));
      setFocus((f) => (f === e.gateId ? null : f));
    },
    'gate.security': (e) => { setAlerts((a) => [{ ...e, at: Date.now() }, ...a].slice(0, 5)); beep(220); },
    'occupancy.changed': (o) => qc.setQueryData(['occ', branchId], (d: any) => (d ? { ...d, ...o } : d)),
    'gate.config': () => qc.invalidateQueries({ queryKey: ['gates', branchId] }),
  });
  const list: any[] = gates.data ?? [];
  const entries = list.filter((g) => g.direction !== 'EXIT');
  const exits = list.filter((g) => g.direction === 'EXIT');
  const pending = useMemo(() => Object.values(lastScan).filter((s) => s.result === 'PENDING' && states[s.gateId] === 'WAITING_APPROVAL'), [lastScan, states]);
  const focused = focus ? lastScan[focus] : null;

  const decide = async (gateId: string, decision: 'approve' | 'deny', scanId?: string) => {
    setBusy(true);
    try {
      await sapi.post(`/api/gates/${gateId}/${decision}`, { scanId, reason: decision === 'deny' ? 'Denied by operator' : undefined });
      setFocus(null);
    } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  };
  const manualOpen = async (g: any) => {
    const reason = prompt(`Manual open ${g.name} — reason?`);
    if (!reason) return;
    try { await withApproval('MANUAL_GATE_OPEN', (approvalId) => sapi.post(`/api/gates/${g.id}/open`, { reason, approvalId }), reason); toast.success(`${g.name} opened`); }
    catch (e) { toast.error(errorMessage(e)); }
  };
  const override = async (s: ScanEvt) => {
    const reason = prompt('Supervisor override reason?');
    if (!reason) return;
    try { await withApproval('GATE_OVERRIDE', (approvalId) => sapi.post(`/api/gates/${s.gateId}/scans/${s.scanId}/override`, { reason, approvalId }), reason); toast.success('Override approved'); }
    catch (e) { toast.error(errorMessage(e)); }
  };
  const toggleEmergency = async () => {
    const reason = prompt(emergency ? 'Clear emergency — reason?' : 'ACTIVATE EMERGENCY MODE — reason?');
    if (!reason) return;
    try { await sapi.post('/api/gates/emergency', { active: !emergency, reason, branchId }); setEmergency(!emergency); qc.invalidateQueries({ queryKey: ['gates', branchId] }); }
    catch (e) { toast.error(errorMessage(e)); }
  };
  if (gates.isLoading) return <Loading />;

  const GateCard = ({ g }: { g: any }) => {
    const st = states[g.id] ?? g.state;
    const s = lastScan[g.id];
    const ls = s ?? (g.last_scan ? { result: g.last_scan.result, customer: g.last_scan.member_name ?? g.last_scan.guest_name, ticketCode: g.last_scan.ticket_code,
      ticketType: [g.last_scan.package_name, g.last_scan.ticket_type_name].filter(Boolean).join(' — '), scannedAt: g.last_scan.scanned_at, reason: g.last_scan.reason ? { th: g.last_scan.reason, en: g.last_scan.reason } : null, isDuplicate: g.last_scan.is_duplicate } : null);
    const recent = flash[g.id] && Date.now() - flash[g.id] < 4000;
    return (
      <div onClick={() => s && setFocus(g.id)} className={cx('relative flex min-h-[150px] cursor-pointer flex-col rounded-2xl border-2 p-3 transition', STATE_STYLE[st] ?? STATE_STYLE.IDLE, recent && st !== 'WAITING_APPROVAL' && 'ring-4 ring-brand-300', !g.is_enabled && 'opacity-50')}>
        <div className="flex items-start justify-between">
          <div><div className="text-lg font-black leading-none">{g.name}</div><div className="mt-1 text-[11px] text-slate-500">{g.mode} · {g.direction}</div></div>
          <Badge>{st}</Badge>
        </div>
        {ls ? (
          <div className="mt-2 flex-1 text-xs">
            <div className="flex items-center gap-1 font-semibold">
              {['APPROVED', 'AUTO_APPROVED'].includes(ls.result) ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : ls.result === 'DENIED' ? <XCircle className="h-4 w-4 text-rose-600" /> : <AlertOctagon className="h-4 w-4 text-amber-600" />}
              {ls.isDuplicate ? 'DUPLICATE ATTEMPT' : ls.result.replace('_', ' ')}<span className="ml-auto font-normal text-slate-500">{fmtTime(ls.scannedAt)}</span>
            </div>
            <div className="truncate text-slate-700">{ls.customer ?? '—'}</div>
            <div className="truncate text-slate-500">{ls.ticketType || ls.ticketCode || ls.reason?.en}</div>
          </div>
        ) : <div className="mt-2 flex-1 text-xs text-slate-400">No scans yet</div>}
        {st === 'WAITING_APPROVAL' && s?.result === 'PENDING' && can('gate.approve') && (
          <div className="mt-2 grid grid-cols-2 gap-1.5" onClick={(e) => e.stopPropagation()}>
            <Button size="sm" variant="danger" onClick={() => decide(g.id, 'deny', s.scanId)} disabled={busy}>DENY</Button>
            <Button size="sm" variant="success" onClick={() => decide(g.id, 'approve', s.scanId)} disabled={busy}>APPROVE</Button>
          </div>
        )}
        <div className="mt-1 flex justify-between text-[10px] text-slate-500"><span>✓{g.stats?.approved ?? 0} ✕{g.stats?.denied ?? 0} ⚠{g.stats?.duplicate ?? 0}</span>
          <Link to={`/gate/${g.id}/display`} target="_blank" onClick={(e) => e.stopPropagation()} className="hover:text-brand-600"><Monitor className="inline h-3 w-3" /> display</Link></div>
      </div>
    );
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-bold">Gate Operator Console</h1>
        {occ.data && <div className="flex items-center gap-2 rounded-xl bg-white px-3 py-1.5 shadow-sm"><Users className="h-4 w-4 text-brand-600" /><b className="tabular-nums">{num(occ.data.inside)}</b><span className="text-slate-400">/ {num(occ.data.capacity)}</span>
          <span className={cx('rounded px-1.5 text-xs font-bold', occ.data.percent >= 90 ? 'bg-rose-100 text-rose-700' : occ.data.percent >= 80 ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700')}>{occ.data.percent}%</span></div>}
        {pending.length > 0 && <Badge tone="amber">{pending.length} waiting approval</Badge>}
        <div className="ml-auto flex gap-2">
          <Link to="/staff/gates/log"><Button variant="outline" size="sm">Entry log</Button></Link>
          {can('gate.emergency') && <Button size="sm" variant={emergency ? 'success' : 'danger'} icon={<Siren className="h-4 w-4" />} onClick={toggleEmergency}>{emergency ? 'Clear emergency' : 'EMERGENCY'}</Button>}
        </div>
      </div>
      {emergency && <div className="rounded-xl bg-rose-600 p-3 text-center font-bold text-white">EMERGENCY MODE ACTIVE — all gates released</div>}
      {alerts.map((a, i) => (
        <div key={a.at + i} className="pop flex items-start gap-3 rounded-xl border-2 border-rose-400 bg-rose-50 p-3">
          <ShieldAlert className="h-6 w-6 shrink-0 text-rose-600" />
          <div className="flex-1 text-sm">
            <div className="font-black text-rose-700">{a.gateName} — DUPLICATE ENTRY ATTEMPT</div>
            <div>Ticket: <b className="font-mono">{a.ticketCode}</b></div>
            {a.firstEntry && <div>First Entry: {a.firstEntry.gate} — {fmtTime(a.firstEntry.at)}</div>}
            <div>Second Attempt: {a.attempt.gate} — {fmtTime(a.attempt.at)}</div>
          </div>
          <button onClick={() => setAlerts(alerts.filter((x) => x !== a))} className="text-rose-400"><X className="h-5 w-5" /></button>
        </div>
      ))}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">{entries.map((g) => <GateCard key={g.id} g={g} />)}</div>
      {exits.length > 0 && <>
        <div className="pt-2 text-xs font-bold uppercase tracking-wider text-slate-500">Exit gates</div>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">{exits.map((g) => <GateCard key={g.id} g={g} />)}</div>
      </>}

      <Modal open={!!focused} onClose={() => setFocus(null)} size="md" title={<span className="flex items-center gap-2"><DoorOpen className="h-5 w-5" />{focused?.gateName} <Badge>{focus ? states[focus] : ''}</Badge></span>}
        footer={focused && <div className="flex w-full flex-wrap gap-2">
          {can('gate.open') && <Button variant="outline" onClick={() => manualOpen(list.find((g) => g.id === focused.gateId))}>Manual open</Button>}
          {can('gate.override') && focused.result === 'DENIED' && <Button variant="warning" onClick={() => override(focused)}>Supervisor override</Button>}
          {can('gate.manage') && <Button variant="ghost" icon={<RotateCcw className="h-4 w-4" />} onClick={() => sapi.post(`/api/gates/${focused.gateId}/reset`).catch((e) => toast.error(errorMessage(e)))}>Reset</Button>}
          <div className="flex-1" />
          {focused.result === 'PENDING' && states[focused.gateId] === 'WAITING_APPROVAL' && can('gate.approve') && <>
            <Button size="lg" variant="danger" onClick={() => decide(focused.gateId, 'deny', focused.scanId)} loading={busy} icon={<X className="h-5 w-5" />}>DENY ENTRY</Button>
            <Button size="lg" variant="success" onClick={() => decide(focused.gateId, 'approve', focused.scanId)} loading={busy} icon={<Check className="h-5 w-5" />}>APPROVE ENTRY</Button>
          </>}
        </div>}>
        {focused && (
          <div className="space-y-3">
            {focused.isDuplicate && <div className="rounded-lg bg-rose-600 p-2 text-center font-black text-white">DUPLICATE ENTRY ATTEMPT</div>}
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div><div className="text-xs text-slate-500">Customer</div><div className="font-semibold">{focused.customer ?? '—'}</div></div>
              <div><div className="text-xs text-slate-500">Ticket</div><div className="font-mono font-semibold">{focused.ticketCode ?? focused.credentialCode ?? '—'}</div></div>
              <div><div className="text-xs text-slate-500">Ticket Type</div><div className="font-semibold">{focused.ticketType ?? '—'}</div></div>
              <div><div className="text-xs text-slate-500">Visit Date</div><div className="font-semibold">{focused.visitDate ? fmtDate(focused.visitDate) : '—'}</div></div>
              <div><div className="text-xs text-slate-500">Status</div><div><Badge>{focused.ticketStatus ?? focused.result}</Badge></div></div>
              <div><div className="text-xs text-slate-500">Scan Time</div><div className="font-semibold">{fmtTime(focused.scannedAt)}</div></div>
            </div>
            <div className="rounded-xl bg-slate-50 p-3">
              <div className="mb-1 text-xs font-bold uppercase text-slate-500">Validation</div>
              {focused.checks.map((c) => (
                <div key={c.code} className={cx('flex items-center gap-2 py-0.5 text-sm', c.ok ? (c.warn ? 'text-amber-700' : 'text-emerald-700') : 'text-rose-700')}>
                  {c.ok ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}{c.label}{c.detail && <span className="text-xs text-slate-500">({c.detail})</span>}
                </div>
              ))}
            </div>
            {focused.reason && <div className="rounded-lg bg-rose-50 p-2 text-sm text-rose-700"><b>{focused.reason.en}</b> — {focused.reason.th}</div>}
            {focused.duplicateOf && <div className="text-sm">First Entry: <b>{focused.duplicateOf.gate_name}</b> — {fmtTime(focused.duplicateOf.entry_time)}</div>}
            {can('gate.manage') && (
              <div className="flex items-center gap-4 border-t pt-3 text-sm">
                <Toggle checked={list.find((g) => g.id === focused.gateId)?.mode === 'AUTO'} label="AUTO mode" onChange={(v) => sapi.patch(`/api/gates/${focused.gateId}/mode`, { mode: v ? 'AUTO' : 'MANUAL' }).then(() => qc.invalidateQueries({ queryKey: ['gates', branchId] }))} />
                <Toggle checked={!!list.find((g) => g.id === focused.gateId)?.block_new_entry} label="Block new entry" onChange={(v) => sapi.patch(`/api/gates/${focused.gateId}/mode`, { blockNewEntry: v }).then(() => qc.invalidateQueries({ queryKey: ['gates', branchId] }))} />
              </div>
            )}
          </div>
        )}
      </Modal>
      {!focused && pending.length === 0 && <Card className="text-center text-sm text-slate-500">Waiting for scans… cards flash and open automatically when a gate needs approval.</Card>}
    </div>
  );
}
