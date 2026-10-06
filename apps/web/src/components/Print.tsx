import { createPortal } from 'react-dom';
import { useEffect, useState, type ReactNode } from 'react';
import { Barcode, QR } from './Codes';
import { fmtDate, fmtDateTime, thb } from '../lib/format';

/**
 * Browser printing (USB / Bluetooth printers installed in the OS, or "Save as PDF").
 * LAN thermal printers are driven server-side via ESC/POS (POST /api/print/network).
 */
let setContent: ((n: ReactNode) => void) | null = null;
export function PrintHost() {
  const [content, set] = useState<ReactNode>(null);
  useEffect(() => { setContent = set; return () => { setContent = null; }; }, []);
  return createPortal(<div id="print-root" className="pointer-events-none fixed -left-[9999px] top-0 bg-white text-black">{content}</div>, document.body);
}
export function printNode(node: ReactNode) {
  setContent?.(node);
  setTimeout(() => { window.print(); setTimeout(() => setContent?.(null), 500); }, 350);
}

export function ReceiptPrint({ d }: { d: any }) {
  const w = d.paper === '58MM' ? 'print-58' : d.paper === 'A4' ? 'print-a4' : 'print-80';
  return (
    <div className={`${w} p-3 font-mono text-[11px] leading-tight`} style={{ fontFamily: 'var(--font-receipt, monospace)' }}>
      <div className="text-center text-base font-bold">{d.header}</div>
      {d.taxId && <div className="text-center">TAX ID {d.taxId}</div>}
      <div className="text-center">{fmtDateTime(d.date)}</div>
      <div className="text-center">{d.orderNo}{d.store ? ` · ${d.store}` : ''}</div>
      {d.queueNo && <div className="my-1 text-center text-2xl font-bold">QUEUE {d.queueNo}</div>}
      <div className="my-1 border-t border-dashed border-black" />
      {d.items.map((i: any, idx: number) => (
        <div key={idx}>
          <div className="flex justify-between"><span>{i.qty} x {i.name}</span><span>{thb(i.total).replace('฿', '')}</span></div>
          {(i.modifiers ?? []).map((m: any, j: number) => <div key={j} className="pl-3 text-[10px]">- {m.option}</div>)}
        </div>
      ))}
      <div className="my-1 border-t border-dashed border-black" />
      <div className="flex justify-between"><span>Subtotal</span><span>{thb(d.subtotal)}</span></div>
      {d.discount > 0 && <div className="flex justify-between"><span>Discount</span><span>-{thb(d.discount)}</span></div>}
      <div className="flex justify-between text-sm font-bold"><span>TOTAL</span><span>{thb(d.total)}</span></div>
      <div className="flex justify-between"><span>VAT included</span><span>{thb(d.tax)}</span></div>
      {d.payments.map((p: any, i: number) => <div key={i} className="flex justify-between"><span>{p.method}</span><span>{thb(p.amount)}{p.change ? ` (change ${thb(p.change)})` : ''}</span></div>)}
      {d.pointsEarned > 0 && <div className="flex justify-between"><span>Points earned</span><span>{d.pointsEarned}</span></div>}
      {d.qr && <div className="mt-2 flex justify-center"><QR value={d.qr} size={90} /></div>}
      <div className="mt-2 text-center">{d.footer}</div>
    </div>
  );
}

export function WristbandPrint({ w }: { w: any }) {
  return (
    <div className="print-wristband flex items-center gap-4 overflow-hidden px-6" style={{ fontFamily: 'var(--font-ticket, sans-serif)' }}>
      <div className="w-40 shrink-0 text-sm font-bold leading-tight">{w.parkName}</div>
      <div className="shrink-0">
        <div className="text-lg font-black">{w.ticketType ?? w.type}</div>
        <div className="text-xs">{w.packageName}</div>
        <div className="font-mono text-xs">{w.code}</div>
      </div>
      <Barcode value={w.barcode} height={34} width={1.4} displayValue={false} />
      <QR value={w.qr} size={80} />
      <div className="text-xs font-bold">{w.visitDate ? fmtDate(w.visitDate) : ''}</div>
    </div>
  );
}

export function TicketsPrint({ d }: { d: any }) {
  return (
    <div className="print-a4 space-y-4 p-8" style={{ fontFamily: 'var(--font-ticket, sans-serif)' }}>
      {d.tickets.map((t: any) => (
        <div key={t.id} className="flex items-center justify-between rounded-xl border-2 border-black p-4" style={{ breakInside: 'avoid' }}>
          <div>
            <div className="text-lg font-bold">{d.parkName}</div>
            <div className="text-2xl font-black">{t.package_name}</div>
            <div>{t.ticket_type} · {t.guest_name ?? ''}</div>
            <div className="font-mono">{t.ticket_code}</div>
            <div>Visit {fmtDate(t.visit_date)}{t.valid_to !== t.visit_date ? ` – ${fmtDate(t.valid_to)}` : ''}</div>
            {t.barcode && <Barcode value={t.barcode} height={40} width={1.6} />}
            <div className="mt-1 text-[10px]">Ticket is valid only with server verification. Non-transferable. Terms apply.</div>
          </div>
          {t.qr && <QR value={t.qr} size={150} />}
        </div>
      ))}
    </div>
  );
}
