import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { sapi, errorMessage, qs } from '../../lib/api';
import { useBranchId, useCan } from '../../lib/auth';
import { fmtDateTime } from '../../lib/format';
import { Badge, Button, Card, Field, Input, Modal, PageHeader, Select, Table, Tabs, toast } from '../../components/ui';

export function Inventory() {
  const branchId = useBranchId();
  const can = useCan();
  const qc = useQueryClient();
  const [tab, setTab] = useState<'stock' | 'moves'>('stock');
  const [storeId, setStoreId] = useState('');
  const stores = useQuery({ queryKey: ['stores', branchId], queryFn: () => sapi.get(`/api/public/stores${qs({ branchId })}`), enabled: !!branchId });
  const stock = useQuery({ queryKey: ['stock', branchId, storeId], queryFn: () => sapi.get(`/api/inventory${qs({ branchId, storeId })}`), enabled: !!branchId });
  const moves = useQuery({ queryKey: ['moves', branchId], queryFn: () => sapi.get(`/api/inventory/movements${qs({ branchId })}`), enabled: !!branchId && tab === 'moves' });
  const products = useQuery({ queryKey: ['products-all'], queryFn: () => sapi.get('/api/admin/products'), enabled: can('inventory.manage') });
  const [op, setOp] = useState<any>(null);
  const submit = async () => {
    try {
      if (op.type === 'TRANSFER') await sapi.post('/api/inventory/transfer', { productId: op.productId, fromStoreId: op.storeId, toStoreId: op.toStoreId, qty: Number(op.qty), reason: op.reason });
      else await sapi.post('/api/inventory/move', { productId: op.productId, storeId: op.storeId, type: op.type, qty: Number(op.qty), reason: op.reason });
      toast.success('Stock updated'); setOp(null); qc.invalidateQueries({ queryKey: ['stock'] }); qc.invalidateQueries({ queryKey: ['moves'] });
    } catch (e) { toast.error(errorMessage(e)); }
  };
  return (
    <div className="space-y-4">
      <PageHeader title="Inventory" actions={can('inventory.manage') && ['IN', 'OUT', 'TRANSFER', 'ADJUSTMENT', 'WASTE'].map((t) => <Button key={t} size="sm" variant={t === 'IN' ? 'primary' : 'outline'} onClick={() => setOp({ type: t, qty: '', reason: '', storeId: storeId || '', productId: '' })}>{t === 'IN' ? 'Stock In' : t === 'OUT' ? 'Stock Out' : t.charAt(0) + t.slice(1).toLowerCase()}</Button>)} />
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'stock', label: 'Stock levels' }, { value: 'moves', label: 'Movements' }]} />
      {tab === 'stock' ? (
        <Card padded={false}>
          <div className="border-b border-slate-100 p-3"><Select value={storeId} onChange={(e) => setStoreId(e.target.value)} className="w-auto"><option value="">All stores / warehouses</option>{stores.data?.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></div>
          <Table dense rows={stock.data ?? []} columns={[{ key: 'store_name', header: 'Location' }, { key: 'sku', header: 'SKU' }, { key: 'product_name', header: 'Product' },
            { key: 'qty', header: 'Qty', align: 'right', render: (r: any) => <b className={r.low ? 'text-rose-600' : ''}>{r.qty}</b> }, { key: 'low_stock_threshold', header: 'Low at', align: 'right' },
            { key: 'low', header: '', render: (r: any) => r.low && <Badge tone="red">LOW STOCK</Badge> }, { key: 'updated_at', header: 'Updated', render: (r: any) => fmtDateTime(r.updated_at) }]} />
        </Card>
      ) : (
        <Card padded={false}><Table dense rows={moves.data ?? []} columns={[{ key: 'created_at', header: 'Time', render: (r: any) => fmtDateTime(r.created_at) }, { key: 'store_name', header: 'Location' }, { key: 'product_name', header: 'Product' },
          { key: 'type', header: 'Type', render: (r: any) => <Badge tone={r.qty > 0 ? 'green' : 'red'}>{r.type}</Badge> }, { key: 'qty', header: 'Qty', align: 'right' }, { key: 'qty_after', header: 'After', align: 'right' }, { key: 'reason', header: 'Reason' }, { key: 'staff_name', header: 'Staff' }]} /></Card>
      )}
      <Modal open={!!op} onClose={() => setOp(null)} title={`Stock ${op?.type}`} footer={<Button onClick={submit}>Save</Button>}>
        {op && <div className="grid grid-cols-2 gap-3">
          <Field label="Product" className="col-span-2"><Select value={op.productId} onChange={(e) => setOp({ ...op, productId: e.target.value })}><option value="">…</option>{products.data?.filter((p: any) => p.track_stock).map((p: any) => <option key={p.id} value={p.id}>{p.sku} · {p.name}</option>)}</Select></Field>
          <Field label={op.type === 'TRANSFER' ? 'From' : 'Location'}><Select value={op.storeId} onChange={(e) => setOp({ ...op, storeId: e.target.value })}><option value="">…</option>{stores.data?.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>
          {op.type === 'TRANSFER' && <Field label="To"><Select value={op.toStoreId ?? ''} onChange={(e) => setOp({ ...op, toStoreId: e.target.value })}><option value="">…</option>{stores.data?.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>}
          <Field label={op.type === 'ADJUSTMENT' ? 'Qty (+/−)' : 'Qty'}><Input type="number" value={op.qty} onChange={(e) => setOp({ ...op, qty: e.target.value })} /></Field>
          <Field label="Reason" className="col-span-2"><Input value={op.reason} onChange={(e) => setOp({ ...op, reason: e.target.value })} /></Field>
        </div>}
      </Modal>
    </div>
  );
}
