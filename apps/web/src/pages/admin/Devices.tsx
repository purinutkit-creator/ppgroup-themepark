import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, KeyRound, Plus } from 'lucide-react';
import { sapi, errorMessage, qs } from '../../lib/api';
import { useBranchId } from '../../lib/auth';
import { useRealtime } from '../../lib/socket';
import { fmtDateTime } from '../../lib/format';
import { Badge, Button, Card, Field, Input, Modal, PageHeader, Select, Stat, Table, toast } from '../../components/ui';

const TYPES = ['GATE_SCANNER', 'GATE_CONTROLLER', 'GATE_DISPLAY', 'POS', 'KIOSK', 'RIDE_SCANNER', 'KITCHEN_DISPLAY', 'QUEUE_DISPLAY', 'LOCKER_CONTROLLER', 'PRINTER', 'PAYMENT_TERMINAL', 'CUSTOMER_DISPLAY', 'WRISTBAND_PRINTER'];

export function Devices() {
  const branchId = useBranchId();
  const qc = useQueryClient();
  const [type, setType] = useState('');
  const list = useQuery({ queryKey: ['devices', branchId], queryFn: () => sapi.get(`/api/admin/devices${qs({ branchId })}`), enabled: !!branchId, refetchInterval: 30_000 });
  const [key, setKey] = useState<string | null>(null);
  const [create, setCreate] = useState(false);
  const [f, setF] = useState({ code: '', name: '', type: 'POS', location: '' });
  useRealtime([branchId ? `devices:${branchId}` : null], { 'device.status': () => qc.invalidateQueries({ queryKey: ['devices', branchId] }) });
  const rows = (list.data ?? []).filter((d: any) => !type || d.type === type);
  const count = (s: string) => (list.data ?? []).filter((d: any) => d.status === s).length;
  return (
    <div className="space-y-4">
      <PageHeader title="Device Management" actions={<Button icon={<Plus className="h-4 w-4" />} onClick={() => setCreate(true)}>Register device</Button>} />
      <div className="grid grid-cols-3 gap-3"><Stat label="Online" value={count('ONLINE')} tone="emerald" /><Stat label="Offline" value={count('OFFLINE')} tone="rose" /><Stat label="Error" value={count('ERROR')} tone="amber" /></div>
      <Card padded={false}>
        <div className="border-b border-slate-100 p-3"><Select value={type} onChange={(e) => setType(e.target.value)} className="w-auto"><option value="">All types</option>{TYPES.map((t) => <option key={t}>{t}</option>)}</Select></div>
        <Table dense rows={rows} columns={[{ key: 'code', header: 'Device ID', render: (r: any) => <span className="font-mono">{r.code}</span> }, { key: 'name', header: 'Name' }, { key: 'type', header: 'Type' },
          { key: 'location', header: 'Location' }, { key: 'ip', header: 'IP' }, { key: 'last_seen_at', header: 'Last seen', render: (r: any) => fmtDateTime(r.last_seen_at) },
          { key: 'status', header: 'Status', render: (r: any) => <Badge>{r.status}</Badge> }, { key: 'has_key', header: 'Key', render: (r: any) => (r.has_key ? <span className="font-mono text-xs">tpd_{r.api_key_prefix}_…</span> : '-') },
          { key: 'a', header: '', render: (r: any) => <Button size="xs" variant="outline" icon={<KeyRound className="h-3.5 w-3.5" />} onClick={async () => {
            if (r.has_key && !confirm('Issue a new key? The old key stops working.')) return;
            try { setKey((await sapi.post(`/api/admin/devices/${r.id}/key`)).apiKey); qc.invalidateQueries({ queryKey: ['devices', branchId] }); } catch (e) { toast.error(errorMessage(e)); }
          }}>{r.has_key ? 'Re-issue key' : 'Issue key'}</Button> }]} />
      </Card>
      <Modal open={!!key} onClose={() => setKey(null)} title="Device API key">
        <div className="space-y-3 text-sm"><div className="rounded-lg bg-amber-50 p-3 text-amber-800">Copy this key now — it is shown only once. Paste it in <b>/device-setup</b> on the device.</div>
          <div className="flex gap-2"><Input readOnly value={key ?? ''} className="font-mono text-xs" /><Button variant="outline" icon={<Copy className="h-4 w-4" />} onClick={() => { navigator.clipboard?.writeText(key ?? ''); toast.success('Copied'); }} /></div></div>
      </Modal>
      <Modal open={create} onClose={() => setCreate(false)} title="Register device" footer={<Button onClick={async () => { try { await sapi.post('/api/admin/devices', { ...f, branchId }); setCreate(false); qc.invalidateQueries({ queryKey: ['devices', branchId] }); } catch (e) { toast.error(errorMessage(e)); } }}>Create</Button>}>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Device ID"><Input value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} /></Field><Field label="Name"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="Type"><Select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>{TYPES.map((t) => <option key={t}>{t}</option>)}</Select></Field><Field label="Location"><Input value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} /></Field>
        </div>
      </Modal>
    </div>
  );
}
