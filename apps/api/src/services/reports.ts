import { createRequire } from 'node:module';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import { query, type Db } from '../db/pool.js';
import { badRequest } from '../lib/errors.js';

export interface ReportColumn { key: string; label: string; type?: 'money' | 'number' | 'text' | 'datetime' | 'date' }
export interface Report { title: string; columns: ReportColumn[]; rows: any[]; totals?: Record<string, number> }

const range = `created_at >= ($2::date)::timestamp AT TIME ZONE 'Asia/Bangkok' AND created_at < (($3::date) + 1)::timestamp AT TIME ZONE 'Asia/Bangkok'`;
const rangeOf = (col: string) => range.replaceAll('created_at', col);

type Def = { title: string; columns: ReportColumn[]; sql: string; totals?: string[] };
const REPORTS: Record<string, Def> = {
  'daily-sales': {
    title: 'Daily Sales', totals: ['sales', 'topups', 'refunds', 'net'],
    columns: [{ key: 'day', label: 'Date', type: 'date' }, { key: 'sales', label: 'Sales', type: 'money' }, { key: 'topups', label: 'Top-ups', type: 'money' },
      { key: 'refunds', label: 'Refunds', type: 'money' }, { key: 'net', label: 'Net Collections', type: 'money' }, { key: 'count', label: 'Transactions', type: 'number' }],
    sql: `SELECT (created_at AT TIME ZONE 'Asia/Bangkok')::date AS day,
            SUM(amount) FILTER (WHERE type = 'SALE') AS sales, SUM(amount) FILTER (WHERE type = 'TOPUP') AS topups,
            SUM(amount) FILTER (WHERE type IN ('REFUND','VOID','WALLET_CASH_OUT')) AS refunds,
            SUM(CASE WHEN direction = 'IN' THEN amount WHEN direction = 'OUT' THEN -amount ELSE 0 END) AS net, COUNT(*)::int AS count
          FROM transactions WHERE branch_id = $1 AND ${range} GROUP BY 1 ORDER BY 1`,
  },
  'sales-by-method': {
    title: 'Sales by Payment Method', totals: ['amount'],
    columns: [{ key: 'method', label: 'Method' }, { key: 'type', label: 'Type' }, { key: 'count', label: 'Count', type: 'number' }, { key: 'amount', label: 'Amount', type: 'money' }],
    sql: `SELECT COALESCE(method, '-') AS method, type, COUNT(*)::int AS count, SUM(amount) AS amount FROM transactions WHERE branch_id = $1 AND ${range} GROUP BY 1, 2 ORDER BY 4 DESC`,
  },
  'ticket-sales': {
    title: 'Ticket Sales', totals: ['qty', 'amount'],
    columns: [{ key: 'package', label: 'Package' }, { key: 'ticket_type', label: 'Ticket Type' }, { key: 'channel', label: 'Channel' }, { key: 'qty', label: 'Qty', type: 'number' }, { key: 'amount', label: 'Amount', type: 'money' }],
    sql: `SELECT p.name AS package, COALESCE(tt.name, '-') AS ticket_type, o.channel, COUNT(*)::int AS qty, SUM(t.price - t.discount) AS amount
          FROM tickets t JOIN packages p ON p.id = t.package_id LEFT JOIN ticket_types tt ON tt.id = t.ticket_type_id JOIN orders o ON o.id = t.order_id
         WHERE t.branch_id = $1 AND t.status NOT IN ('UNPAID','CANCELLED') AND ${rangeOf('t.activated_at')} GROUP BY 1, 2, 3 ORDER BY 4 DESC`,
  },
  visitors: {
    title: 'Visitor Report', totals: ['entries', 'exits', 'visitors'],
    columns: [{ key: 'day', label: 'Date', type: 'date' }, { key: 'entries', label: 'Entries', type: 'number' }, { key: 'exits', label: 'Exits', type: 'number' }, { key: 'visitors', label: 'Unique Visitors', type: 'number' }],
    sql: `SELECT (entry_time AT TIME ZONE 'Asia/Bangkok')::date AS day, COUNT(*) FILTER (WHERE direction = 'IN')::int AS entries,
            COUNT(*) FILTER (WHERE direction = 'OUT')::int AS exits, COUNT(DISTINCT ticket_id) FILTER (WHERE direction = 'IN')::int AS visitors
          FROM entry_logs WHERE branch_id = $1 AND ${rangeOf('entry_time')} GROUP BY 1 ORDER BY 1`,
  },
  gates: {
    title: 'Gate Report', totals: ['scans', 'approved', 'denied', 'duplicate'],
    columns: [{ key: 'gate', label: 'Gate' }, { key: 'scans', label: 'Scans', type: 'number' }, { key: 'approved', label: 'Approved', type: 'number' }, { key: 'denied', label: 'Denied', type: 'number' },
      { key: 'duplicate', label: 'Duplicate', type: 'number' }, { key: 'manual', label: 'Manual', type: 'number' }],
    sql: `SELECT g.name AS gate, COUNT(s.id)::int AS scans, COUNT(s.id) FILTER (WHERE s.result IN ('APPROVED','AUTO_APPROVED'))::int AS approved,
            COUNT(s.id) FILTER (WHERE s.result = 'DENIED')::int AS denied, COUNT(s.id) FILTER (WHERE s.is_duplicate)::int AS duplicate,
            COUNT(s.id) FILTER (WHERE s.decision_mode IN ('MANUAL','OVERRIDE'))::int AS manual
          FROM gates g LEFT JOIN gate_scans s ON s.gate_id = g.id AND ${rangeOf('s.scanned_at')} WHERE g.branch_id = $1 GROUP BY g.id ORDER BY g.number`,
  },
  'entry-log': {
    title: 'Entry Log',
    columns: [{ key: 'scanned_at', label: 'Scan Time', type: 'datetime' }, { key: 'gate', label: 'Gate' }, { key: 'credential', label: 'Credential' }, { key: 'ticket', label: 'Ticket' },
      { key: 'member', label: 'Member' }, { key: 'result', label: 'Result' }, { key: 'reason', label: 'Reason' }, { key: 'operator', label: 'Operator' }, { key: 'decided_at', label: 'Approval Time', type: 'datetime' }],
    sql: `SELECT s.scanned_at, g.name AS gate, c.code AS credential, t.ticket_code AS ticket, m.member_code AS member, s.result, s.reason, st.first_name AS operator, s.decided_at
          FROM gate_scans s JOIN gates g ON g.id = s.gate_id LEFT JOIN credentials c ON c.id = s.credential_id LEFT JOIN tickets t ON t.id = s.ticket_id
          LEFT JOIN members m ON m.id = s.member_id LEFT JOIN staff st ON st.id = s.operator_staff_id
         WHERE s.branch_id = $1 AND ${rangeOf('s.scanned_at')} ORDER BY s.scanned_at DESC LIMIT 5000`,
  },
  rides: {
    title: 'Ride Report', totals: ['granted', 'denied', 'addon_sales'],
    columns: [{ key: 'ride', label: 'Ride' }, { key: 'granted', label: 'Rides', type: 'number' }, { key: 'denied', label: 'Denied', type: 'number' }, { key: 'not_included', label: 'Not Included', type: 'number' },
      { key: 'addon_sales', label: 'Add-on Sales', type: 'money' }],
    sql: `SELECT r.name AS ride, COUNT(l.id) FILTER (WHERE l.result = 'GRANTED')::int AS granted, COUNT(l.id) FILTER (WHERE l.result = 'DENIED')::int AS denied,
            COUNT(l.id) FILTER (WHERE l.result = 'NOT_INCLUDED')::int AS not_included,
            (SELECT COALESCE(SUM(oi.total), 0) FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE oi.ride_id = r.id AND o.status IN ('PAID','PARTIALLY_REFUNDED') AND ${rangeOf('o.paid_at')}) AS addon_sales
          FROM rides r LEFT JOIN ride_access_logs l ON l.ride_id = r.id AND ${rangeOf('l.scanned_at')} WHERE r.branch_id = $1 GROUP BY r.id ORDER BY granted DESC`,
  },
  queue: {
    title: 'Queue Report',
    columns: [{ key: 'ride', label: 'Ride' }, { key: 'joined', label: 'Joined', type: 'number' }, { key: 'boarded', label: 'Boarded', type: 'number' }, { key: 'no_show', label: 'No-show', type: 'number' },
      { key: 'avg_wait_min', label: 'Avg Wait (min)', type: 'number' }],
    sql: `SELECT r.name AS ride, COUNT(q.id)::int AS joined, COUNT(q.id) FILTER (WHERE q.status = 'BOARDED')::int AS boarded, COUNT(q.id) FILTER (WHERE q.status = 'NO_SHOW')::int AS no_show,
            ROUND(AVG(EXTRACT(EPOCH FROM (COALESCE(q.called_at, q.boarded_at) - q.joined_at)) / 60)::numeric, 1) AS avg_wait_min
          FROM rides r LEFT JOIN ride_queues q ON q.ride_id = r.id AND ${rangeOf('q.joined_at')} WHERE r.branch_id = $1 GROUP BY r.id ORDER BY joined DESC`,
  },
  'food-sales': {
    title: 'Food Sales', totals: ['qty', 'amount'],
    columns: [{ key: 'store', label: 'Store' }, { key: 'product', label: 'Product' }, { key: 'qty', label: 'Qty', type: 'number' }, { key: 'amount', label: 'Amount', type: 'money' }],
    sql: `SELECT s.name AS store, oi.name AS product, SUM(oi.qty - oi.refunded_qty)::int AS qty, SUM(oi.total) AS amount
          FROM order_items oi JOIN orders o ON o.id = oi.order_id JOIN stores s ON s.id = o.store_id LEFT JOIN products p ON p.id = oi.product_id LEFT JOIN categories c ON c.id = p.category_id
         WHERE o.branch_id = $1 AND o.status IN ('PAID','PARTIALLY_REFUNDED') AND c.type IN ('FOOD','DRINK') AND ${rangeOf('o.paid_at')} GROUP BY 1, 2 ORDER BY 4 DESC`,
  },
  'retail-sales': {
    title: 'Retail Sales', totals: ['qty', 'amount', 'margin'],
    columns: [{ key: 'store', label: 'Store' }, { key: 'sku', label: 'SKU' }, { key: 'product', label: 'Product' }, { key: 'qty', label: 'Qty', type: 'number' }, { key: 'amount', label: 'Amount', type: 'money' }, { key: 'margin', label: 'Gross Margin', type: 'money' }],
    sql: `SELECT s.name AS store, p.sku, oi.name AS product, SUM(oi.qty - oi.refunded_qty)::int AS qty, SUM(oi.total) AS amount, SUM(oi.total - p.cost * (oi.qty - oi.refunded_qty)) AS margin
          FROM order_items oi JOIN orders o ON o.id = oi.order_id JOIN stores s ON s.id = o.store_id JOIN products p ON p.id = oi.product_id JOIN categories c ON c.id = p.category_id
         WHERE o.branch_id = $1 AND o.status IN ('PAID','PARTIALLY_REFUNDED') AND c.type IN ('SOUVENIR','MERCHANDISE','PHOTO') AND ${rangeOf('o.paid_at')} GROUP BY 1, 2, 3 ORDER BY 5 DESC`,
  },
  wallet: {
    title: 'Wallet Movements', totals: ['credit', 'debit'],
    columns: [{ key: 'type', label: 'Type' }, { key: 'count', label: 'Count', type: 'number' }, { key: 'credit', label: 'Credit', type: 'money' }, { key: 'debit', label: 'Debit', type: 'money' }],
    sql: `SELECT type, COUNT(*)::int AS count, SUM(credit) AS credit, SUM(debit) AS debit FROM wallet_ledger WHERE (branch_id = $1 OR branch_id IS NULL) AND ${range} GROUP BY 1 ORDER BY 1`,
  },
  topup: {
    title: 'Top-up Report', totals: ['amount'],
    columns: [{ key: 'created_at', label: 'Time', type: 'datetime' }, { key: 'txn_no', label: 'Txn' }, { key: 'method', label: 'Method' }, { key: 'credential', label: 'Card' }, { key: 'staff', label: 'Staff' }, { key: 'amount', label: 'Amount', type: 'money' }],
    sql: `SELECT t.created_at, t.txn_no, t.method, c.code AS credential, st.first_name AS staff, t.amount FROM transactions t LEFT JOIN credentials c ON c.id = t.credential_id
          LEFT JOIN staff st ON st.id = t.staff_id WHERE t.branch_id = $1 AND t.type = 'TOPUP' AND ${rangeOf('t.created_at')} ORDER BY t.created_at DESC`,
  },
  refunds: {
    title: 'Refund Report', totals: ['amount'],
    columns: [{ key: 'created_at', label: 'Time', type: 'datetime' }, { key: 'refund_no', label: 'Refund' }, { key: 'order_no', label: 'Order' }, { key: 'type', label: 'Type' }, { key: 'method', label: 'Method' },
      { key: 'reason', label: 'Reason' }, { key: 'staff', label: 'Staff' }, { key: 'amount', label: 'Amount', type: 'money' }],
    sql: `SELECT r.created_at, r.refund_no, o.order_no, r.type, r.method, r.reason, st.first_name AS staff, r.amount FROM refunds r JOIN orders o ON o.id = r.order_id
          LEFT JOIN staff st ON st.id = r.staff_id WHERE o.branch_id = $1 AND ${rangeOf('r.created_at')} ORDER BY r.created_at DESC`,
  },
  promotions: {
    title: 'Promotion Report', totals: ['uses', 'discount'],
    columns: [{ key: 'promotion', label: 'Promotion' }, { key: 'uses', label: 'Uses', type: 'number' }, { key: 'discount', label: 'Discount Given', type: 'money' }],
    sql: `SELECT p.name AS promotion, COUNT(u.id)::int AS uses, COALESCE(SUM(u.discount), 0) AS discount FROM promotions p LEFT JOIN promotion_usages u ON u.promotion_id = p.id AND ${rangeOf('u.created_at')}
          WHERE p.branch_id = $1 OR p.branch_id IS NULL GROUP BY p.id ORDER BY discount DESC`,
  },
  members: {
    title: 'Member Report',
    columns: [{ key: 'tier', label: 'Tier' }, { key: 'members', label: 'Members', type: 'number' }, { key: 'new_members', label: 'New in period', type: 'number' }, { key: 'points', label: 'Points Outstanding', type: 'number' }, { key: 'spend', label: 'Total Spend', type: 'money' }],
    sql: `SELECT COALESCE(t.name, 'Basic') AS tier, COUNT(m.id)::int AS members, COUNT(m.id) FILTER (WHERE ${rangeOf('m.created_at')})::int AS new_members,
            SUM(m.points)::int AS points, SUM(m.total_spend) AS spend FROM members m LEFT JOIN member_tiers t ON t.id = m.tier_id
          WHERE m.home_branch_id = $1 OR m.home_branch_id IS NULL GROUP BY 1 ORDER BY 2 DESC`,
  },
  staff: {
    title: 'Staff Sales', totals: ['amount'],
    columns: [{ key: 'staff', label: 'Staff' }, { key: 'role', label: 'Role' }, { key: 'count', label: 'Transactions', type: 'number' }, { key: 'amount', label: 'Amount', type: 'money' }],
    sql: `SELECT st.employee_code || ' ' || st.first_name AS staff, r.name AS role, COUNT(t.id)::int AS count, SUM(t.amount) AS amount
          FROM transactions t JOIN staff st ON st.id = t.staff_id JOIN roles r ON r.id = st.role_id
         WHERE t.branch_id = $1 AND t.type IN ('SALE','TOPUP') AND ${rangeOf('t.created_at')} GROUP BY 1, 2 ORDER BY 4 DESC`,
  },
  shifts: {
    title: 'Shift Report', totals: ['expected_cash', 'actual_cash', 'over_short'],
    columns: [{ key: 'shift_no', label: 'Shift' }, { key: 'staff', label: 'Staff' }, { key: 'opened_at', label: 'Opened', type: 'datetime' }, { key: 'closed_at', label: 'Closed', type: 'datetime' },
      { key: 'opening_cash', label: 'Opening', type: 'money' }, { key: 'expected_cash', label: 'Expected', type: 'money' }, { key: 'actual_cash', label: 'Actual', type: 'money' }, { key: 'over_short', label: 'Over/Short', type: 'money' }],
    sql: `SELECT s.shift_no, st.first_name AS staff, s.opened_at, s.closed_at, s.opening_cash, s.expected_cash, s.actual_cash, s.over_short
          FROM shifts s JOIN staff st ON st.id = s.staff_id WHERE s.branch_id = $1 AND ${rangeOf('s.opened_at')} ORDER BY s.opened_at DESC`,
  },
  stock: {
    title: 'Stock Movements',
    columns: [{ key: 'created_at', label: 'Time', type: 'datetime' }, { key: 'store', label: 'Store' }, { key: 'sku', label: 'SKU' }, { key: 'product', label: 'Product' }, { key: 'type', label: 'Type' },
      { key: 'qty', label: 'Qty', type: 'number' }, { key: 'qty_after', label: 'After', type: 'number' }, { key: 'reason', label: 'Reason' }],
    sql: `SELECT m.created_at, s.name AS store, p.sku, p.name AS product, m.type, m.qty, m.qty_after, m.reason FROM stock_movements m JOIN stores s ON s.id = m.store_id JOIN products p ON p.id = m.product_id
         WHERE s.branch_id = $1 AND ${rangeOf('m.created_at')} ORDER BY m.created_at DESC LIMIT 5000`,
  },
  transactions: {
    title: 'Transactions', totals: ['amount'],
    columns: [{ key: 'created_at', label: 'Time', type: 'datetime' }, { key: 'txn_no', label: 'Txn' }, { key: 'type', label: 'Type' }, { key: 'category', label: 'Category' }, { key: 'method', label: 'Method' },
      { key: 'direction', label: 'Dir' }, { key: 'reference', label: 'Reference' }, { key: 'staff', label: 'Staff' }, { key: 'amount', label: 'Amount', type: 'money' }],
    sql: `SELECT t.created_at, t.txn_no, t.type, t.category, t.method, t.direction, t.reference, st.first_name AS staff, t.amount FROM transactions t LEFT JOIN staff st ON st.id = t.staff_id
         WHERE t.branch_id = $1 AND ${rangeOf('t.created_at')} ORDER BY t.created_at DESC LIMIT 10000`,
  },
};

