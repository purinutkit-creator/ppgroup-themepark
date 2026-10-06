import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, Link2, Maximize2, PauseCircle, PlayCircle, Plus, Printer, RefreshCw, Search, ShieldAlert, Unlink, Wallet, XCircle } from 'lucide-react';
import { sapi, errorMessage, qs } from '../../lib/api';
import { useBranchId, useCan } from '../../lib/auth';
import { fmtDateTime, thb, toSatang } from '../../lib/format';
import { withApproval } from '../../components/Approval';
import { CardProfileView } from '../../components/CardProfile';
import { Barcode, QR } from '../../components/Codes';
import { printNode, WristbandPrint } from '../../components/Print';
import { ScanBox } from '../../components/ScanBox';
import { Badge, Button, Card, Field, Input, Loading, Modal, PageHeader, Select, Table, toast } from '../../components/ui';

export function Cards() {
  const branchId = useBranchId();
  const can = useCan();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const id = params.get('id');
  const [f, setF] = useState({ q: '', type: '', status: '' });
  const list = useQuery({ queryKey: ['credentials', branchId, f], queryFn: () => sapi.get(`/api/credentials${qs({ branchId, ...f })}`), enabled: !!branchId && !id });
  const prof = useQuery({ queryKey: ['card', id], queryFn: () => sapi.get(`/api/credentials/${id}`), enabled: !!id });
  const [issue, setIssue] = useState(false);
  const [issued, setIssued] = useState<any[] | null>(null);
  const [form, setForm] = useState({ type: 'WRISTBAND', count: 1, activate: true, physicalSerial: '', memberId: '' });
  const [barcode, setBarcode] = useState<any>(null);
  const [replace, setReplace] = useState(false);
  const [bind, setBind] = useState(false);
  const [adjust, setAdjust] = useState(false);
  const [rep, setRep] = useState({ reason: 'LOST', newType: '', physicalSerial: '', note: '' });
  const [memberQ, setMemberQ] = useState('');
  const [adj, setAdj] = useState({ direction: 'CREDIT', amount: '', reason: '' });
  const members = useQuery({ queryKey: ['members', memberQ], queryFn: () => sapi.get(`/api/members${qs({ q: memberQ })}`), enabled: bind && memberQ.length >= 2 });
  const refresh = () => { qc.invalidateQueries({ queryKey: ['card', id] }); qc.invalidateQueries({ queryKey: ['credentials'] }); };
  const status = async (s: string) => {
    const reason = prompt(`Reason for ${s}?`);
    if (!reason) return;
    try { await sapi.post(`/api/credentials/${id}/status`, { status: s, reason }); toast.success(`Card ${s}`); refresh(); } catch (e) { toast.error(errorMessage(e)); }
  };
  const openBarcode = async (cid: string) => { try { setBarcode(await sapi.get(`/api/credentials/${cid}/barcode`)); } catch (e) { toast.error(errorMessage(e)); } };

  if (id) {
    if (!prof.data) return <Loading />;
    const c = prof.data.credential;
    return (
      <div className="space-y-4">
        <Button variant="ghost" onClick={() => setParams({})}>← All cards</Button>
        <CardProfileView profile={prof.data} actions={
          <div className="flex flex-wrap gap-2">
            {can('credential.issue') && <Button size="sm" variant="outline" icon={<Maximize2 className="h-4 w-4" />} onClick={() => openBarcode(c.id)}>เปิด Barcode ของบัตร</Button>}
            {can('credential.issue') && ['WRISTBAND', 'PRINTED_WRISTBAND', 'TEMP_CARD'].includes(c.type) && <Button size="sm" variant="outline" icon={<Printer className="h-4 w-4" />} onClick={async () => printNode(<WristbandPrint w={await sapi.get(`/api/print/wristband/${c.id}`)} />)}>Print</Button>}
            {can('credential.manage') && <>
              {['NEW', 'SUSPENDED', 'BLOCKED', 'EXPIRED'].includes(c.status) && <Button size="sm" variant="success" icon={<PlayCircle className="h-4 w-4" />} onClick={() => status('ACTIVE')}>Activate</Button>}
              {c.status === 'ACTIVE' && <Button size="sm" variant="warning" icon={<PauseCircle className="h-4 w-4" />} onClick={() => status('SUSPENDED')}>Suspend</Button>}
              {['ACTIVE', 'SUSPENDED'].includes(c.status) && <Button size="sm" variant="danger" icon={<ShieldAlert className="h-4 w-4" />} onClick={() => setReplace(true)}>Report lost / Replace</Button>}
              {!['BLOCKED', 'CLOSED'].includes(c.status) && <Button size="sm" variant="outline" icon={<Ban className="h-4 w-4" />} onClick={() => status('BLOCKED')}>Block</Button>}
              {c.status !== 'CLOSED' && <Button size="sm" variant="ghost" icon={<XCircle className="h-4 w-4" />} onClick={() => status('CLOSED')}>Close</Button>}
              {!c.memberId ? <Button size="sm" variant="outline" icon={<Link2 className="h-4 w-4" />} onClick={() => setBind(true)}>Bind member</Button>
                : c.type !== 'DIGITAL_CARD' && <Button size="sm" variant="ghost" icon={<Unlink className="h-4 w-4" />} onClick={async () => { const reason = prompt('Unbind reason?'); if (reason) { await sapi.post(`/api/credentials/${c.id}/unbind`, { reason }).catch((e) => toast.error(errorMessage(e))); refresh(); } }}>Unbind member</Button>}
              <Button size="sm" variant="ghost" icon={<RefreshCw className="h-4 w-4" />} onClick={async () => { if (confirm('Rotate QR token? Old printed QR stops working immediately.')) { await sapi.post(`/api/credentials/${c.id}/rotate`); toast.success('Token rotated'); } }}>Rotate token</Button>
            </>}
            {can('wallet.adjust') && <Button size="sm" variant="outline" icon={<Wallet className="h-4 w-4" />} onClick={() => setAdjust(true)}>Wallet adjustment</Button>}
          </div>} />
        <Modal open={replace} onClose={() => setReplace(false)} title="Report lost / Replace card" footer={<Button variant="danger" onClick={async () => {
          try {
            const r = await withApproval('CARD_REPLACE', (approvalId) => sapi.post(`/api/credentials/${c.id}/replace`, { reason: rep.reason, newType: rep.newType || undefined, physicalSerial: rep.physicalSerial || null, note: rep.note || undefined, approvalId }));
            if (!r) return;
            toast.success(`Old card disabled. New card ${r.credential.code}`);
            setReplace(false); setParams({ id: r.credential.id }); setBarcode({ code: r.credential.code, type: r.credential.type, status: 'ACTIVE', ...r.payloads });
          } catch (e) { toast.error(errorMessage(e)); }
        }}>Disable old & TRANSFER TO NEW CARD</Button>}>
          <div className="space-y-3">
            <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">The old card is disabled immediately. Member, wallet, tickets, points, ride rights, bookings, lockers and queue move to the new card. History stays on the old card.</div>
            <Field label="Reason"><Select value={rep.reason} onChange={(e) => setRep({ ...rep, reason: e.target.value })}>{['LOST', 'STOLEN', 'DAMAGED', 'UPGRADE', 'OTHER'].map((r) => <option key={r}>{r}</option>)}</Select></Field>
            <Field label="New card type"><Select value={rep.newType} onChange={(e) => setRep({ ...rep, newType: e.target.value })}><option value="">Same as old ({c.type})</option>{['MEMBER_CARD', 'WRISTBAND', 'PRINTED_WRISTBAND', 'TEMP_CARD'].map((t) => <option key={t}>{t}</option>)}</Select></Field>
            <Field label="Pre-printed card / wristband serial (optional)"><Input value={rep.physicalSerial} onChange={(e) => setRep({ ...rep, physicalSerial: e.target.value })} /></Field>
            <Field label="Note"><Input value={rep.note} onChange={(e) => setRep({ ...rep, note: e.target.value })} /></Field>
          </div>
        </Modal>
        <Modal open={bind} onClose={() => setBind(false)} title="Bind to member">
          <Input placeholder="Search phone / email / member ID" value={memberQ} onChange={(e) => setMemberQ(e.target.value)} autoFocus />
          <div className="mt-2 divide-y">{members.data?.map((m: any) => <button key={m.id} className="flex w-full justify-between py-2 text-left text-sm hover:bg-slate-50" onClick={async () => {
            try { await sapi.post(`/api/credentials/${c.id}/bind`, { memberId: m.id }); toast.success('Bound — guest wallet balance & rights moved to member'); setBind(false); refresh(); } catch (e) { toast.error(errorMessage(e)); }
          }}><span>{m.first_name} {m.last_name} · {m.phone}</span><span>{m.member_code}</span></button>)}</div>
        </Modal>
        <Modal open={adjust} onClose={() => setAdjust(false)} title="Wallet adjustment" footer={<Button onClick={async () => {
          try { await withApproval('WALLET_ADJUST', (approvalId) => sapi.post('/api/wallet/adjust', { credentialId: c.id, direction: adj.direction, amount: toSatang(adj.amount), reason: adj.reason, approvalId }), adj.reason); toast.success('Adjusted'); setAdjust(false); refresh(); }
          catch (e) { toast.error(errorMessage(e)); }
        }}>Post adjustment</Button>}>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Direction"><Select value={adj.direction} onChange={(e) => setAdj({ ...adj, direction: e.target.value })}><option value="CREDIT">Credit (+)</option><option value="DEBIT">Debit (−)</option></Select></Field>
            <Field label="Amount (THB)"><Input inputMode="decimal" value={adj.amount} onChange={(e) => setAdj({ ...adj, amount: e.target.value })} /></Field>
            <Field label="Reason" className="col-span-2"><Input value={adj.reason} onChange={(e) => setAdj({ ...adj, reason: e.target.value })} /></Field>
          </div>
        </Modal>
        <BarcodeFullscreen data={barcode} onClose={() => setBarcode(null)} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader title="Cards & Wristbands" subtitle="Central credential system — one card for everything"
        actions={can('credential.issue') && <Button icon={<Plus className="h-4 w-4" />} onClick={() => { setIssue(true); setIssued(null); }}>Issue new card</Button>} />
      <Card><ScanBox onScan={async (c) => { try { const p = await sapi.post('/api/credentials/scan', { scan: c }); setParams({ id: p.credential.id }); } catch (e) { toast.error(errorMessage(e)); } }} /></Card>
      <Card padded={false}>
        <div className="flex flex-wrap gap-2 border-b border-slate-100 p-3">
          <div className="relative flex-1"><Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" /><Input className="pl-9" placeholder="Card ID / serial / phone / email / member ID / name" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} /></div>
          <Select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })} className="w-auto"><option value="">All types</option>{['MEMBER_CARD', 'DIGITAL_CARD', 'TEMP_CARD', 'WRISTBAND', 'PRINTED_WRISTBAND'].map((t) => <option key={t}>{t}</option>)}</Select>
          <Select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })} className="w-auto"><option value="">All status</option>{['NEW', 'ACTIVE', 'SUSPENDED', 'LOST', 'BLOCKED', 'EXPIRED', 'REPLACED', 'CLOSED'].map((t) => <option key={t}>{t}</option>)}</Select>
        </div>
        {list.isLoading ? <Loading /> : <Table rows={list.data ?? []} onRowClick={(r: any) => setParams({ id: r.id })} columns={[
          { key: 'code', header: 'Card ID', render: (r: any) => <span className="font-mono font-semibold">{r.code}</span> }, { key: 'type', header: 'Type' }, { key: 'status', header: 'Status', render: (r: any) => <Badge>{r.status}</Badge> },
          { key: 'member', header: 'Member', render: (r: any) => (r.member_code ? `${r.member_name} · ${r.member_code}` : '-') }, { key: 'wallet_balance', header: 'Wallet', align: 'right', render: (r: any) => thb(r.wallet_balance ?? 0) },
          { key: 'issued_at', header: 'Issued', render: (r: any) => fmtDateTime(r.issued_at) }, { key: 'expires_at', header: 'Expires', render: (r: any) => fmtDateTime(r.expires_at) }]} />}
      </Card>
      <Modal open={issue} onClose={() => setIssue(false)} title="Issue new card / wristband" size={issued ? 'lg' : 'md'} footer={!issued && <Button onClick={async () => {
        try { setIssued(await sapi.post('/api/credentials/issue', { ...form, count: Number(form.count), physicalSerial: form.physicalSerial || null, memberId: form.memberId || null, branchId })); qc.invalidateQueries({ queryKey: ['credentials'] }); }
        catch (e) { toast.error(errorMessage(e)); }
      }}>Issue</Button>}>
        {!issued ? (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Type"><Select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>{['WRISTBAND', 'PRINTED_WRISTBAND', 'TEMP_CARD', 'MEMBER_CARD'].map((t) => <option key={t}>{t}</option>)}</Select></Field>
            <Field label="Quantity"><Input type="number" min={1} max={500} value={form.count} onChange={(e) => setForm({ ...form, count: Number(e.target.value) })} /></Field>
            <Field label="Physical serial (single card)"><Input value={form.physicalSerial} onChange={(e) => setForm({ ...form, physicalSerial: e.target.value })} /></Field>
            <Field label="Status"><Select value={String(form.activate)} onChange={(e) => setForm({ ...form, activate: e.target.value === 'true' })}><option value="true">ACTIVE (ready to use)</option><option value="false">NEW (stock, activate at counter)</option></Select></Field>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {issued.map((c) => <div key={c.id} className="flex items-center gap-3 rounded-xl border p-3"><QR value={c.qr} size={80} /><div><div className="font-mono font-bold">{c.code}</div><Badge>{c.status}</Badge>
              <div className="mt-1 flex gap-1"><Button size="xs" variant="outline" onClick={() => setBarcode(c)}>Open</Button><Button size="xs" variant="ghost" onClick={() => setParams({ id: c.id })}>Profile</Button></div></div></div>)}
          </div>
        )}
      </Modal>
      <BarcodeFullscreen data={barcode} onClose={() => setBarcode(null)} />
    </div>
  );
}

/** Full-screen barcode / QR for scanning, printing or binding to a physical card. */
function BarcodeFullscreen({ data, onClose }: { data: any; onClose: () => void }) {
  if (!data) return null;
  return (
    <div className="fixed inset-0 z-[60] flex flex-col items-center justify-center gap-6 bg-white p-6" onClick={onClose}>
      <div className="text-sm uppercase tracking-widest text-slate-500">{data.type} · {data.status}</div>
      <div className="font-mono text-4xl font-black">{data.code}</div>
      <QR value={data.qr} size={Math.min(380, window.innerWidth - 80)} />
      <Barcode value={data.barcode} height={90} width={2.4} />
      <div className="flex gap-2" onClick={(e) => e.stopPropagation()}>
        <Button variant="outline" icon={<Printer className="h-4 w-4" />} onClick={() => printNode(<div className="p-6 text-center"><div className="font-mono text-xl font-bold">{data.code}</div><QR value={data.qr} size={220} /><Barcode value={data.barcode} height={60} width={1.8} /></div>)}>Print</Button>
        <Button onClick={onClose}>Close</Button>
      </div>
    </div>
  );
}


