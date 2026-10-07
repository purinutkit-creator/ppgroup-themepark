import { useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Delete, LogIn } from 'lucide-react';
import { sapi, errorMessage } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { Button, Card, Field, Input, TextSizeControl, cx, toast } from '../../components/ui';
import { StaffLangToggle } from '../../components/StaffLangToggle';
import { useStaffTranslation } from '../../lib/staffI18n';
import { useSurfaceFont } from '../../lib/config';

/** Employee Code + PIN, or "Select Staff + PIN" on a paired device. */
export function StaffLogin() {
  useSurfaceFont('admin');
  useStaffTranslation();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const { setStaff, deviceKey, expiredNotice } = useAuth();
  const [code, setCode] = useState('');
  const [pin, setPin] = useState('');
  const [picked, setPicked] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const directory = useQuery({ queryKey: ['staff-dir', deviceKey], queryFn: () => sapi.get('/api/auth/staff-directory'), enabled: !!deviceKey, retry: false });
  const submit = async () => {
    setBusy(true);
    try {
      const r = await sapi.post('/api/auth/staff/login', picked ? { staffId: picked.id, pin } : { employeeCode: code.trim().toUpperCase(), pin });
      setStaff(r.token, r.staff);
      nav(params.get('next') ?? (r.staff.permissions.includes('dashboard.view') || r.staff.permissions.includes('*') ? '/staff' : r.staff.permissions.includes('gate.view') ? '/staff/gates' : r.staff.permissions.includes('pos.sell') ? '/staff/pos' : r.staff.permissions.includes('ride.view') ? '/staff/rides' : r.staff.permissions.includes('ticket.sell') ? '/staff/counter' : '/staff'));
    } catch (e) { toast.error(errorMessage(e)); setPin(''); } finally { setBusy(false); }
  };
  const press = (d: string) => setPin((p) => (d === 'del' ? p.slice(0, -1) : p.length < 8 ? p + d : p));
  return (
    <div className="relative flex min-h-full items-center justify-center bg-gradient-to-br from-slate-900 via-brand-900 to-slate-900 p-4">
      <div className="absolute right-3 top-3 flex gap-2"><StaffLangToggle dark /><TextSizeControl dark /></div>
      <Card className="w-full max-w-md">
        <div className="mb-4 text-center"><div className="text-4xl">🎡</div><div className="text-xl font-bold">Staff Login</div><div className="text-sm text-slate-500">ONE QR — Theme Park Management</div></div>
        {expiredNotice && <div className="mb-3 rounded-lg bg-amber-50 p-2 text-center text-sm text-amber-800">Session expired — please log in again.</div>}
        {directory.data?.length && !picked ? (
          <div className="mb-3 grid max-h-64 grid-cols-3 gap-2 overflow-y-auto">
            {directory.data.map((s: any) => <button key={s.id} onClick={() => setPicked(s)} className="rounded-xl border border-slate-200 p-2 text-center text-sm hover:border-brand-500"><div className="font-semibold">{s.nickname ?? s.first_name}</div><div className="text-[10px] text-slate-500">{s.role_name}</div></button>)}
          </div>
        ) : null}
        {picked ? (
          <div className="mb-3 flex items-center justify-between rounded-lg bg-brand-50 p-2 text-sm"><span><b>{picked.nickname ?? picked.first_name}</b> · {picked.employee_code}</span><button className="text-brand-600" onClick={() => setPicked(null)}>change</button></div>
        ) : (
          <Field label="Employee code"><Input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} autoFocus placeholder="EMP001" onKeyDown={(e) => e.key === 'Enter' && pin.length >= 4 && submit()} /></Field>
        )}
        <div className="my-3 flex justify-center gap-2">{Array.from({ length: Math.max(4, pin.length) }).map((_, i) => <span key={i} className={cx('h-3 w-3 rounded-full', i < pin.length ? 'bg-brand-600' : 'bg-slate-200')} />)}</div>
        <input type="password" className="sr-only" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 8))} onKeyDown={(e) => e.key === 'Enter' && submit()} aria-label="PIN" />
        <div className="grid grid-cols-3 gap-2">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9', 'del', '0', 'ok'].map((d) => (
            d === 'ok' ? <Button key={d} size="xl" onClick={submit} loading={busy} disabled={pin.length < 4 || (!picked && !code)} icon={<LogIn className="h-5 w-5" />} />
              : <button key={d} onClick={() => press(d)} className="rounded-xl bg-slate-100 py-4 text-2xl font-semibold hover:bg-slate-200 active:scale-95">{d === 'del' ? <Delete className="mx-auto h-6 w-6" /> : d}</button>
          ))}
        </div>
        <div className="mt-4 flex justify-between text-xs text-slate-500"><Link to="/device-setup">Device setup</Link><Link to="/">Customer website</Link></div>
      </Card>
    </div>
  );
}
