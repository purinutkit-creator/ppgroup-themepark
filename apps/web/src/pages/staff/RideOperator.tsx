import { useParams, Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Banknote, Bell, Pause, Play, Wrench, XCircle } from 'lucide-react';
import { sapi, errorMessage } from '../../lib/api';
import { useCan } from '../../lib/auth';
import { useRealtime } from '../../lib/socket';
import { fmtTime, thb } from '../../lib/format';
import { withApproval } from '../../components/Approval';
import { ScanBox } from '../../components/ScanBox';
import { Badge, Button, Card, Loading, PageHeader, Stat, Table, toast } from '../../components/ui';

export function RideOperator() {
  const { rideId } = useParams();
  const can = useCan();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['ride-op', rideId], queryFn: () => sapi.get(`/api/rides/${rideId}/operator`) });
  const queue = useQuery({ queryKey: ['ride-queue', rideId], queryFn: () => sapi.get(`/api/rides/${rideId}/queue`) });
  const refresh = () => { qc.invalidateQueries({ queryKey: ['ride-op', rideId] }); qc.invalidateQueries({ queryKey: ['ride-queue', rideId] }); };
  useRealtime([rideId ? `ride:${rideId}` : null], {
    'ride.scan': refresh, 'ride.status': refresh, 'queue.changed': refresh,
    'ride.purchase.request': (e) => { refresh(); if (e.method === 'CASH') toast.warning(`WAITING FOR CASH PAYMENT ${thb(e.amount)} — ${e.credentialCode}`); },
    'ride.purchase.updated': refresh,
  });
  if (!q.data) return <Loading />;
  const { ride, lastScans, pendingPurchases, guestsToday, currentCycle } = q.data;
  const act = (body: any) => sapi.post(`/api/rides/${rideId}/status`, body).then(refresh).catch((e) => toast.error(errorMessage(e)));
  const scan = async (code: string) => {
    try { const r = await sapi.post(`/api/rides/${rideId}/scan`, { code }); r.result === 'GRANTED' ? toast.success(`GRANTED ${r.customer ?? ''}`) : toast.error(`${r.result}: ${r.reason?.en}`); }
    catch (e) { toast.error(errorMessage(e)); }
  };
  return (
    <div className="space-y-4">
      <PageHeader title={ride.name} subtitle={`${ride.code} · capacity ${ride.capacity_per_cycle}/cycle · ${ride.cycle_minutes} min`}
        actions={<><Badge>{ride.status}</Badge>{ride.entry_paused && <Badge tone="amber">ENTRY PAUSED</Badge>}<Link to={`/ride/${rideId}/scanner`} target="_blank"><Button size="sm" variant="outline">Customer scanner ↗</Button></Link></>} />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Current queue" value={q.data.queue.guests_waiting} sub={`${q.data.queue.waiting} parties · ${q.data.queue.called} called`} tone="amber" />
        <Stat label="Est. wait" value={`${q.data.queue.estimatedWaitMin} min`} tone="sky" />
        <Stat label="Current cycle" value={`${currentCycle} / ${ride.capacity_per_cycle}`} tone="brand" />
        <Stat label="Guests today" value={guestsToday} tone="emerald" />
      </div>
      {can('ride.operate') && (
        <Card title="Controls">
          <div className="flex flex-wrap gap-2">
            <Button variant="success" icon={<Play className="h-4 w-4" />} onClick={() => act({ status: 'OPEN', entryPaused: false })}>Open ride</Button>
            <Button variant="warning" icon={<Pause className="h-4 w-4" />} onClick={() => act({ entryPaused: !ride.entry_paused })}>{ride.entry_paused ? 'Resume entry' : 'Pause entry'}</Button>
            <Button variant="danger" icon={<XCircle className="h-4 w-4" />} onClick={() => act({ status: 'CLOSED', reason: prompt('Reason?') ?? 'Closed by operator' })}>Close ride</Button>
            <Button variant="outline" icon={<Wrench className="h-4 w-4" />} onClick={() => act({ status: 'MAINTENANCE', reason: prompt('Maintenance reason?') ?? 'Maintenance' })}>Maintenance</Button>
            <Button variant="outline" onClick={() => act({ status: 'TEMPORARILY_CLOSED', reason: 'Temporarily closed' })}>Temporarily closed</Button>
            <Button icon={<Bell className="h-4 w-4" />} onClick={() => sapi.post(`/api/rides/${rideId}/queue/call`, {}).then((r) => { toast.success(`Called: ${r.called.map((c: any) => c.queueNo).join(', ') || 'none'}`); refresh(); })}>Call next batch</Button>
          </div>
          <div className="mt-3"><ScanBox onScan={scan} placeholder="Operator scan (validates & consumes entitlement)" /></div>
        </Card>
      )}
      {pendingPurchases.length > 0 && (
        <Card title={<span className="flex items-center gap-2 text-amber-700"><Banknote className="h-4 w-4" /> Pending purchases at scanner</span>}>
          {pendingPurchases.map((p: any) => (
            <div key={p.id} className="flex items-center justify-between border-b border-slate-100 py-2 last:border-0">
              <div><b>{p.credential_code}</b> · {p.method} · <b>{thb(p.amount)}</b> <span className="text-xs text-slate-500">{fmtTime(p.created_at)}</span></div>
              <div className="flex gap-2">
                {p.method === 'CASH' && <Button size="sm" variant="success" onClick={() => sapi.post(`/api/rides/purchase-requests/${p.id}/confirm-cash`).then(() => { toast.success('Cash received — access granted'); refresh(); }).catch((e) => toast.error(errorMessage(e)))}>CONFIRM CASH RECEIVED</Button>}
                <Button size="sm" variant="ghost" onClick={() => sapi.post(`/api/rides/purchase-requests/${p.id}/cancel`).then(refresh)}>Cancel</Button>
              </div>
            </div>
          ))}
        </Card>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Last scans" padded={false}>
          <Table dense rows={lastScans} columns={[{ key: 'scanned_at', header: 'Time', render: (r: any) => fmtTime(r.scanned_at) }, { key: 'who', header: 'Guest', render: (r: any) => r.member_name ?? r.guest_name ?? r.credential_code },
            { key: 'result', header: 'Result', render: (r: any) => <span className="flex gap-1"><Badge>{r.result}</Badge>{r.manual && <Badge tone="gray">manual</Badge>}</span> }, { key: 'reason', header: 'Reason' },
            { key: 'act', header: '', render: (r: any) => can('ride.manual_entry') && (r.result === 'GRANTED'
              ? <Button size="xs" variant="ghost" onClick={() => { const reason = prompt('Deny reason (use will be restored)?'); if (reason) sapi.post(`/api/rides/${rideId}/manual-deny`, { accessLogId: r.id, reason }).then(refresh).catch((e) => toast.error(errorMessage(e))); }}>Deny</Button>
              : <Button size="xs" variant="ghost" onClick={async () => { const reason = prompt('Manual approve reason?'); if (!reason) return; try { await withApproval('RIDE_OVERRIDE', (approvalId) => sapi.post(`/api/rides/${rideId}/manual-approve`, { accessLogId: r.id, reason, approvalId })); refresh(); } catch (e) { toast.error(errorMessage(e)); } }}>Approve</Button>) }]} />
        </Card>
        <Card title="Virtual queue" padded={false}>
          <Table dense rows={queue.data ?? []} columns={[{ key: 'queue_no', header: 'No.', render: (r: any) => <b>{r.queue_no}</b> }, { key: 'who', header: 'Guest', render: (r: any) => r.member_name ?? r.credential_code ?? '-' },
            { key: 'party_size', header: 'Party', align: 'right' }, { key: 'status', header: 'Status', render: (r: any) => <span className="flex gap-1"><Badge>{r.status}</Badge>{r.priority && <Badge tone="violet">PRIORITY</Badge>}</span> },
            { key: 'joined_at', header: 'Joined', render: (r: any) => fmtTime(r.joined_at) }, { key: 'x', header: '', render: (r: any) => <Button size="xs" variant="ghost" onClick={() => sapi.post(`/api/queue/${r.id}/cancel`).then(refresh)}>Remove</Button> }]} />
        </Card>
      </div>
    </div>
  );
}