export const REPORT_LIST = Object.entries(REPORTS).map(([key, r]) => ({ key, title: r.title }));

export async function runReport(db: Db, key: string, branchId: string, from: string, to: string): Promise<Report> {
  const def = REPORTS[key];
  if (!def) throw badRequest('UNKNOWN_REPORT', `Unknown report ${key}`);
  const rows = await query(db, def.sql, [branchId, from, to]);
  const totals = def.totals ? Object.fromEntries(def.totals.map((k) => [k, rows.reduce((s, r) => s + Number(r[k] ?? 0), 0)])) : undefined;
  return { title: def.title, columns: def.columns, rows, totals };
}

function fmt(v: any, type?: ReportColumn['type']) {
  if (v === null || v === undefined) return '';
  if (type === 'money') return (Number(v) / 100).toFixed(2);
  if (type === 'datetime') return new Date(v).toLocaleString('en-GB', { timeZone: 'Asia/Bangkok' });
  return String(v);
}

export function toCsv(r: Report): string {
  const esc = (s: string) => (/[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s);
  const lines = [r.columns.map((c) => esc(c.label)).join(',')];
  for (const row of r.rows) lines.push(r.columns.map((c) => esc(fmt(row[c.key], c.type))).join(','));
  if (r.totals) lines.push(r.columns.map((c, i) => (i === 0 ? 'TOTAL' : c.key in r.totals! ? fmt(r.totals![c.key], c.type) : '')).join(','));
  return '﻿' + lines.join('\n');
}

export async function toXlsx(r: Report): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(r.title.slice(0, 30));
  ws.columns = r.columns.map((c) => ({ header: c.label, key: c.key, width: Math.max(12, c.label.length + 4), style: c.type === 'money' ? { numFmt: '#,##0.00' } : {} }));
  for (const row of r.rows) ws.addRow(Object.fromEntries(r.columns.map((c) => [c.key, c.type === 'money' ? Number(row[c.key] ?? 0) / 100 : c.type === 'datetime' && row[c.key] ? new Date(row[c.key]) : row[c.key]])));
  if (r.totals) ws.addRow(Object.fromEntries(r.columns.map((c, i) => [c.key, i === 0 ? 'TOTAL' : c.key in r.totals! ? (c.type === 'money' ? r.totals![c.key] / 100 : r.totals![c.key]) : null])));
  ws.getRow(1).font = { bold: true };
  return Buffer.from(await wb.xlsx.writeBuffer());
}

