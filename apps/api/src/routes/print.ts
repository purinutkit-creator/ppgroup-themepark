import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { pool, one, query } from '../db/pool.js';
import { parse } from '../lib/http.js';
import { notFound, unprocessable } from '../lib/errors.js';
import { requireAnyPerm } from '../middleware/auth.js';
import { EscPos, sendToNetworkPrinter } from '../hardware/printer/escpos.js';
import { getSetting } from '../services/settings.js';
import { credentialPayloads } from '../services/credentials.js';
import { orderDetail } from '../services/orders.js';
import { audit } from '../services/audit.js';

const thb = (s: number) => (s / 100).toLocaleString('en-US', { minimumFractionDigits: 2 });

async function receiptDoc(orderId: string, branchId: string | null | undefined) {
  const o = await orderDetail(pool, orderId);
  const cfg = await getSetting('receipt', branchId);
  const park = await getSetting('park.info', branchId);
  return { kind: 'RECEIPT', paper: cfg.paper, header: cfg.header || park.name, taxId: cfg.taxId, footer: cfg.footer, logoUrl: park.logoUrl,
    orderNo: o.order_no, queueNo: o.queue_no, date: o.paid_at ?? o.created_at, staff: o.staff_name, store: o.store_name, items: o.items.map((i: any) => ({ name: i.name, qty: i.qty, total: i.total, modifiers: i.modifiers })),
    subtotal: o.subtotal, discount: o.discount_total, tax: o.tax_total, total: o.total, payments: o.payments.filter((p: any) => p.status === 'PAID').map((p: any) => ({ method: p.method, amount: p.amount, change: p.change_amount })),
    promotions: o.promotions, pointsEarned: o.points_earned, qr: cfg.showQr ? o.order_no : null };
}

function receiptEscPos(d: any): Buffer {
  const p = new EscPos(d.paper === '58MM' ? 32 : 48);
  p.align('center').bold().size(2, 2).line(d.header).size(1, 1).bold(false);
  if (d.taxId) p.line(`TAX ID ${d.taxId}`);
  p.line(new Date(d.date).toLocaleString('en-GB', { timeZone: 'Asia/Bangkok' })).line(d.orderNo);
  if (d.queueNo) p.bold().size(2, 2).line(`QUEUE ${d.queueNo}`).size(1, 1).bold(false);
  p.align('left').rule();
  for (const i of d.items) p.cols(`${i.qty} x ${i.name}`, thb(i.total));
  p.rule().cols('Subtotal', thb(d.subtotal));
  if (d.discount) p.cols('Discount', `-${thb(d.discount)}`);
  p.bold().cols('TOTAL', thb(d.total)).bold(false).cols('VAT incl.', thb(d.tax));
  for (const pay of d.payments) { p.cols(pay.method, thb(pay.amount)); if (pay.change) p.cols('Change', thb(pay.change)); }
  if (d.pointsEarned) p.cols('Points earned', String(d.pointsEarned));
  p.align('center');
  if (d.qr) p.qr(d.qr, 5);
  return p.line(d.footer).feed(3).cut().build();
}

async function wristbandDoc(credentialId: string, branchId: string | null | undefined) {
  const c = await one(pool, 'SELECT * FROM credentials WHERE id = $1', [credentialId]);
  if (!c) throw notFound('Credential');
  const t = await one(pool, `SELECT t.ticket_code, t.visit_date, t.valid_to, t.guest_name, p.name AS package_name, tt.name AS ticket_type
      FROM credential_links cl JOIN tickets t ON t.id = cl.ticket_id JOIN packages p ON p.id = t.package_id LEFT JOIN ticket_types tt ON tt.id = t.ticket_type_id
     WHERE cl.credential_id = $1 AND cl.unlinked_at IS NULL ORDER BY t.visit_date DESC LIMIT 1`, [credentialId]);
  const park = await getSetting('park.info', branchId);
  const wb = await getSetting('wristband', branchId);
  return { kind: 'WRISTBAND', template: wb.template, parkName: park.name, logoUrl: park.logoUrl, code: c.code, type: c.type, ticketType: t?.ticket_type ?? null,
    packageName: t?.package_name ?? null, visitDate: t?.visit_date ?? null, validTo: t?.valid_to ?? null, guestName: t?.guest_name ?? null, ...credentialPayloads(c) };
}

export async function printRoutes(app: FastifyInstance) {
  const perm = requireAnyPerm('pos.sell', 'ticket.sell', 'credential.issue', 'payment.accept');
  app.get('/api/print/receipt/:orderId', { preHandler: perm }, async (req) => {
    const d = await receiptDoc((req.params as any).orderId, req.actor.branchId);
    return { ...d, escpos: receiptEscPos(d).toString('base64') };
  });
  app.get('/api/print/wristband/:credentialId', { preHandler: perm }, async (req) => {
    const d = await wristbandDoc((req.params as any).credentialId, req.actor.branchId);
    await pool.query('UPDATE wristbands SET printed_at = now(), print_count = print_count + 1 WHERE credential_id = $1', [(req.params as any).credentialId]);
    return d;
  });
  app.get('/api/print/booking/:bookingId', { preHandler: perm }, async (req) => {
    const tickets = await query(pool, `SELECT t.id, t.ticket_code, t.visit_date, t.valid_to, t.guest_name, p.name AS package_name, tt.name AS ticket_type, c.token
        FROM tickets t JOIN packages p ON p.id = t.package_id LEFT JOIN ticket_types tt ON tt.id = t.ticket_type_id
        LEFT JOIN credentials c ON c.code = t.ticket_code AND c.type = 'QR_TICKET' WHERE t.booking_id = $1 ORDER BY t.ticket_code`, [(req.params as any).bookingId]);
    const park = await getSetting('park.info', req.actor.branchId);
    return { kind: 'TICKETS', parkName: park.name, logoUrl: park.logoUrl, tickets: tickets.map(({ token, ...t }: any) => ({ ...t, ...(token ? credentialPayloads({ token, type: 'QR_TICKET' }) : {}) })) };
  });
  /** Send to a LAN thermal printer (ESC/POS over TCP 9100). */
  app.post('/api/print/network', { preHandler: perm }, async (req) => {
    const b = parse(z.object({ kind: z.enum(['RECEIPT', 'WRISTBAND']), id: z.string().uuid(), host: z.string().optional(), port: z.number().int().optional() }), req.body);
    const cfg = await getSetting('printer', req.actor.branchId);
    const host = b.host ?? cfg.networkHost;
    if (!host) throw unprocessable('PRINTER_NOT_CONFIGURED', 'Network printer host not configured (Settings → Printer)');
    let data: Buffer;
    if (b.kind === 'RECEIPT') data = receiptEscPos(await receiptDoc(b.id, req.actor.branchId));
    else {
      const w = await wristbandDoc(b.id, req.actor.branchId);
      data = new EscPos(48).align('center').bold().line(w.parkName).size(2, 2).line(w.ticketType ?? w.type).size(1, 1).line(w.packageName ?? '').line(w.code).qr(w.qr, 6).barcode128(w.barcode).line(w.visitDate ?? '').feed(2).cut().build();
    }
    await sendToNetworkPrinter(host, b.port ?? cfg.networkPort, data);
    await audit(pool, req.actor, { action: 'PRINT', entityType: b.kind.toLowerCase(), entityId: b.id, metadata: { host } });
    return { ok: true };
  });
}
