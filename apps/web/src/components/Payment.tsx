import { useEffect, useMemo, useState } from 'react';
import { Banknote, CreditCard, QrCode, Smartphone, Star, Trash2, Wallet } from 'lucide-react';
import { Badge, Button, Field, Input, Modal, cx, toast } from './ui';
import { QR } from './Codes';
import { ScanBox } from './ScanBox';
import { sapi, errorMessage } from '../lib/api';
import { thb, toSatang } from '../lib/format';

export interface PaymentLine { method: string; amount: number; tendered?: number; reference?: string; scan?: string; credentialId?: string }

const METHODS = [
  { method: 'CASH', label: 'Cash', icon: Banknote },
  { method: 'PROMPTPAY', label: 'PromptPay', icon: QrCode },
  { method: 'CARD', label: 'Credit Card', icon: CreditCard },
  { method: 'DEBIT', label: 'Debit Card', icon: CreditCard },
  { method: 'EWALLET', label: 'E-Wallet', icon: Smartphone },
  { method: 'WALLET', label: 'Park Wallet', icon: Wallet },
  { method: 'POINTS', label: 'Points', icon: Star },
];

/**
 * Split / mixed payment collector. Wallet uses the scanned credential (balance checked
 * server-side); cash computes change; PromptPay shows a dynamic QR for the line amount.
 */
