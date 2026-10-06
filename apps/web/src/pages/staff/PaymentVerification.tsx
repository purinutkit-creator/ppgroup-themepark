import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, FileImage, RotateCcw, X } from 'lucide-react';
import { sapi, errorMessage, qs } from '../../lib/api';
import { useBranchId } from '../../lib/auth';
import { useRealtime } from '../../lib/socket';
import { fmtDate, fmtDateTime, thb } from '../../lib/format';
import { Badge, Button, Card, Empty, KV, Loading, Modal, PageHeader, Select, toast } from '../../components/ui';

/** PAYMENT VERIFICATION CENTER — new slip requests pop up in realtime. */
export function PaymentVerification() {
  const branchId = useBranchId();
  const qc = useQueryClient();
  const [status, setStatus] = useState('WAITING');
  const [slip, setSlip] = useState<string | null>(null);
  const q = useQuery({ queryKey: ['pvr', branchId, status], queryFn: () => sapi.get(`/api/payment-verifications${qs({ branchId, status })}`), enabled: !!branchId });
  useRealtime([branchId ? `payverify:${branchId}` : null], {
    'payverify.new': (e) => { toast.warning(`New payment to verify: ${e.bookingNo ?? ''} ${thb(e.amount)}`); qc.invalidateQueries({ queryKey: ['pvr'] }); },
    'payverify.updated': () => qc.invalidateQueries({ queryKey: ['pvr'] }),
  });
  const review = async (id: string, decision: string) => {
    const note = decision === 'APPROVE' ? undefined : prompt('Note to customer?') ?? undefined;
    try { await sapi.post(`/api/payment-verifications/${id}/review`, { decision, note }); toast.success(decision); qc.invalidateQueries({ queryKey: ['pvr'] }); } catch (e) { toast.error(errorMessage(e)); }
  };
  const viewSlip = async (id: string) => {
    try { const r = await sapi.raw(`/api/payment-verifications/${id}/slip`); setSlip(URL.createObjectURL(await r.blob())); } catch (e) { toast.error(errorMessage(e)); }
  };
  return (
    <div className="space-y-4">
      <PageHeader title="Payment Verification Center" actions={<Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-auto">{['WAITING', 'APPROVED', 'REJECTED', 'NEW_SLIP_REQUESTED', 'ALL'].map((s) => <option key={s}>{s}</option>)}</Select>} />
      {q.isLoading ? <Loading /> : !q.data?.length ? <Card><Empty title="No requests" hint="New PromptPay / transfer slips appear here instantly" /></Card> : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {q.data.map((r: any) => (
            <Card key={r.id} className={r.status === 'WAITING' ? 'border-amber-300' : ''}>
              <div className="flex items-start justify-between"><div><div className="font-mono font-bold">{r.booking_no ?? r.order_no}</div><div className="text-sm text-slate-500">{r.customer_name} · {r.phone}</div></div><Badge>{r.status}</Badge></div>
              <div className="mt-2 text-3xl font-black">{thb(r.amount_expected)}</div>
              <KV k="Method" v={r.method} /><KV k="Visit" v={r.visit_date ? fmtDate(r.visit_date) : '-'} /><KV k="Submitted" v={fmtDateTime(r.created_at)} /><KV k="Reference" v={r.slip_reference ?? '-'} />
              {r.slip_path ? <Button size="sm" variant="outline" className="mt-2" icon={<FileImage className="h-4 w-4" />} onClick={() => viewSlip(r.id)}>View slip</Button> : <div className="mt-2 text-xs text-slate-400">No slip uploaded (customer pressed “check payment”)</div>}
              {r.status === 'WAITING' && (
                <div className="mt-3 grid grid-cols-3 gap-2">
                  <Button variant="success" size="sm" icon={<Check className="h-4 w-4" />} onClick={() => review(r.id, 'APPROVE')}>Approve</Button>
                  <Button variant="danger" size="sm" icon={<X className="h-4 w-4" />} onClick={() => review(r.id, 'REJECT')}>Reject</Button>
                  <Button variant="outline" size="sm" icon={<RotateCcw className="h-4 w-4" />} onClick={() => review(r.id, 'REQUEST_NEW_SLIP')}>New slip</Button>
                </div>
              )}
              {r.review_note && <div className="mt-2 text-xs text-slate-500">Note: {r.review_note}</div>}
            </Card>
          ))}
        </div>
      )}
      <Modal open={!!slip} onClose={() => setSlip(null)} title="Slip" size="lg">{slip && <img src={slip} className="mx-auto max-h-[75vh]" alt="slip" />}</Modal>
    </div>
  );
}
