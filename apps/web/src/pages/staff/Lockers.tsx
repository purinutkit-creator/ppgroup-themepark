import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, Lock, Unlock } from 'lucide-react';
import { sapi, errorMessage, newKey, qs } from '../../lib/api';
import { useBranchId } from '../../lib/auth';
import { useRealtime } from '../../lib/socket';
import { fmtTime, thb } from '../../lib/format';
import { ScanBox } from '../../components/ScanBox';
import { Badge, Button, Card, Field, Loading, Modal, PageHeader, Select, cx, toast } from '../../components/ui';

export function Lockers() {
  const branchId = useBranchId();
  const qc = useQueryClient();
  const board = useQuery({ queryKey: ['lockers', branchId], queryFn: () => sapi.get(`/api/lockers${qs({ branchId })}`), enabled: !!branchId });
  const rates = useQuery({ queryKey: ['locker-rates', branchId], queryFn: () => sapi.get(`/api/lockers/rates${qs({ branchId })}`), enabled: !!branchId });
  const [rent, setRent] = useState<{ lockerId?: string; code?: string } | null>(null);
  const [scan, setScan] = useState('');
  const [rateId, setRateId] = useState('');
  const [method, setMethod] = useState('WALLET');
  useRealtime([branchId ? `branch:${branchId}` : null], { 'locker.updated': () => qc.invalidateQueries({ queryKey: ['lockers', branchId] }) });
  const submit = async () => {
    try { const r = await sapi.post('/api/lockers/rent', { code: scan, rateId, lockerId: rent?.lockerId ?? null, method }, { idempotencyKey: newKey() }); toast.success(`Locker ${r.session?.locker_code} unlocked`); setRent(null); setScan(''); qc.invalidateQueries({ queryKey: ['lockers', branchId] }); }
    catch (e) { toast.error(errorMessage(e)); }
  };
  if (!board.data) return <Loading />;
  return (
    <div className="space-y-4">
      <PageHeader title="Locker System" subtitle={`${board.data.filter((l: any) => l.status === 'OCCUPIED').length} / ${board.data.length} occupied`} actions={<Button icon={<KeyRound className="h-4 w-4" />} onClick={() => setRent({})}>Rent locker (auto-assign)</Button>} />
      <Card title="Open locker with wristband"><ScanBox onScan={async (c) => { try { const r = await sapi.post('/api/lockers/open', { code: c }); toast.success(`Locker ${r.lockerCode} opened`); } catch (e) { toast.error(errorMessage(e)); } }} placeholder="Scan wristband to open its locker" /></Card>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-5 md:grid-cols-6 xl:grid-cols-10">
        {board.data.map((l: any) => (
          <button key={l.id} onClick={() => l.status === 'AVAILABLE' ? setRent({ lockerId: l.id, code: l.code }) : l.session_id && confirm(`End session of ${l.code}?`) && sapi.post(`/api/lockers/sessions/${l.session_id}/end`).then(() => qc.invalidateQueries({ queryKey: ['lockers', branchId] }))}
            className={cx('rounded-xl border-2 p-2 text-left text-xs', l.status === 'AVAILABLE' ? 'border-emerald-300 bg-emerald-50' : l.overdue ? 'border-rose-400 bg-rose-50' : l.status === 'OCCUPIED' ? 'border-violet-300 bg-violet-50' : 'border-slate-300 bg-slate-100')}>
            <div className="flex items-center justify-between font-bold">{l.code}{l.status === 'AVAILABLE' ? <Unlock className="h-3.5 w-3.5 text-emerald-600" /> : <Lock className="h-3.5 w-3.5" />}</div>
            <div>{l.size} · {l.bank}</div>
            {l.status === 'OCCUPIED' && <div className="truncate text-[10px]">{l.credential_code}<br />until {fmtTime(l.expire_at)}</div>}
            {l.overdue && <Badge tone="red">OVERDUE</Badge>}
          </button>
        ))}
      </div>
      <Modal open={!!rent} onClose={() => setRent(null)} title={rent?.code ? `Rent ${rent.code}` : 'Rent locker'} footer={<Button onClick={submit} disabled={!scan || !rateId}>Pay & unlock</Button>}>
        <div className="space-y-3">
          <ScanBox compact global={false} onScan={(c) => { setScan(c); toast.info('Card captured'); }} placeholder={scan ? `Card: ${scan.slice(0, 18)}…` : 'Scan wristband'} />
          <Field label="Duration"><Select value={rateId} onChange={(e) => setRateId(e.target.value)}><option value="">Select…</option>{rates.data?.map((r: any) => <option key={r.id} value={r.id} disabled={!r.available}>{r.size} · {r.name} · {thb(r.price)} ({r.available} free)</option>)}</Select></Field>
          <Field label="Payment"><Select value={method} onChange={(e) => setMethod(e.target.value)}><option value="WALLET">Wallet</option><option value="CASH">Cash</option><option value="CARD">Card</option></Select></Field>
        </div>
      </Modal>
    </div>
  );
}
