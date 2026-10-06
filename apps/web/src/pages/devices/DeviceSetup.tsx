import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { sapi, errorMessage } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { Badge, Button, Card, Field, Input, toast } from '../../components/ui';

/** Pair this browser with a registered device (API key from Admin → Devices) and pick its screen. */
export function DeviceSetup() {
  const { deviceKey, setDeviceKey, staffToken } = useAuth();
  const [key, setKey] = useState(deviceKey ?? '');
  const nav = useNavigate();
  const [params] = useSearchParams();
  const me = useQuery({ queryKey: ['device-me', deviceKey], queryFn: () => sapi.get('/api/auth/me'), enabled: !!deviceKey || !!staffToken, retry: false });
  const gates = useQuery({ queryKey: ['setup-gates'], queryFn: () => sapi.get('/api/gates'), enabled: !!me.data, retry: false });
  const rides = useQuery({ queryKey: ['setup-rides'], queryFn: () => sapi.get('/api/rides'), enabled: !!me.data, retry: false });
  const stores = useQuery({ queryKey: ['setup-stores', me.data?.device?.branch_id ?? me.data?.staff?.branch_id], queryFn: () => sapi.get(`/api/public/stores?branchId=${me.data?.device?.branch_id ?? me.data?.staff?.branch_id ?? useAuth.getState().branchId}`), enabled: !!me.data });
  const save = async () => {
    setDeviceKey(key.trim() || null);
    try { const r = await fetch('/api/auth/me', { headers: { 'x-device-key': key.trim() } }); if (!r.ok) throw new Error('Invalid device key'); toast.success('Device paired'); if (params.get('next')) nav(params.get('next')!); }
    catch (e) { toast.error(errorMessage(e)); }
  };
  return (
    <div className="mx-auto max-w-3xl space-y-4 p-6">
      <Card title="Device setup">
        <div className="flex gap-2"><Field label="Device API key (tpd_…)" className="flex-1"><Input value={key} onChange={(e) => setKey(e.target.value)} placeholder="tpd_xxxxxxxx_…" /></Field>
          <Button className="self-end" onClick={save}>Pair</Button>{deviceKey && <Button className="self-end" variant="ghost" onClick={() => { setDeviceKey(null); setKey(''); }}>Unpair</Button>}</div>
        {me.data?.device && <div className="mt-3 text-sm">Paired as <b>{me.data.device.code}</b> · {me.data.device.name} <Badge>{me.data.device.type}</Badge></div>}
        {!me.data?.device && staffToken && <div className="mt-3 text-sm text-slate-500">Using staff session ({me.data?.staff?.employee_code}).</div>}
        {!deviceKey && !staffToken && <div className="mt-3 text-sm text-slate-500">Or <Link className="text-brand-600 underline" to="/staff/login?next=/device-setup">log in as staff</Link> to open device screens.</div>}
      </Card>
      {me.data && (
        <div className="grid gap-4 md:grid-cols-2">
          <Card title="Gate customer displays">{gates.data?.map((g: any) => <Link key={g.id} to={`/gate/${g.id}/display`} className="block rounded-lg px-2 py-1.5 text-sm hover:bg-slate-50">{g.name} <Badge>{g.direction}</Badge></Link>) ?? <div className="text-sm text-slate-400">No access</div>}</Card>
          <Card title="Ride scanners">{rides.data?.map((r: any) => <Link key={r.id} to={`/ride/${r.id}/scanner`} className="block rounded-lg px-2 py-1.5 text-sm hover:bg-slate-50">{r.name}</Link>) ?? <div className="text-sm text-slate-400">No access</div>}</Card>
          <Card title="Kitchen & order boards">{stores.data?.filter((s: any) => s.type === 'RESTAURANT').map((s: any) => <div key={s.id} className="flex gap-3 px-2 py-1.5 text-sm">{s.name}: <Link className="text-brand-600" to={`/kds/${s.id}`}>KDS</Link><Link className="text-brand-600" to={`/board/${s.id}`}>Ready board</Link><Link className="text-brand-600" to={`/order/${s.id}`}>QR order</Link></div>)}</Card>
          <Card title="Customer kiosk"><Link to="/kiosk" className="text-brand-600">Open kiosk</Link></Card>
        </div>
      )}
    </div>
  );
}