const require = createRequire(import.meta.url);
function thaiFontPath(): string | null {
  try { return require.resolve('@fontsource/sarabun/files/sarabun-thai-400-normal.woff'); } catch { return null; }
}
const THAI_RE = /([\u0E00-\u0E7F]+)/;

export function toPdf(r: Report, meta: { branch: string; from: string; to: string }): Promise<Buffer> {
  return new Promise((resolve) => {
    const doc = new PDFDocument({ size: 'A4', layout: r.columns.length > 6 ? 'landscape' : 'portrait', margin: 32 });
    const thai = thaiFontPath();
    if (thai) doc.registerFont('Thai', thai);
    const chunks: Buffer[] = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    /** Mixed Thai / Latin text: switch fonts per script run (PDF fonts have no fallback). */
    const write = (text: string, x: number | undefined, y: number | undefined, opts: PDFKit.Mixins.TextOptions, bold = false, size = 8) => {
      const runs = text.split(THAI_RE).filter(Boolean);
      if (!runs.length) runs.push(' ');
      runs.forEach((run, i) => {
        doc.font(thai && THAI_RE.test(run) ? 'Thai' : bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(size);
        const o = { ...opts, continued: i < runs.length - 1 };
        if (i === 0 && x !== undefined) doc.text(run, x, y, o); else doc.text(run, o);
      });
    };
    write(r.title, 32, 32, {}, true, 16);
    doc.fillColor('#555');
    write(`${meta.branch}  |  ${meta.from} - ${meta.to}  |  generated ${new Date().toISOString()}`, 32, doc.y + 4, {}, false, 9);
    doc.moveDown();
    const width = doc.page.width - 64;
    const colW = width / r.columns.length;
    const maxChars = Math.max(4, Math.floor(colW / 4.2));
    const drawRow = (vals: string[], bold = false) => {
      if (doc.y > doc.page.height - 60) doc.addPage();
      const yy = doc.y;
      vals.forEach((v, i) => {
        doc.fillColor('#111');
        const cell = v.length > maxChars ? `${v.slice(0, maxChars - 1)}…` : v;
        write(cell, 32 + i * colW, yy, { width: colW - 4, lineBreak: false }, bold);
      });
      doc.x = 32;
      doc.y = yy + 13;
    };
    drawRow(r.columns.map((c) => c.label), true);
    for (const row of r.rows) drawRow(r.columns.map((c) => fmt(row[c.key], c.type)));
    if (r.totals) drawRow(r.columns.map((c, i) => (i === 0 ? 'TOTAL' : c.key in r.totals! ? fmt(r.totals![c.key], c.type) : '')), true);
    doc.end();
  });
}