export function PaymentDialog({ open, onClose, total, onConfirm, credential, allowed, title = 'Payment', busy }: {
  open: boolean; onClose: () => void; total: number; onConfirm: (lines: PaymentLine[]) => Promise<void> | void;
  credential?: { id: string; code: string; walletBalance?: number | null; memberPoints?: number | null } | null; allowed?: string[]; title?: string; busy?: boolean;
}) {
  const [lines, setLines] = useState<PaymentLine[]>([]);
  const [method, setMethod] = useState('CASH');
  const [amount, setAmount] = useState('');
  const [tendered, setTendered] = useState('');
  const [reference, setReference] = useState('');
  const [walletCred, setWalletCred] = useState<{ id: string; code: string; balance: number } | null>(null);
  const [ppQr, setPpQr] = useState<string | null>(null);
  const paid = lines.reduce((s, l) => s + l.amount, 0);
  const remaining = Math.max(0, total - paid);
  useEffect(() => { if (open) { setLines([]); setMethod('CASH'); setAmount(''); setTendered(''); setReference(''); setPpQr(null); setWalletCred(credential ? { id: credential.id, code: credential.code, balance: credential.walletBalance ?? 0 } : null); } }, [open, credential]);
  const lineAmount = amount ? toSatang(amount) : remaining;
  useEffect(() => {
    if (method !== 'PROMPTPAY' || lineAmount <= 0) { setPpQr(null); return; }
    sapi.get(`/api/promptpay-qr?amount=${lineAmount}`).then((r) => setPpQr(r.payload)).catch(() => setPpQr(null));
  }, [method, lineAmount]);
  const available = METHODS.filter((m) => !allowed || allowed.includes(m.method));
  const quick = useMemo(() => {
    const base = remaining / 100;
    const notes = [base, Math.ceil(base / 100) * 100, Math.ceil(base / 500) * 500, Math.ceil(base / 1000) * 1000];
    return [...new Set(notes)].filter((n) => n >= base).slice(0, 4);
  }, [remaining]);

  const addLine = () => {
    if (lineAmount <= 0 || lineAmount > remaining) return toast.error('Invalid amount');
    const l: PaymentLine = { method, amount: lineAmount };
    if (method === 'CASH') {
      const t = tendered ? toSatang(tendered) : lineAmount;
      if (t < lineAmount) return toast.error('Tendered less than amount');
      l.tendered = t;
    }
    if (method === 'WALLET') {
      if (!walletCred) return toast.error('Scan card / wristband for wallet payment');
      if (walletCred.balance < lineAmount) return toast.error(`Insufficient wallet balance (${thb(walletCred.balance)})`);
      l.credentialId = walletCred.id;
    }
    if (['CARD', 'DEBIT', 'EWALLET', 'PROMPTPAY'].includes(method) && reference) l.reference = reference;
    setLines([...lines, l]);
    setAmount(''); setTendered(''); setReference('');
  };
  const confirm = async () => {
    let all = lines;
    if (remaining > 0) {
      // implicit single line for the remaining amount
      const l: PaymentLine = { method, amount: remaining };
      if (method === 'CASH') { const t = tendered ? toSatang(tendered) : remaining; if (t < remaining) return toast.error('Tendered less than amount'); l.tendered = t; }
      if (method === 'WALLET') { if (!walletCred) return toast.error('Scan card for wallet'); l.credentialId = walletCred.id; }
      if (reference) l.reference = reference;
      all = [...lines, l];
    }
    await onConfirm(all);
  };
  const change = method === 'CASH' && tendered ? Math.max(0, toSatang(tendered) - (amount ? toSatang(amount) : remaining)) : 0;

  return (
    <Modal open={open} onClose={onClose} title={title} size="lg" footer={<>
      <Button variant="ghost" onClick={onClose}>Cancel</Button>
      <Button size="lg" variant="success" onClick={confirm} loading={busy} disabled={total <= 0 && lines.length === 0 && total !== 0}>Confirm {thb(total)}</Button>
    </>}>
      <div className="grid gap-4 md:grid-cols-[1fr_260px]">
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {available.map((m) => (
              <button key={m.method} onClick={() => setMethod(m.method)} className={cx('flex flex-col items-center gap-1 rounded-xl border-2 p-3 text-xs font-medium transition',
                method === m.method ? 'border-brand-600 bg-brand-50 text-brand-700' : 'border-slate-200 text-slate-600 hover:border-slate-300')}>
                <m.icon className="h-5 w-5" />{m.label}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Amount (blank = remaining)"><Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={(remaining / 100).toFixed(2)} /></Field>
            {method === 'CASH' && <Field label="Cash tendered"><Input inputMode="decimal" value={tendered} onChange={(e) => setTendered(e.target.value)} placeholder="0.00" /></Field>}
            {['CARD', 'DEBIT', 'EWALLET', 'PROMPTPAY'].includes(method) && <Field label="Approval / reference no."><Input value={reference} onChange={(e) => setReference(e.target.value)} /></Field>}
          </div>
          {method === 'CASH' && (
            <div className="flex flex-wrap gap-2">
              {quick.map((q) => <Button key={q} size="sm" variant="outline" onClick={() => setTendered(String(q))}>฿{q.toLocaleString()}</Button>)}
              {change > 0 && <div className="ml-auto rounded-lg bg-emerald-50 px-3 py-1.5 text-sm font-semibold text-emerald-700">Change {thb(change)}</div>}
            </div>
          )}
          {method === 'PROMPTPAY' && ppQr && (
            <div className="flex items-center gap-4 rounded-xl border border-slate-200 p-3">
              <QR value={ppQr} size={150} />
              <div className="text-sm text-slate-600">Customer scans with any banking app.<br />Amount <b>{thb(lineAmount)}</b>.<br />Confirm after the bank notification arrives.</div>
            </div>
          )}
          {method === 'WALLET' && (
            <div className="space-y-2">
              {walletCred ? (
                <div className="flex items-center justify-between rounded-xl bg-violet-50 p-3 text-sm">
                  <span>Card <b>{walletCred.code}</b></span><span>Balance <b>{thb(walletCred.balance)}</b></span>
                  <Button size="xs" variant="ghost" onClick={() => setWalletCred(null)}>Change</Button>
                </div>
              ) : (
                <ScanBox compact global={false} onScan={async (c) => {
                  try { const p = await sapi.post('/api/credentials/scan', { scan: c }); setWalletCred({ id: p.credential.id, code: p.credential.code, balance: p.wallet?.balance ?? 0 }); }
                  catch (e) { toast.error(errorMessage(e)); }
                }} />
              )}
            </div>
          )}
          {method === 'POINTS' && credential?.memberPoints != null && <div className="rounded-lg bg-amber-50 p-3 text-sm">Member points: <b>{credential.memberPoints}</b></div>}
          <Button variant="outline" onClick={addLine} disabled={remaining <= 0}>+ Add as split payment</Button>
        </div>
        <div className="space-y-2 rounded-xl bg-slate-50 p-4">
          <div className="flex justify-between text-sm"><span>Total</span><b>{thb(total)}</b></div>
          {lines.map((l, i) => (
            <div key={i} className="flex items-center justify-between rounded-lg bg-white px-2 py-1.5 text-sm">
              <Badge tone="brand">{l.method}</Badge><span className="tabular-nums">{thb(l.amount)}</span>
              <button onClick={() => setLines(lines.filter((_, j) => j !== i))} className="text-slate-400 hover:text-rose-600"><Trash2 className="h-4 w-4" /></button>
            </div>
          ))}
          <div className="flex justify-between border-t border-slate-200 pt-2 text-base"><span>Remaining</span><b className={remaining ? 'text-rose-600' : 'text-emerald-600'}>{thb(remaining)}</b></div>
        </div>
      </div>
    </Modal>
  );
}
