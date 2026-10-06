import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { sapi, qs } from '../../lib/api';
import { useBranchId } from '../../lib/auth';
import { fmtDateTime } from '../../lib/format';
import { Button, Card, Input, Modal, PageHeader, Table } from '../../components/ui';

export function Audit() {
  const branchId = useBranchId();
  const [f, setF] = useState({ action: '', entity: '', from: '', to: '' });
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<any>(null);
  const q = useQuery({ queryKey: ['audit', branchId, f, page], queryFn: () => sapi.get(`/api/audit${qs({ branchId, ...f, page })}`) });
  return (
    <div className="space-y-4">
      <PageHeader title="Audit Log" subtitle="Append-only record of every important action" />
      <Card padded={false}>
        <div className="flex flex-wrap gap-2 border-b border-slate-100 p-3">
          <Input placeholder="Action (e.g. REFUND, GATE)" value={f.action} onChange={(e) => setF({ ...f, action: e.target.value })} className="w-56" />
          <Input placeholder="Entity type / id" value={f.entity} onChange={(e) => setF({ ...f, entity: e.target.value })} className="w-56" />
          <Input type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} className="w-auto" /><Input type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} className="w-auto" />
        </div>
        <Table dense rows={q.data ?? []} onRowClick={setOpen} columns={[{ key: 'at', header: 'Timestamp', render: (r: any) => fmtDateTime(r.at) }, { key: 'staff', header: 'Staff', render: (r: any) => (r.employee_code ? `${r.employee_code} ${r.staff_name}` : r.member_id ? 'member' : '-') },
          { key: 'role', header: 'Role' }, { key: 'device_code', header: 'Device' }, { key: 'ip', header: 'IP' }, { key: 'action', header: 'Action', render: (r: any) => <b>{r.action}</b> },
          { key: 'entity', header: 'Entity', render: (r: any) => `${r.entity_type ?? ''} ${r.entity_id ?? ''}` }, { key: 'reason', header: 'Reason' }]} />
        <div className="flex justify-end gap-2 p-3"><Button size="sm" variant="outline" disabled={page === 1} onClick={() => setPage(page - 1)}>Prev</Button><Button size="sm" variant="outline" disabled={(q.data?.length ?? 0) < 200} onClick={() => setPage(page + 1)}>Next</Button></div>
      </Card>
      <Modal open={!!open} onClose={() => setOpen(null)} title={open?.action} size="lg">
        {open && <div className="grid gap-3 md:grid-cols-2">
          <div><div className="mb-1 text-xs font-bold text-slate-500">BEFORE</div><pre className="max-h-96 overflow-auto rounded-lg bg-slate-50 p-2 text-xs">{JSON.stringify(open.before, null, 2)}</pre></div>
          <div><div className="mb-1 text-xs font-bold text-slate-500">AFTER</div><pre className="max-h-96 overflow-auto rounded-lg bg-slate-50 p-2 text-xs">{JSON.stringify(open.after, null, 2)}</pre></div>
          <div className="md:col-span-2"><div className="mb-1 text-xs font-bold text-slate-500">METADATA</div><pre className="rounded-lg bg-slate-50 p-2 text-xs">{JSON.stringify(open.metadata, null, 2)}</pre></div>
        </div>}
      </Modal>
    </div>
  );
}
