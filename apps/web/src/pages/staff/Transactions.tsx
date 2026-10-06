import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Printer, Search } from 'lucide-react';
import { sapi, errorMessage, qs } from '../../lib/api';
import { useBranchId, useCan } from '../../lib/auth';
import { fmtDateTime, thb, today, toSatang } from '../../lib/format';
import { withApproval } from '../../components/Approval';
import { printNode, ReceiptPrint } from '../../components/Print';
import { Badge, Button, Card, Field, Input, KV, Loading, Modal, PageHeader, Select, Table, toast } from '../../components/ui';

export function Transactions() {
  const branchId = useBranchId();
  const can = useCan();
  const [f, setF] = useState({ q: '', type: '', category: '', from: today(), to: today() });
  const [page, setPage] = useState(1);
  const [orderId, setOrderId] = useState<string | null>(null);
  const list = useQuery({ queryKey: ['txns', branchId, f, page], queryFn: () => sapi.get(`/api/transactions${qs({ branchId, ...f, page })}`), enabled: !!branchId });
  const order = useQuery({ queryKey: ['order', orderId], queryFn: () => sapi.get(`/api/orders/${orderId}`), enabled: !!orderId });
  const [refund, setRefund] = useState<{ mode: 'FULL' | 'PARTIAL'; amount: string; method: string; reason: string; items: Record<string, number> } | null>(null);
  const doRefund = async (isVoid = false) => {
    if (!refund || !order.data) return;
    const items = Object.entries(refund.items).filter(([, q]) => q > 0).map(([orderItemId, qty]) => ({ orderItemId, qty }));
    const body: any = { method: refund.method, reason: refund.reason };
    if (refund.mode === 'PARTIAL') { if (items.length) body.items = items; else body.amount = toSatang(refund.amount); }
    try {
      await withApproval(isVoid ? 'VOID' : 'REFUND', (approvalId) => sapi.post(`/api/orders/${orderId}/${isVoid ? 'void' : 'refund'}`, { ...body, approvalId }), refund.reason);
      toast.success(isVoid ? 'Voided' : 'Refunded'); setRefund(null); order.refetch(); list.refetch();
    } catch (e) { toast.error(errorMessage(e)); }
  };
  return (
    <div className="space-y-4">
      <PageHeader title="Transaction Center" subtitle="All tickets, wallet, POS, food, retail, locker, top-up and refund transactions" />
      <Card padded={false}>
        <div className="flex flex-wrap gap-2 border-b border-slate-100 p-3">
          <div className="relative min-w-[240px] flex-1"><Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" /><Input className="pl-9" placeholder="Txn / order / ticket / card / wristband / member / staff" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} /></div>
          <Select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })} className="w-auto"><option value="">All types</option>{['SALE', 'TOPUP', 'REFUND', 'VOID', 'WALLET_ADJUST', 'WALLET_CASH_OUT', 'CASH_IN', 'CASH_OUT'].map((t) => <option key={t}>{t}</option>)}</Select>
          <Select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} className="w-auto"><option value="">All categories</option>{['TICKET', 'FOOD', 'RETAIL', 'WALLET', 'LOCKER', 'MEMBERSHIP', 'RIDE', 'OTHER'].map((t) => <option key={t}>{t}</option>)}</Select>
          <Input type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} className="w-auto" /><Input type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} className="w-auto" />
        </div>
        {list.isLoading ? <Loading /> : <Table dense rows={list.data?.rows ?? []} onRowClick={(r: any) => r.order_id && setOrderId(r.order_id)} columns={[
          { key: 'created_at', header: 'Time', render: (r: any) => fmtDateTime(r.created_at) }, { key: 'txn_no', header: 'Txn', render: (r: any) => <span className="font-mono text-xs">{r.txn_no}</span> },
          { key: 'type', header: 'Type', render: (r: any) => <Badge tone={r.direction === 'OUT' ? 'red' : r.direction === 'IN' ? 'green' : 'gray'}>{r.type}</Badge> }, { key: 'category', header: 'Category' },
          { key: 'method', header: 'Method' }, { key: 'order_no', header: 'Order' }, { key: 'credential_code', header: 'Card' }, { key: 'member_code', header: 'Member' }, { key: 'store_name', header: 'Store' },
          { key: 'staff_name', header: 'Staff' }, { key: 'amount', header: 'Amount', align: 'right', render: (r: any) => <b className={r.direction === 'OUT' ? 'text-rose-600' : ''}>{r.direction === 'OUT' ? '-' : ''}{thb(r.amount)}</b> }]} />}
        <div className="flex items-center justify-between p-3 text-sm text-slate-500"><span>{list.data?.total ?? 0} transactions</span>
          <div className="flex gap-2"><Button size="sm" variant="outline" disabled={page === 1} onClick={() => setPage(page - 1)}>Prev</Button><Button size="sm" variant="outline" disabled={(list.data?.rows.length ?? 0) < 100} onClick={() => setPage(page + 1)}>Next</Button></div></div>
      </Card>
      <Modal open={!!orderId} onClose={() => { setOrderId(null); setRefund(null); }} size="lg" title={order.data?.order_no} footer={order.data && <>
        <Button variant="outline" icon={<Printer className="h-4 w-4" />} onClick={async () => printNode(<ReceiptPrint d={await sapi.get(`/api/print/receipt/${orderId}`)} />)}>Receipt</Button>
        {can('refund.create') && ['PAID', 'PARTIALLY_REFUNDED'].includes(order.data.status) && <Button variant="warning" onClick={() => setRefund({ mode: 'FULL', amount: '', method: 'ORIGINAL', reason: '', items: {} })}>Refund</Button>}
        {can('pos.void') && order.data.status === 'PAID' && <Button variant="danger" onClick={() => setRefund({ mode: 'FULL', amount: '', method: 'ORIGINAL', reason: '', items: {} })}>Void</Button>}
      </>}>
        {order.data ? (
          <div className="space-y-3">
            <div className="grid gap-x-8 md:grid-cols-2"><KV k="Type" v={order.data.type} /><KV k="Status" v={<Badge>{order.data.status}</Badge>} /><KV k="Channel" v={order.data.channel} /><KV k="Store" v={order.data.store_name ?? '-'} />
              <KV k="Staff" v={order.data.staff_name ?? '-'} /><KV k="Member" v={order.data.member_code ?? '-'} /><KV k="Total" v={thb(order.data.total)} /><KV k="Refunded" v={thb(order.data.refunded_total)} /></div>
            <Table dense rows={order.data.items} columns={[{ key: 'name', header: 'Item' }, { key: 'qty', header: 'Qty', align: 'right' }, { key: 'discount', header: 'Discount', align: 'right', render: (r: any) => thb(r.discount) },
              { key: 'total', header: 'Total', align: 'right', render: (r: any) => thb(r.total) }, { key: 'refunded_qty', header: 'Refunded', align: 'right' },
              ...(refund?.mode === 'PARTIAL' ? [{ key: 'sel', header: 'Refund qty', render: (r: any) => <Input type="number" min={0} max={r.qty - r.refunded_qty} className="w-20 py-1" value={refund.items[r.id] ?? 0} onChange={(e) => setRefund({ ...refund, items: { ...refund.items, [r.id]: Number(e.target.value) } })} /> }] : [])]} />
            <Table dense rows={order.data.payments} columns={[{ key: 'payment_no', header: 'Payment' }, { key: 'method', header: 'Method' }, { key: 'status', header: 'Status', render: (r: any) => <Badge>{r.status}</Badge> }, { key: 'amount', header: 'Amount', align: 'right', render: (r: any) => thb(r.amount) }, { key: 'reference', header: 'Ref' }]} />
            {order.data.refunds.length > 0 && <Table dense rows={order.data.refunds} columns={[{ key: 'refund_no', header: 'Refund' }, { key: 'type', header: 'Type' }, { key: 'method', header: 'Method' }, { key: 'amount', header: 'Amount', align: 'right', render: (r: any) => thb(r.amount) }, { key: 'reason', header: 'Reason' }]} />}
            {refund && (
              <div className="space-y-2 rounded-xl border border-amber-300 bg-amber-50 p-3">
                <div className="grid grid-cols-3 gap-2">
                  <Field label="Type"><Select value={refund.mode} onChange={(e) => setRefund({ ...refund, mode: e.target.value as any })}><option value="FULL">Full refund</option><option value="PARTIAL">Partial (items or amount)</option></Select></Field>
                  <Field label="Refund via"><Select value={refund.method} onChange={(e) => setRefund({ ...refund, method: e.target.value })}><option value="ORIGINAL">Original method</option><option value="CASH">Cash</option><option value="WALLET">Wallet</option><option value="BANK_TRANSFER">Bank transfer</option></Select></Field>
                  {refund.mode === 'PARTIAL' && <Field label="Amount (if no items)"><Input value={refund.amount} onChange={(e) => setRefund({ ...refund, amount: e.target.value })} /></Field>}
                </div>
                <Field label="Reason"><Input value={refund.reason} onChange={(e) => setRefund({ ...refund, reason: e.target.value })} /></Field>
                <div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setRefund(null)}>Cancel</Button>
                  {can('pos.void') && <Button variant="danger" disabled={refund.reason.length < 3} onClick={() => doRefund(true)}>Void order</Button>}
                  <Button variant="warning" disabled={refund.reason.length < 3} onClick={() => doRefund(false)}>Confirm refund</Button></div>
              </div>
            )}
          </div>
        ) : <Loading />}
      </Modal>
    </div>
  );
}
