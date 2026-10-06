import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCheck, Info, XOctagon } from 'lucide-react';
import { sapi, qs } from '../../lib/api';
import { useBranchId } from '../../lib/auth';
import { useRealtime } from '../../lib/socket';
import { fmtDateTime } from '../../lib/format';
import { Badge, Button, Card, Empty, PageHeader, cx } from '../../components/ui';

export function Notifications() {
  const branchId = useBranchId();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['notifications', branchId], queryFn: () => sapi.get(`/api/notifications${qs({ branchId })}`), enabled: !!branchId });
  useRealtime([branchId ? `branch:${branchId}` : null], { notification: () => qc.invalidateQueries({ queryKey: ['notifications'] }) });
  const ack = async (id?: string) => { await (id ? sapi.post(`/api/notifications/${id}/ack`) : sapi.post('/api/notifications/ack-all')); qc.invalidateQueries({ queryKey: ['notifications'] }); qc.invalidateQueries({ queryKey: ['notif-unread'] }); };
  const icon = (s: string) => (s === 'CRITICAL' ? <XOctagon className="h-5 w-5 text-rose-600" /> : s === 'WARNING' ? <AlertTriangle className="h-5 w-5 text-amber-500" /> : <Info className="h-5 w-5 text-sky-500" />);
  return (
    <div className="space-y-4">
      <PageHeader title="Notification Center" actions={<Button variant="outline" icon={<CheckCheck className="h-4 w-4" />} onClick={() => ack()}>Acknowledge all</Button>} />
      <Card padded={false}>
        {!q.data?.length ? <Empty title="No notifications" /> : q.data.map((n: any) => (
          <div key={n.id} className={cx('flex items-start gap-3 border-b border-slate-100 p-3 last:border-0', !n.acknowledged_at && 'bg-amber-50/40')}>
            {icon(n.severity)}
            <div className="flex-1"><div className="flex items-center gap-2"><b>{n.title}</b><Badge tone="gray">{n.type}</Badge></div><div className="text-sm text-slate-600">{n.message}</div>
              <div className="text-xs text-slate-400">{fmtDateTime(n.created_at)}{n.acknowledged_at && ` · acknowledged by ${n.acknowledged_by_name ?? ''}`}</div></div>
            {!n.acknowledged_at && <Button size="xs" variant="outline" onClick={() => ack(n.id)}>Ack</Button>}
          </div>
        ))}
      </Card>
    </div>
  );
}
