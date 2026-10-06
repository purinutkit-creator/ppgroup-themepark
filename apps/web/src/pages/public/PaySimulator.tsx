import { useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { CreditCard, Lock } from 'lucide-react';
import { papi, errorMessage } from '../../lib/api';
import { thb } from '../../lib/format';
import { Button, Card, Field, Input, Loading, toast } from '../../components/ui';

/** Stand-in for a payment provider's hosted card page (card data never touches our servers). */
export function PaySimulator() {
  const { paymentId } = useParams();
  const [params] = useSearchParams();
  const nav = useNavigate();
  const q = useQuery({ queryKey: ['pay', paymentId], queryFn: () => papi.get(`/api/public/payments/${paymentId}`) });
  const [busy, setBusy] = useState(false);
  const go = async (outcome: 'SUCCESS' | 'FAIL') => {
    setBusy(true);
    try { await papi.post(`/api/public/payments/${paymentId}/simulate`, { outcome }); nav(params.get('return') ?? '/'); }
    catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  };
  if (q.isLoading) return <Loading />;
  return (
    <div className="flex min-h-full items-center justify-center bg-slate-100 p-4">
      <Card className="w-full max-w-md" title={<span className="flex items-center gap-2"><Lock className="h-4 w-4 text-emerald-600" /> Secure Payment Gateway (Simulator)</span>}>
        <div className="mb-4 rounded-xl bg-slate-900 p-4 text-white"><div className="text-xs text-white/60">{q.data?.payment_no}</div><div className="text-3xl font-bold">{thb(q.data?.amount)}</div></div>
        <div className="space-y-3">
          <Field label="Card number"><Input defaultValue="4242 4242 4242 4242" /></Field>
          <div className="grid grid-cols-2 gap-3"><Field label="Expiry"><Input defaultValue="12/30" /></Field><Field label="CVC"><Input defaultValue="123" /></Field></div>
          <Button block size="lg" onClick={() => go('SUCCESS')} loading={busy} icon={<CreditCard className="h-4 w-4" />}>Pay {thb(q.data?.amount)}</Button>
          <Button block variant="ghost" onClick={() => go('FAIL')} disabled={busy}>Simulate decline</Button>
          <p className="text-center text-xs text-slate-400">In production this page is hosted by the payment provider (tokenisation). Card numbers are never stored by the park system.</p>
        </div>
      </Card>
    </div>
  );
}
