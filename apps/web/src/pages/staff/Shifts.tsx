import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { sapi, errorMessage, qs } from '../../lib/api';
import { useBranchId, useCan } from '../../lib/auth';
import { fmtDateTime, thb, toSatang } from '../../lib/format';
import { withApproval } from '../../components/Approval';
import { Badge, Button, Card, Field, Input, KV, Loading, PageHeader, Select, Table, toast } from '../../components/ui';

export function Shifts() {
  const branchId = useBranchId();
  const can = useCan();
  const qc = useQueryClient();
  const cur = useQuery({ queryKey: ['shift-current'], queryFn: () => sapi.get('/api/shifts/current'), enabled: can('shift.open') });
  const all = useQuery({ queryKey: ['shifts', branchId], queryFn: () => sapi.get(`/api/shifts${qs({ branchId })}`), enabled: can('shift.manage') && !!branchId });
  const stores = useQuery({ queryKey: ['stores', branchId], queryFn: () => sapi.get(`/api/public/stores${qs({ branchId })}`), enabled: !!branchId });
  const [opening, setOpening] = useState('2000');
  const [store, setStore] = useState('');
  const [actual, setActual] = useState('');
  const [mv, setMv] = useState({ type: 'CASH_OUT', amount: '', reason: '' });
  const refresh = () => { qc.invalidateQueries({ queryKey: ['shift-current'] }); qc.invalidateQueries({ queryKey: ['shifts'] }); };
  const s = cur.data;
  return (
    <div className="space-y-4">
      <PageHeader title="Shift Management" />
      {can('shift.open') && (cur.isLoading ? <Loading /> : !s ? (
        <Card title="Open shift">
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Opening cash (THB)"><Input inputMode="decimal" value={opening} onChange={(e) => setOpening(e.target.value)} /></Field>
            <Field label="Store / counter"><Select value={store} onChange={(e) => setStore(e.target.value)}><option value="">—</option>{stores.data?.map((x: any) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select></Field>
            <Button className="self-end" onClick={() => sapi.post('/api/shifts/open', { openingCash: toSatang(opening), storeId: store || null }).then(refresh).catch((e) => toast.error(errorMessage(e)))}>Open shift</Button>
          </div>
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card title={<span>Shift {s.shift.shift_no} <Badge>{s.shift.status}</Badge></span>}>
            <KV k="Opened" v={fmtDateTime(s.shift.opened_at)} />
            <KV k="Opening cash" v={thb(s.shift.opening_cash)} />
            <KV k="+ Cash sales" v={thb(s.cash_sales)} />
            <KV k="+ Cash top-up" v={thb(s.cash_topups)} />
            <KV k="+ Cash in" v={thb(s.cash_in)} />
            <KV k="− Refunds / cash-out" v={thb(s.cash_refunds)} />
            <KV k="− Cash out (payouts)" v={thb(s.cash_out)} />
            <KV k={<b>= Expected cash</b>} v={<b className="text-lg">{thb(s.expected_cash)}</b>} className="border-t pt-2" />
            <div className="mt-3 rounded-xl bg-slate-50 p-3">
              <div className="mb-1 text-xs font-bold uppercase text-slate-500">By method</div>
              {s.by_method.map((m: any) => <KV key={`${m.method}${m.type}`} k={`${m.method ?? '-'} · ${m.type}`} v={`${m.count} · ${thb(m.amount)}`} />)}
            </div>
          </Card>
          <div className="space-y-4">
            <Card title="Close shift">
              <Field label="Actual cash counted (THB)"><Input inputMode="decimal" value={actual} onChange={(e) => setActual(e.target.value)} /></Field>
              {actual && <div className="mt-2 text-sm">Over / Short: <b className={toSatang(actual) - s.expected_cash < 0 ? 'text-rose-600' : 'text-emerald-600'}>{thb(toSatang(actual) - s.expected_cash, { sign: true })}</b></div>}
              <Button className="mt-3" variant="danger" disabled={!actual} onClick={async () => {
                try { const r = await withApproval('SHIFT_OVER_SHORT', (approvalId) => sapi.post(`/api/shifts/${s.shift.id}/close`, { actualCash: toSatang(actual), approvalId })); if (r) { toast.success(`Shift closed · over/short ${thb(r.over_short)}`); setActual(''); refresh(); } }
                catch (e) { toast.error(errorMessage(e)); }
              }}>Close shift</Button>
            </Card>
            {can('shift.cash_movement') && (
              <Card title="Cash in / out">
                <div className="grid grid-cols-3 gap-2">
                  <Select value={mv.type} onChange={(e) => setMv({ ...mv, type: e.target.value })}><option value="CASH_OUT">Cash out</option><option value="CASH_IN">Cash in</option></Select>
                  <Input placeholder="Amount" value={mv.amount} onChange={(e) => setMv({ ...mv, amount: e.target.value })} />
                  <Input placeholder="Reason" value={mv.reason} onChange={(e) => setMv({ ...mv, reason: e.target.value })} />
                </div>
                <Button className="mt-2" size="sm" onClick={() => sapi.post('/api/shifts/cash-movement', { type: mv.type, amount: toSatang(mv.amount), reason: mv.reason }).then(() => { setMv({ type: 'CASH_OUT', amount: '', reason: '' }); refresh(); }).catch((e) => toast.error(errorMessage(e)))}>Record</Button>
              </Card>
            )}
          </div>
        </div>
      ))}
      {can('shift.manage') && (
        <Card title="All shifts" padded={false}>
          <Table dense rows={all.data ?? []} columns={[{ key: 'shift_no', header: 'Shift' }, { key: 'first_name', header: 'Staff', render: (r: any) => `${r.employee_code} ${r.first_name}` }, { key: 'store_name', header: 'Store' },
            { key: 'status', header: 'Status', render: (r: any) => <Badge>{r.status}</Badge> }, { key: 'opened_at', header: 'Opened', render: (r: any) => fmtDateTime(r.opened_at) }, { key: 'closed_at', header: 'Closed', render: (r: any) => fmtDateTime(r.closed_at) },
            { key: 'expected_cash', header: 'Expected', align: 'right', render: (r: any) => (r.expected_cash != null ? thb(r.expected_cash) : '-') }, { key: 'actual_cash', header: 'Actual', align: 'right', render: (r: any) => (r.actual_cash != null ? thb(r.actual_cash) : '-') },
            { key: 'over_short', header: 'Over/Short', align: 'right', render: (r: any) => (r.over_short != null ? <b className={r.over_short < 0 ? 'text-rose-600' : 'text-emerald-600'}>{thb(r.over_short, { sign: true })}</b> : '-') }]} />
        </Card>
      )}
    </div>
  );
}
