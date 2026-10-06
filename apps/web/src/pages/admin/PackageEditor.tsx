import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
import { sapi, errorMessage, qs } from '../../lib/api';
import { useBranchId } from '../../lib/auth';
import { Badge, Button, Card, Input, Loading, PageHeader, Select, toast } from '../../components/ui';

const ENT = ['ONE_TIME', 'MULTI_USE', 'UNLIMITED', 'TIME_BASED', 'DATE_BASED'];

/** Package composition: guest-type prices, ride entitlements (ALL / SELECT), zones, benefits, blackout dates. */
export function PackageEditor() {
  const { id } = useParams();
  const nav = useNavigate();
  const branchId = useBranchId();
  const pkg = useQuery({ queryKey: ['pkg', id], queryFn: () => sapi.get(`/api/admin/packages/${id}`) });
  const comp = useQuery({ queryKey: ['pkg-comp', id], queryFn: () => sapi.get(`/api/admin/packages/${id}/composition`) });
  const tts = useQuery({ queryKey: ['tts'], queryFn: () => sapi.get('/api/admin/ticket-types') });
  const rides = useQuery({ queryKey: ['rides-all', branchId], queryFn: () => sapi.get(`/api/admin/rides${qs({ branchId })}`), enabled: !!branchId });
  const zones = useQuery({ queryKey: ['zones-all', branchId], queryFn: () => sapi.get(`/api/admin/zones${qs({ branchId })}`), enabled: !!branchId });
  const [prices, setPrices] = useState<Record<string, { price: string; memberPrice: string; on: boolean }>>({});
  const [rideRows, setRideRows] = useState<Record<string, { on: boolean; type: string; uses: string }>>({});
  const [zoneSet, setZoneSet] = useState<string[]>([]);
  const [benefits, setBenefits] = useState<any[]>([]);
  const [blackout, setBlackout] = useState<string>('');
  useEffect(() => {
    if (!comp.data) return;
    setPrices(Object.fromEntries(comp.data.prices.map((p: any) => [p.ticket_type_id, { price: String(p.price / 100), memberPrice: p.member_price != null ? String(p.member_price / 100) : '', on: true }])));
    setRideRows(Object.fromEntries(comp.data.rides.map((r: any) => [r.ride_id, { on: true, type: r.entitlement_type, uses: r.uses ? String(r.uses) : '' }])));
    setZoneSet(comp.data.zones);
    setBenefits(comp.data.benefits.map((b: any) => ({ type: b.type, value: String(b.value / 100), label: b.label ?? '' })));
    setBlackout(comp.data.blackout.map((b: any) => b.date).join('\n'));
  }, [comp.data]);
  if (!pkg.data || !comp.data) return <Loading />;
  const p = pkg.data;
  const save = async () => {
    try {
      await sapi.put(`/api/admin/packages/${id}/composition`, {
        prices: Object.entries(prices).filter(([, v]) => v.on && v.price !== '').map(([ticketTypeId, v]) => ({ ticketTypeId, price: Math.round(Number(v.price) * 100), memberPrice: v.memberPrice ? Math.round(Number(v.memberPrice) * 100) : null })),
        rides: Object.entries(rideRows).filter(([, v]) => v.on).map(([rideId, v]) => ({ rideId, entitlementType: v.type, uses: v.uses ? Number(v.uses) : null })),
        zones: zoneSet,
        benefits: benefits.map((b) => ({ type: b.type, value: Math.round(Number(b.value || 0) * 100), label: b.label || null })),
        blackout: blackout.split(/\s+/).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).map((date) => ({ date })),
      });
      toast.success('Package composition saved');
    } catch (e) { toast.error(errorMessage(e)); }
  };
  return (
    <div className="space-y-4">
      <PageHeader title={p.name} subtitle={`${p.code} · ${p.category} · ${p.pricing_mode} · ride access ${p.ride_access}`} actions={<><Button variant="ghost" onClick={() => nav('/staff/admin/packages')}>Back</Button><Button onClick={save}>Save composition</Button></>} />
      {p.pricing_mode === 'PER_GUEST' && (
        <Card title="Prices per guest type">
          <div className="space-y-2">{tts.data?.map((t: any) => {
            const v = prices[t.id] ?? { price: '', memberPrice: '', on: false };
            return (
              <div key={t.id} className="grid grid-cols-[30px_1fr_140px_140px] items-center gap-2">
                <input type="checkbox" checked={v.on} onChange={(e) => setPrices({ ...prices, [t.id]: { ...v, on: e.target.checked } })} />
                <div className="text-sm font-medium">{t.name} <span className="text-slate-400">({t.code})</span></div>
                <Input type="number" step="0.01" placeholder="Price ฿" value={v.price} onChange={(e) => setPrices({ ...prices, [t.id]: { ...v, price: e.target.value, on: true } })} />
                <Input type="number" step="0.01" placeholder="Member ฿" value={v.memberPrice} onChange={(e) => setPrices({ ...prices, [t.id]: { ...v, memberPrice: e.target.value } })} />
              </div>
            );
          })}</div>
        </Card>
      )}
      <Card title={<span>Ride entitlements {p.ride_access === 'ALL' && <Badge tone="green">ALL RIDES ({p.ride_access_type})</Badge>}{p.ride_access === 'NONE' && <Badge>NONE</Badge>}</span>}>
        {p.ride_access !== 'SELECT' ? <div className="text-sm text-slate-500">Ride access is <b>{p.ride_access}</b>. Change “Ride access” to SELECT on the package to pick individual rides.</div> : (
          <div className="grid gap-2 md:grid-cols-2">{rides.data?.map((r: any) => {
            const v = rideRows[r.id] ?? { on: false, type: 'UNLIMITED', uses: '' };
            return (
              <div key={r.id} className="grid grid-cols-[30px_1fr_140px_70px] items-center gap-2 rounded-lg border border-slate-100 p-2">
                <input type="checkbox" checked={v.on} onChange={(e) => setRideRows({ ...rideRows, [r.id]: { ...v, on: e.target.checked } })} />
                <div className="text-sm">{v.on ? '✓' : '✕'} {r.name}</div>
                <Select value={v.type} onChange={(e) => setRideRows({ ...rideRows, [r.id]: { ...v, type: e.target.value, on: true } })} className="py-1 text-xs">{ENT.map((x) => <option key={x}>{x}</option>)}</Select>
                <Input placeholder="uses" value={v.uses} disabled={!['MULTI_USE'].includes(v.type)} onChange={(e) => setRideRows({ ...rideRows, [r.id]: { ...v, uses: e.target.value } })} className="py-1" />
              </div>
            );
          })}</div>
        )}
      </Card>
      <div className="grid gap-4 md:grid-cols-3">
        <Card title="Zones (when zone access = SELECT)">{zones.data?.map((z: any) => <label key={z.id} className="flex items-center gap-2 py-1 text-sm"><input type="checkbox" checked={zoneSet.includes(z.id)} onChange={(e) => setZoneSet(e.target.checked ? [...zoneSet, z.id] : zoneSet.filter((x) => x !== z.id))} />{z.name}</label>)}</Card>
        <Card title="Benefits">
          {benefits.map((b, i) => (
            <div key={i} className="mb-2 grid grid-cols-[1fr_80px_30px] gap-1">
              <Select value={b.type} onChange={(e) => setBenefits(benefits.map((x, j) => (j === i ? { ...x, type: e.target.value } : x)))} className="py-1 text-xs">{['FOOD_VOUCHER', 'LOCKER', 'FAST_PASS', 'WALLET_CREDIT', 'PHOTO', 'CUSTOM'].map((t) => <option key={t}>{t}</option>)}</Select>
              <Input value={b.value} onChange={(e) => setBenefits(benefits.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} className="py-1" placeholder="฿" />
              <button onClick={() => setBenefits(benefits.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4 text-slate-400" /></button>
              <Input className="col-span-3 py-1" placeholder="label" value={b.label} onChange={(e) => setBenefits(benefits.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
            </div>
          ))}
          <Button size="xs" variant="outline" onClick={() => setBenefits([...benefits, { type: 'FOOD_VOUCHER', value: '', label: '' }])}>+ Benefit</Button>
        </Card>
        <Card title="Blackout dates"><textarea className="h-40 w-full rounded-lg border border-slate-300 p-2 font-mono text-xs" placeholder="YYYY-MM-DD (one per line)" value={blackout} onChange={(e) => setBlackout(e.target.value)} /></Card>
      </div>
    </div>
  );
}
