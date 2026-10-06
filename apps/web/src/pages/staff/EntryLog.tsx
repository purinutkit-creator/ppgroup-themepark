import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { sapi, qs } from '../../lib/api';
import { useBranchId } from '../../lib/auth';
import { fmtDateTime, today } from '../../lib/format';
import { Badge, Card, Input, PageHeader, Select, Table, Tabs } from '../../components/ui';

export function EntryLog() {
  const branchId = useBranchId();
  const [tab, setTab] = useState<'scans' | 'security'>('scans');
  const [f, setF] = useState({ date: today(), result: '', q: '', gateId: '' });
  const gates = useQuery({ queryKey: ['gates', branchId], queryFn: () => sapi.get(`/api/gates${qs({ branchId })}`), enabled: !!branchId });
  const log = useQuery({ queryKey: ['entry-log', branchId, f], queryFn: () => sapi.get(`/api/gates/scans/log${qs({ branchId, ...f })}`), enabled: !!branchId && tab === 'scans', refetchInterval: 15_000 });
  const sec = useQuery({ queryKey: ['security', branchId], queryFn: () => sapi.get(`/api/security-events${qs({ branchId })}`), enabled: !!branchId && tab === 'security' });
  return (
    <div className="space-y-4">
      <PageHeader title="Entry Log" subtitle="Every scan is recorded — including denied attempts" />
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'scans', label: 'Gate scans' }, { value: 'security', label: 'Security events' }]} />
      {tab === 'scans' ? (
        <Card padded={false}>
          <div className="flex flex-wrap gap-2 border-b border-slate-100 p-3">
            <Input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} className="w-auto" />
            <Select value={f.gateId} onChange={(e) => setF({ ...f, gateId: e.target.value })} className="w-auto"><option value="">All gates</option>{gates.data?.map((g: any) => <option key={g.id} value={g.id}>{g.name}</option>)}</Select>
            <Select value={f.result} onChange={(e) => setF({ ...f, result: e.target.value })} className="w-auto"><option value="">All results</option>{['APPROVED', 'AUTO_APPROVED', 'DENIED', 'PENDING', 'EXPIRED'].map((r) => <option key={r}>{r}</option>)}</Select>
            <Input placeholder="Credential / ticket / member" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} className="w-60" />
          </div>
          <Table dense rows={log.data ?? []} columns={[
            { key: 'scanned_at', header: 'Scan time', render: (r: any) => fmtDateTime(r.scanned_at) }, { key: 'gate_name', header: 'Gate' }, { key: 'direction', header: 'Dir' },
            { key: 'credential_code', header: 'Credential' }, { key: 'ticket_code', header: 'Ticket' }, { key: 'member_code', header: 'Member' },
            { key: 'result', header: 'Result', render: (r: any) => <span className="flex gap-1"><Badge>{r.result}</Badge>{r.is_duplicate && <Badge tone="red">DUPLICATE</Badge>}</span> },
            { key: 'reason', header: 'Reason' }, { key: 'operator_name', header: 'Operator' }, { key: 'decided_at', header: 'Approval time', render: (r: any) => (r.decided_at ? fmtDateTime(r.decided_at) : '-') }]} />
        </Card>
      ) : (
        <Card padded={false}>
          <Table dense rows={sec.data ?? []} columns={[{ key: 'created_at', header: 'Time', render: (r: any) => fmtDateTime(r.created_at) }, { key: 'type', header: 'Type', render: (r: any) => <Badge tone="red">{r.type}</Badge> },
            { key: 'gate_name', header: 'Gate' }, { key: 'credential_code', header: 'Credential' }, { key: 'ticket_code', header: 'Ticket' },
            { key: 'details', header: 'Details', render: (r: any) => <code className="text-xs">{JSON.stringify(r.details)}</code> }, { key: 'acknowledged_at', header: 'Ack', render: (r: any) => (r.acknowledged_at ? '✓' : '') }]} />
        </Card>
      )}
    </div>
  );
}
