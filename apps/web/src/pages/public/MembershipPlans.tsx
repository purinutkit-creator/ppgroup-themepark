import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Check } from 'lucide-react';
import { mapi, papi, errorMessage, newKey } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useT } from '../../lib/i18n';
import { thb } from '../../lib/format';
import { Button, Modal, toast } from '../../components/ui';
import { QR } from '../../components/Codes';
import { usePublicConfig } from '../../lib/config';

export function MembershipPlans() {
  const t = useT();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const member = useAuth((s) => s.member);
  const cfg = usePublicConfig();
  const plans = useQuery({ queryKey: ['mplans'], queryFn: () => papi.get('/api/public/membership-products') });
  const me = useQuery({ queryKey: ['me'], queryFn: () => mapi.get('/api/member/me'), enabled: !!member });
  const branches = useQuery({ queryKey: ['pub-branches'], queryFn: () => papi.get('/api/public/branches') });
  const [payment, setPayment] = useState<any>(null);
  const current = me.data?.membership?.status === 'ACTIVE' ? me.data.membership : null;
  const buy = async (p: any, method: string) => {
    if (!member) return nav('/register?next=/membership');
    const mode = current ? (current.product_id === p.id ? 'RENEWAL' : 'UPGRADE') : params.get('renew') === p.id ? 'RENEWAL' : 'NEW';
    try {
      const r = await mapi.post('/api/member/checkout', { kind: 'MEMBERSHIP', branchId: branches.data?.[0]?.id, membershipProductId: p.id, mode, method }, { idempotencyKey: newKey() });
      if (!r.payment) { toast.success('Membership activated'); nav('/account'); return; }
      if (r.payment.provider_payload?.checkoutUrl) nav(`${r.payment.provider_payload.checkoutUrl}?return=/account`);
      else setPayment(r.payment);
    } catch (e) { toast.error(errorMessage(e)); }
  };
  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <h1 className="text-center text-3xl font-extrabold">{t('membership')}</h1>
      <p className="mt-2 text-center text-slate-500">ส่วนลดตั๋ว อาหาร ของที่ระลึก สะสมแต้มทวีคูณ และสิทธิพิเศษตลอดปี</p>
      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {plans.data?.map((p: any) => {
          const isCurrent = current?.product_id === p.id;
          const upgrade = current && !isCurrent && p.rank > (plans.data.find((x: any) => x.id === current.product_id)?.rank ?? 0);
          return (
            <div key={p.id} className="flex flex-col rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="rounded-2xl p-4 text-white" style={{ background: `linear-gradient(135deg, ${p.tier_color}, #0f172a)` }}>
                <div className="text-sm font-semibold uppercase tracking-widest text-white/70">{p.tier_name}</div>
                <div className="text-3xl font-black">{thb(p.annual_fee)}</div><div className="text-xs text-white/70">/ {p.validity_value} {p.validity_unit.toLowerCase()}</div>
              </div>
              <ul className="mt-4 flex-1 space-y-1.5 text-sm">
                {(p.benefits ?? []).map((b: any, i: number) => <li key={i} className="flex items-start gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />{b.label ?? b.type}</li>)}
              </ul>
              <div className="mt-4 space-y-2">
                {isCurrent ? <Button block variant="success" onClick={() => buy(p, 'PROMPTPAY')}>Renew</Button>
                  : <Button block onClick={() => buy(p, 'PROMPTPAY')} disabled={!!current && !upgrade}>{upgrade ? 'Upgrade' : member ? 'Join' : t('register')} (PromptPay)</Button>}
                {(!current || isCurrent || upgrade) && <Button block variant="outline" onClick={() => buy(p, 'CARD')}>Card</Button>}
              </div>
            </div>
          );
        })}
      </div>
      <Modal open={!!payment} onClose={() => setPayment(null)} title={t('scanToPay')}>
        {payment && <div className="text-center">
          <QR value={payment.provider_payload?.qrPayload} size={220} className="mx-auto" />
          <div className="mt-2 text-xl font-bold">{thb(payment.amount)}</div>
          {cfg.data?.simulator && <Button className="mt-3" variant="outline" size="sm" onClick={() => mapi.post(`/api/public/payments/${payment.id}/simulate`, { outcome: 'SUCCESS' }).then(() => { toast.success(t('paymentSuccess')); nav('/account'); })}>Simulate payment (dev)</Button>}
        </div>}
      </Modal>
    </div>
  );
}
