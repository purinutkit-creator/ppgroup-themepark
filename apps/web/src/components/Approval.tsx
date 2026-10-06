import { useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { create } from 'zustand';
import { Button, Field, Input, Modal, toast } from './ui';
import { errorMessage, sapi, ApiError } from '../lib/api';

/**
 * Manager approval flow (Manager PIN). Call `withApproval(action, fn)` — it runs fn(); if the
 * server answers APPROVAL_REQUIRED, the PIN dialog opens, a single-use approval is created and
 * fn(approvalId) is retried.
 */
interface Pending { action: string; reason?: string; resolve: (id: string | null) => void }
const useApprovalStore = create<{ pending: Pending | null; set: (p: Pending | null) => void }>((set) => ({ pending: null, set: (pending) => set({ pending }) }));

export function requestApproval(action: string, reason?: string): Promise<string | null> {
  return new Promise((resolve) => useApprovalStore.getState().set({ action, reason, resolve }));
}

export async function withApproval<T>(action: string, fn: (approvalId?: string) => Promise<T>, reason?: string): Promise<T | null> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof ApiError && e.code === 'APPROVAL_REQUIRED') {
      const id = await requestApproval(e.details?.action ?? action, reason);
      if (!id) return null;
      return fn(id);
    }
    throw e;
  }
}

export function ApprovalHost() {
  const { pending, set } = useApprovalStore();
  const [code, setCode] = useState('');
  const [pin, setPin] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  if (!pending) return null;
  const close = (id: string | null) => { pending.resolve(id); set(null); setPin(''); setCode(''); setReason(''); };
  const submit = async () => {
    setBusy(true);
    try {
      const r = await sapi.post<{ approvalId: string }>('/api/approvals', { employeeCode: code, pin, action: pending.action, reason: reason || pending.reason || pending.action });
      toast.success('Manager approval granted');
      close(r.approvalId);
    } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={() => close(null)} title={<span className="flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-amber-500" /> Manager approval required</span>} size="sm"
      footer={<><Button variant="ghost" onClick={() => close(null)}>Cancel</Button><Button onClick={submit} loading={busy} disabled={!code || pin.length < 4}>Approve</Button></>}>
      <div className="mb-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">Action: <b>{pending.action.replaceAll('_', ' ')}</b></div>
      <div className="space-y-3">
        <Field label="Manager employee code"><Input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} autoFocus /></Field>
        <Field label="Manager PIN"><Input type="password" inputMode="numeric" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} maxLength={8} /></Field>
        <Field label="Reason"><Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={pending.reason ?? 'Reason for approval'} /></Field>
      </div>
    </Modal>
  );
}

export function useApprovalCall() {
  return async <T,>(action: string, fn: (approvalId?: string) => Promise<T>, onError = true) => {
    try { return await withApproval(action, fn); } catch (e) { if (onError) toast.error(errorMessage(e)); throw e; }
  };
}
