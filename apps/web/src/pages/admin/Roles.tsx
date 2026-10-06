import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { sapi, errorMessage } from '../../lib/api';
import { Badge, Button, Card, Field, Input, Loading, Modal, PageHeader, cx, toast } from '../../components/ui';

export function Roles() {
  const qc = useQueryClient();
  const roles = useQuery({ queryKey: ['roles'], queryFn: () => sapi.get('/api/admin/roles') });
  const perms = useQuery({ queryKey: ['perms'], queryFn: () => sapi.get('/api/admin/permissions') });
  const [sel, setSel] = useState<any>(null);
  const [set, setSet] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const [f, setF] = useState({ code: '', name: '', approvalLevel: '0' });
  useEffect(() => { if (sel) setSet(sel.permissions ?? []); }, [sel]);
  if (!roles.data || !perms.data) return <Loading />;
  const modules = [...new Set(perms.data.filter((p: any) => p.key !== '*').map((p: any) => p.module))] as string[];
  return (
    <div className="space-y-4">
      <PageHeader title="Roles & Permissions" actions={<Button icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>Custom role</Button>} />
      <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
        <Card padded={false}>{roles.data.map((r: any) => (
          <button key={r.id} onClick={() => setSel(r)} className={cx('flex w-full items-center justify-between border-b border-slate-100 px-4 py-2.5 text-left text-sm last:border-0', sel?.id === r.id ? 'bg-brand-50' : 'hover:bg-slate-50')}>
            <span><b>{r.name}</b><div className="text-xs text-slate-500">{r.code} · {r.staff_count} staff</div></span>{r.approval_level >= 50 && <Badge tone="amber">Approver</Badge>}
          </button>
        ))}</Card>
        {sel ? (
          <Card title={`${sel.name} permissions`} actions={<Button onClick={async () => { try { await sapi.put(`/api/admin/roles/${sel.id}/permissions`, set); toast.success('Saved'); qc.invalidateQueries({ queryKey: ['roles'] }); } catch (e) { toast.error(errorMessage(e)); } }}>Save</Button>}>
            {set.includes('*') ? <div className="rounded-lg bg-amber-50 p-3 text-sm">This role has <b>all permissions (*)</b>.</div> : (
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {modules.map((m) => (
                  <div key={m} className="rounded-xl border border-slate-100 p-3">
                    <div className="mb-1 text-xs font-bold uppercase text-slate-500">{m}</div>
                    {perms.data.filter((p: any) => p.module === m).map((p: any) => (
                      <label key={p.key} className="flex items-start gap-2 py-0.5 text-sm"><input type="checkbox" className="mt-1" checked={set.includes(p.key)} onChange={(e) => setSet(e.target.checked ? [...set, p.key] : set.filter((x) => x !== p.key))} />
                        <span>{p.action}<div className="text-[11px] text-slate-400">{p.description}</div></span></label>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </Card>
        ) : <Card><div className="p-8 text-center text-sm text-slate-400">Select a role</div></Card>}
      </div>
      <Modal open={creating} onClose={() => setCreating(false)} title="New custom role" footer={<Button onClick={async () => { try { await sapi.post('/api/admin/roles', { ...f, approvalLevel: Number(f.approvalLevel) }); setCreating(false); qc.invalidateQueries({ queryKey: ['roles'] }); } catch (e) { toast.error(errorMessage(e)); } }}>Create</Button>}>
        <div className="grid grid-cols-3 gap-3"><Field label="Code"><Input value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} /></Field><Field label="Name"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="Approval level (≥50 approver)"><Input value={f.approvalLevel} onChange={(e) => setF({ ...f, approvalLevel: e.target.value })} /></Field></div>
      </Modal>
    </div>
  );
}
