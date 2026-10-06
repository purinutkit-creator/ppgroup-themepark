import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Search } from 'lucide-react';
import { sapi, errorMessage, qs } from '../../lib/api';
import { useBranchId, useCan } from '../../lib/auth';
import { useRealtime } from '../../lib/socket';
import { fmtDate, fmtDateTime, thb, today } from '../../lib/format';
import { withApproval } from '../../components/Approval';
import { Badge, Button, Card, Input, KV, Loading, Modal, PageHeader, Table, Tabs, cx, toast } from '../../components/ui';

const FILTERS = ['ALL', 'TODAY', 'TOMORROW', 'UPCOMING', 'UNPAID', 'PAID', 'PENDING_VERIFICATION', 'CHECKED_IN', 'CANCELLED', 'REFUNDED', 'NO_SHOW'];

export function Bookings() {
  const branchId = useBranchId();
  const can = useCan();
  const qc = useQueryClient();
  const [tab, setTab] = useState<'list' | 'calendar'>('list');
  const [filter, setFilter] = useState('TODAY');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [month, setMonth] = useState(today().slice(0, 7));
  const [open, setOpen] = useState<string | null>(null);
  const list = useQuery({ queryKey: ['bookings', branchId, filter, q, page], queryFn: () => sapi.get(`/api/bookings${qs({ branchId, filter: filter === 'ALL' ? undefined : filter, q, page })}`), enabled: !!branchId && tab === 'list' });
  const cal = useQuery({ queryKey: ['booking-cal', branchId, month], queryFn: () => sapi.get(`/api/bookings/calendar${qs({ branchId, month })}`), enabled: !!branchId && tab === 'calendar' });
  const detail = useQuery({ queryKey: ['booking-detail', open], queryFn: () => sapi.get(`/api/bookings/${open}`), enabled: !!open });
  useRealtime([branchId ? `branch:${branchId}` : null], { 'booking.created': () => qc.invalidateQueries({ queryKey: ['bookings'] }), 'booking.updated': () => qc.invalidateQueries({ queryKey: ['bookings'] }) });
  const shiftMonth = (n: number) => { const d = new Date(`${month}-01T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() + n); setMonth(d.toISOString().slice(0, 7)); };
  const first = new Date(`${month}-01T00:00:00Z`);
  const daysIn = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  return (
    <div className="space-y-4">
      <PageHeader title="Booking Management" />
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'list', label: 'Bookings' }, { value: 'calendar', label: 'Calendar' }]} />
      {tab === 'list' ? (
        <Card padded={false}>
          <div className="space-y-2 border-b border-slate-100 p-3">
            <div className="flex flex-wrap gap-1">{FILTERS.map((f) => <button key={f} onClick={() => { setFilter(f); setPage(1); }} className={cx('rounded-full px-3 py-1 text-xs font-semibold', filter === f ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600')}>{f.replaceAll('_', ' ')}</button>)}</div>
            <div className="relative"><Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" /><Input className="pl-9" placeholder="Booking No. / barcode / customer / phone / email / member ID" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} /></div>
          </div>
          {list.isLoading ? <Loading /> : <>
            <Table rows={list.data?.rows ?? []} onRowClick={(r: any) => setOpen(r.id)} columns={[
              { key: 'booking_no', header: 'Booking No.', render: (r: any) => <span className="font-mono font-semibold">{r.booking_no}</span> }, { key: 'customer_name', header: 'Customer' }, { key: 'phone', header: 'Phone' },
              { key: 'visit_date', header: 'Visit', render: (r: any) => fmtDate(r.visit_date) }, { key: 'guests', header: 'Guests', align: 'right' }, { key: 'channel', header: 'Channel' },
              { key: 'payment_mode', header: 'Mode', render: (r: any) => <span className="text-xs">{r.payment_mode.replaceAll('_', ' ')}</span> }, { key: 'total', header: 'Amount', align: 'right', render: (r: any) => thb(r.total) },
              { key: 'paid', header: 'Paid', align: 'right', render: (r: any) => thb(r.paid_total) }, { key: 'status', header: 'Status', render: (r: any) => <Badge>{r.status}</Badge> }]} />
            <div className="flex items-center justify-between p-3 text-sm text-slate-500"><span>{list.data?.total ?? 0} bookings</span>
              <div className="flex gap-2"><Button size="sm" variant="outline" disabled={page === 1} onClick={() => setPage(page - 1)}>Prev</Button><Button size="sm" variant="outline" disabled={(list.data?.rows.length ?? 0) < 50} onClick={() => setPage(page + 1)}>Next</Button></div></div>
          </>}
        </Card>
      ) : (
        <Card title={<div className="flex items-center gap-2"><button onClick={() => shiftMonth(-1)}><ChevronLeft className="h-5 w-5" /></button>{first.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })}<button onClick={() => shiftMonth(1)}><ChevronRight className="h-5 w-5" /></button></div>}>
          {cal.isLoading ? <Loading /> : (
            <div className="grid grid-cols-7 gap-2">
              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => <div key={d} className="text-center text-xs font-bold text-slate-400">{d}</div>)}
              {Array.from({ length: first.getUTCDay() }).map((_, i) => <div key={`b${i}`} />)}
              {Array.from({ length: daysIn }).map((_, i) => {
                const date = `${month}-${String(i + 1).padStart(2, '0')}`;
                const row = cal.data?.days.find((d: any) => d.date === date);
                const pct = row ? row.tickets / cal.data.capacity : 0;
                return (
                  <button key={date} onClick={() => { setTab('list'); setFilter('ALL'); setQ(''); }} className={cx('rounded-xl border p-2 text-left', pct >= 0.95 ? 'border-rose-300 bg-rose-50' : pct >= 0.8 ? 'border-amber-300 bg-amber-50' : 'border-slate-200 bg-white')}>
                    <div className="text-xs font-bold">{i + 1}</div>
                    <div className="text-sm font-semibold tabular-nums">{row?.tickets ?? 0}<span className="text-xs text-slate-400"> / {cal.data?.capacity}</span></div>
                    {row && <div className="text-[10px] text-slate-500">{row.bookings} bookings</div>}
                    {pct >= 0.8 && <div className="text-[10px] font-bold text-amber-700">⚠ {Math.round(pct * 100)}%</div>}
                  </button>
                );
              })}
            </div>
          )}
        </Card>
      )}
      <Modal open={!!open} onClose={() => setOpen(null)} title={detail.data?.booking_no} size="lg" footer={detail.data && <>
        {can('booking.cancel') && detail.data.paid_total === 0 && !['CANCELLED', 'EXPIRED'].includes(detail.data.status) && <Button variant="danger" onClick={async () => { const reason = prompt('Cancel reason?'); if (!reason) return; try { await sapi.post(`/api/bookings/${open}/cancel`, { reason }); setOpen(null); qc.invalidateQueries({ queryKey: ['bookings'] }); } catch (e) { toast.error(errorMessage(e)); } }}>Cancel booking</Button>}
        {can('refund.create') && detail.data.paid_total > 0 && !['REFUNDED'].includes(detail.data.status) && <Button variant="warning" onClick={async () => { const reason = prompt('Refund reason?'); if (!reason) return;
          try { await withApproval('REFUND', (approvalId) => sapi.post(`/api/orders/${detail.data.order_id}/refund`, { method: 'ORIGINAL', reason, approvalId }), reason); toast.success('Refunded'); detail.refetch(); } catch (e) { toast.error(errorMessage(e)); } }}>Refund</Button>}
      </>}>
        {detail.data ? (
          <div className="space-y-3">
            <div className="grid gap-x-8 md:grid-cols-2"><KV k="Customer" v={detail.data.customer_name} /><KV k="Phone" v={detail.data.phone} /><KV k="Email" v={detail.data.email ?? '-'} /><KV k="Visit" v={fmtDate(detail.data.visit_date)} />
              <KV k="Status" v={<Badge>{detail.data.status}</Badge>} /><KV k="Payment" v={<Badge>{detail.data.paymentStatus}</Badge>} /><KV k="Total" v={thb(detail.data.total)} /><KV k="Channel" v={detail.data.channel} /></div>
            <Table dense rows={detail.data.tickets} columns={[{ key: 'ticket_code', header: 'Ticket' }, { key: 'ticket_type', header: 'Type' }, { key: 'guest_name', header: 'Guest' }, { key: 'status', header: 'Status', render: (r: any) => <Badge>{r.status}</Badge> },
              { key: 'presence', header: 'Presence', render: (r: any) => <Badge>{r.presence}</Badge> }, { key: 'wristbands', header: 'Wristband', render: (r: any) => r.wristbands?.map((w: any) => w.code).join(', ') ?? '-' }]} />
            <Table dense rows={detail.data.payments} columns={[{ key: 'payment_no', header: 'Payment' }, { key: 'method', header: 'Method' }, { key: 'status', header: 'Status', render: (r: any) => <Badge>{r.status}</Badge> }, { key: 'amount', header: 'Amount', align: 'right', render: (r: any) => thb(r.amount) }, { key: 'paid_at', header: 'Paid', render: (r: any) => fmtDateTime(r.paid_at) }]} />
          </div>
        ) : <Loading />}
      </Modal>
    </div>
  );
}
