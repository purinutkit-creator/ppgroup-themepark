import { pool, one, query, withTx, type Db } from '../db/pool.js';
import { AppError, conflict, notFound, unprocessable } from '../lib/errors.js';
import { businessDate, businessTime } from '../lib/codes.js';
import { sha256 } from '../lib/crypto.js';
import { publish, rooms } from '../realtime/hub.js';
import type { Actor } from '../middleware/auth.js';
import { createGateController, type GateController, type GateHwEvent } from '../hardware/gate/index.js';
import { audit, SYSTEM_ACTOR } from './audit.js';
import { getSetting } from './settings.js';
import { notify } from './notify.js';
import { consumeApproval } from './approvals.js';
import { resolveScan, ScanError, STATUS_MESSAGES } from './credentials.js';
import { ticketsForCredential, dateCheck, timeCheck, type TicketRow } from './tickets.js';

// ---------------------------------------------------------------------
// State machine
// ---------------------------------------------------------------------
export type GateState = 'IDLE' | 'SCANNING' | 'VALIDATING' | 'WAITING_APPROVAL' | 'APPROVED' | 'OPENING' | 'OPEN' | 'CLOSING' | 'DENIED' | 'ERROR' | 'OFFLINE' | 'EMERGENCY';

const TRANSITIONS: Record<GateState, GateState[]> = {
  IDLE: ['SCANNING', 'VALIDATING', 'WAITING_APPROVAL', 'APPROVED', 'DENIED', 'OPENING'],
  SCANNING: ['VALIDATING', 'IDLE', 'WAITING_APPROVAL', 'APPROVED', 'DENIED'],
  VALIDATING: ['WAITING_APPROVAL', 'APPROVED', 'DENIED', 'IDLE'],
  WAITING_APPROVAL: ['APPROVED', 'DENIED', 'IDLE'],
  APPROVED: ['OPENING', 'IDLE'],
  OPENING: ['OPEN', 'CLOSING', 'IDLE'],
  OPEN: ['CLOSING', 'IDLE'],
  CLOSING: ['IDLE'],
  DENIED: ['IDLE', 'SCANNING', 'VALIDATING', 'WAITING_APPROVAL', 'APPROVED', 'DENIED', 'OPENING'],
  ERROR: ['IDLE'],
  OFFLINE: ['IDLE'],
  EMERGENCY: ['IDLE'],
};
const UNIVERSAL: GateState[] = ['ERROR', 'OFFLINE', 'EMERGENCY'];
/** States in which a new scan may be accepted (scanner lock otherwise). */
const SCANNABLE: GateState[] = ['IDLE', 'DENIED', 'SCANNING'];

export function canTransition(from: GateState, to: GateState) {
  return UNIVERSAL.includes(to) || TRANSITIONS[from]?.includes(to);
}

async function setState(db: Db, gate: { id: string; branch_id: string; state: GateState }, to: GateState, extra: { currentScanId?: string | null } = {}) {
  if (gate.state === to) return;
  if (!canTransition(gate.state, to)) throw conflict('INVALID_GATE_TRANSITION', `Gate cannot go ${gate.state} → ${to}`);
  await db.query(`UPDATE gates SET state = $2, state_changed_at = now(), current_scan_id = CASE WHEN $3::boolean THEN $4::uuid ELSE current_scan_id END WHERE id = $1`,
    [gate.id, to, extra.currentScanId !== undefined, extra.currentScanId ?? null]);
  const from = gate.state;
  gate.state = to;
  publish([rooms.gates(gate.branch_id), rooms.gate(gate.id)], 'gate.state', { gateId: gate.id, state: to, from });
}

/** Apply a transition outside a business transaction (hardware callbacks / timers). */
async function moveGate(gateId: string, to: GateState, expectFrom?: GateState[]) {
  return withTx(async (tx) => {
    const g = await one(tx, 'SELECT id, branch_id, state FROM gates WHERE id = $1 FOR UPDATE', [gateId]);
    if (!g) return null;
    if (expectFrom && !expectFrom.includes(g.state)) return g;
    if (!canTransition(g.state, to)) return g;
    await setState(tx, g, to, to === 'IDLE' ? { currentScanId: null } : {});
    return g;
  });
}

// ---------------------------------------------------------------------
// Hardware runtime (controller instances + timers per gate)
// ---------------------------------------------------------------------
interface Runtime { controller: GateController; signature: string; resetTimer?: NodeJS.Timeout; approvalTimer?: NodeJS.Timeout; pendingEntryLogId?: string | null; passageSeen?: boolean }
const runtimes = new Map<string, Runtime>();

function runtimeFor(gate: any): Runtime {
  const signature = `${gate.controller_type}:${JSON.stringify(gate.controller_config ?? {})}`;
  let rt = runtimes.get(gate.id);
  if (rt && rt.signature === signature) return rt;
  rt?.controller.dispose();
  const controller = createGateController(gate.controller_type, gate.controller_config ?? {});
  rt = { controller, signature };
  const runtime = rt;
  controller.onEvent((e) => { handleHardwareEvent(gate.id, e).catch((err) => console.error('gate hw event failed', err)); void runtime; });
  runtimes.set(gate.id, rt);
  return rt;
}

function displayPublish(gate: { id: string }, payload: Record<string, unknown>) {
  publish([rooms.gate(gate.id)], 'gate.display', payload);
}

function scheduleReset(gateId: string, ms: number) {
  const rt = runtimes.get(gateId);
  if (rt?.resetTimer) clearTimeout(rt.resetTimer);
  const timer = setTimeout(async () => {
    const g = await moveGate(gateId, 'IDLE', ['DENIED']);
    if (g) displayPublish({ id: gateId }, { mode: 'WAITING' });
  }, ms);
  if (rt) rt.resetTimer = timer;
}

// ---------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------
export interface Check { code: string; label: string; ok: boolean; detail?: string; warn?: boolean }

export const REASON_TEXT: Record<string, { th: string; en: string }> = {
  NOT_FOUND: { th: 'ไม่พบตั๋วในระบบ', en: 'Ticket not found' },
  NO_TICKET: { th: 'ไม่พบตั๋วที่ใช้ได้', en: 'No valid ticket' },
  FORGED_QR: { th: 'QR ไม่ถูกต้อง', en: 'Invalid ticket' },
  QR_EXPIRED: { th: 'QR หมดอายุ กรุณาเปิดใหม่', en: 'QR expired — refresh' },
  MALFORMED: { th: 'อ่าน QR ไม่ได้', en: 'Invalid ticket' },
  UNPAID: { th: 'ยังไม่ได้ชำระเงิน', en: 'Payment pending' },
  EXPIRED: { th: 'ตั๋วหมดอายุ', en: 'Ticket Expired' },
  WRONG_DATE: { th: 'ไม่ใช่วันที่ใช้งาน', en: 'Wrong Date' },
  WRONG_DAY: { th: 'ไม่สามารถใช้ในวันนี้', en: 'Wrong Date' },
  DAYS_EXHAUSTED: { th: 'ใช้ครบจำนวนวันแล้ว', en: 'All days used' },
  ALREADY_USED: { th: 'ตั๋วถูกใช้แล้ว', en: 'Ticket Already Used' },
  DUPLICATE_ENTRY: { th: 'ตั๋วนี้ถูกใช้เข้าสวนสนุกแล้ว', en: 'Already inside — duplicate entry' },
  WRONG_BRANCH: { th: 'ตั๋วไม่ใช่ของสาขานี้', en: 'Wrong Branch' },
  INVALID_STATUS: { th: 'ตั๋วไม่สามารถใช้งานได้', en: 'Invalid Ticket' },
  OUTSIDE_TIME: { th: 'ไม่อยู่ในช่วงเวลาที่ใช้ได้', en: 'Outside valid time' },
  ZONE_DENIED: { th: 'ตั๋วไม่รวมโซนนี้', en: 'Zone not included' },
  CAPACITY_FULL: { th: 'สวนสนุกเต็มความจุ', en: 'Park at capacity' },
  ENTRY_BLOCKED: { th: 'ปิดรับเข้าชั่วคราว', en: 'Entry temporarily closed' },
  SCAN_IN_PROGRESS: { th: 'ตั๋วกำลังถูกตรวจที่ประตูอื่น', en: 'Ticket being processed at another gate' },
  OPERATOR_DENIED: { th: 'เจ้าหน้าที่ไม่อนุมัติ', en: 'Denied by operator' },
  APPROVAL_TIMEOUT: { th: 'หมดเวลารออนุมัติ', en: 'Approval timeout' },
  BLACKLISTED: { th: 'บัตรถูกระงับ', en: 'Blocked credential' },
  ENTRY_LIMIT: { th: 'เข้าครบจำนวนครั้งที่กำหนดแล้ว', en: 'Entry limit reached' },
  NOT_INSIDE: { th: 'ไม่พบประวัติการเข้า', en: 'No entry record' },
};

function reasonOf(code: string) {
  if (code.startsWith('CREDENTIAL_')) {
    const st = code.replace('CREDENTIAL_', '');
    return { th: STATUS_MESSAGES[st]?.split(' (')[0] ?? 'บัตรใช้งานไม่ได้', en: `Card ${st.toLowerCase()}` };
  }
  return REASON_TEXT[code] ?? { th: code, en: code };
}

interface Evaluation { ok: boolean; checks: Check[]; reasonCode?: string; ticket?: TicketRow; duplicateOf?: any }

async function evaluateEntry(tx: Db, gate: any, cred: any, direction: 'IN' | 'OUT', date: string, opts: { override?: boolean } = {}): Promise<Evaluation> {
  const gcfg = await getSetting('gate', gate.branch_id, tx);
  const checks: Check[] = [];
  const tickets = await ticketsForCredential(tx, cred, date, { lock: true, memberCardEntry: gcfg.memberCardEntry });
  const branchTickets = tickets.filter((t) => t.branch_id === gate.branch_id);

  if (direction === 'OUT') {
    const inside = branchTickets.find((t) => t.presence === 'INSIDE');
    checks.push({ code: 'TICKET_FOUND', label: 'Ticket Found', ok: tickets.length > 0 });
    checks.push({ code: 'INSIDE', label: 'Inside Park', ok: !!inside, warn: !inside });
    return { ok: true, checks, ticket: inside, reasonCode: inside ? undefined : 'NOT_INSIDE' };
  }

  checks.push({ code: 'TICKET_FOUND', label: 'Ticket Found', ok: tickets.length > 0 });
  if (!tickets.length) return { ok: false, checks, reasonCode: 'NO_TICKET' };
  checks.push({ code: 'CORRECT_BRANCH', label: 'Correct Branch', ok: branchTickets.length > 0 });
  if (!branchTickets.length) return { ok: false, checks, reasonCode: 'WRONG_BRANCH', ticket: tickets[0] };

  // choose the best candidate: valid today, paid, outside first
  const usable = branchTickets.filter((t) => ['ACTIVE', 'PAID'].includes(t.status) && dateCheck(t, date).ok);
  const outside = usable.find((t) => t.presence === 'OUTSIDE');
  const candidate = outside ?? usable[0] ?? branchTickets[0];

  checks.push({ code: 'PAYMENT', label: 'Payment', ok: candidate.status !== 'UNPAID' });
  if (candidate.status === 'UNPAID') return { ok: false, checks, reasonCode: 'UNPAID', ticket: candidate };

  const statusOk = ['ACTIVE', 'PAID'].includes(candidate.status);
  checks.push({ code: 'ACTIVE', label: 'Active', ok: statusOk, detail: candidate.status });
  if (!statusOk) return { ok: false, checks, reasonCode: candidate.status === 'EXPIRED' || candidate.status === 'USED' ? (candidate.status === 'USED' ? 'ALREADY_USED' : 'EXPIRED') : 'INVALID_STATUS', ticket: candidate };

  const dc = dateCheck(candidate, date);
  checks.push({ code: 'CORRECT_DATE', label: 'Correct Date', ok: dc.ok, detail: dc.detail });
  if (!dc.ok) return { ok: false, checks, reasonCode: dc.code, ticket: candidate };

  const tc = timeCheck(candidate, businessTime());
  checks.push({ code: 'VALID_TIME', label: 'Valid Time', ok: tc.ok, detail: tc.detail });
  if (!tc.ok && !opts.override) return { ok: false, checks, reasonCode: 'OUTSIDE_TIME', ticket: candidate };

  if (gate.zone_id && candidate.zone_access === 'SELECT') {
    const z = await one(tx, 'SELECT 1 FROM package_zones WHERE package_id = $1 AND zone_id = $2', [candidate.package_id, gate.zone_id]);
    checks.push({ code: 'ZONE', label: 'Zone Access', ok: !!z });
    if (!z) return { ok: false, checks, reasonCode: 'ZONE_DENIED', ticket: candidate };
  }

  // anti-passback / duplicate
  if (candidate.presence === 'INSIDE' && gcfg.antiPassback) {
    checks.push({ code: 'NOT_USED', label: 'Not Inside (Anti-passback)', ok: !!opts.override, detail: 'Ticket state = INSIDE' });
    if (!opts.override) {
      const first = await one(tx, `SELECT e.entry_time, g.name AS gate_name, g.code AS gate_code FROM entry_logs e JOIN gates g ON g.id = e.gate_id
          WHERE e.ticket_id = $1 AND e.direction = 'IN' ORDER BY e.entry_time DESC LIMIT 1`, [candidate.id]);
      return { ok: false, checks, reasonCode: 'DUPLICATE_ENTRY', ticket: candidate, duplicateOf: first };
    }
  } else {
    const enteredToday = (candidate.entries_today ?? 0) > 0;
    const reentryOk = !enteredToday || candidate.reentry_allowed;
    checks.push({ code: 'NOT_USED', label: enteredToday ? 'Re-entry Allowed' : 'Not Used', ok: reentryOk || !!opts.override });
    if (!reentryOk && !opts.override) {
      const first = await one(tx, `SELECT e.entry_time, g.name AS gate_name FROM entry_logs e JOIN gates g ON g.id = e.gate_id WHERE e.ticket_id = $1 AND e.direction = 'IN' ORDER BY e.entry_time LIMIT 1`, [candidate.id]);
      return { ok: false, checks, reasonCode: 'ALREADY_USED', ticket: candidate, duplicateOf: first };
    }
    if (candidate.entries_per_day && (candidate.entries_today ?? 0) >= candidate.entries_per_day && !opts.override) {
      checks.push({ code: 'ENTRY_LIMIT', label: 'Entry Limit', ok: false, detail: `${candidate.entries_per_day}/day` });
      return { ok: false, checks, reasonCode: 'ENTRY_LIMIT', ticket: candidate };
    }
  }

  // pending decision for this ticket on another gate (simultaneous scan protection)
  const pending = await one(tx, `SELECT s.id, g.name FROM gate_scans s JOIN gates g ON g.id = s.gate_id WHERE s.ticket_id = $1 AND s.result = 'PENDING'`, [candidate.id]);
  if (pending) {
    checks.push({ code: 'NO_PARALLEL', label: 'Not in use at another gate', ok: false, detail: pending.name });
    return { ok: false, checks, reasonCode: 'SCAN_IN_PROGRESS', ticket: candidate };
  }

  // capacity / policy
  const cap = await getSetting('capacity', gate.branch_id, tx);
  if (cap.blockEntryWhenFull && !opts.override) {
    const occ = await occupancy(tx, gate.branch_id);
    const full = occ.inside >= occ.capacity;
    checks.push({ code: 'CAPACITY', label: 'Park Capacity', ok: !full, detail: `${occ.inside}/${occ.capacity}` });
    if (full) return { ok: false, checks, reasonCode: 'CAPACITY_FULL', ticket: candidate };
  }
  if (gate.block_new_entry && !opts.override) {
    checks.push({ code: 'ENTRY_OPEN', label: 'Gate accepting entry', ok: false });
    return { ok: false, checks, reasonCode: 'ENTRY_BLOCKED', ticket: candidate };
  }
  return { ok: true, checks, ticket: candidate };
}

// ---------------------------------------------------------------------
// Scan → decision
// ---------------------------------------------------------------------
async function loadGateForUpdate(tx: Db, gateId: string) {
  const g = await one(tx, 'SELECT * FROM gates WHERE id = $1 FOR UPDATE', [gateId]);
  if (!g) throw notFound('Gate');
  return g;
}

function customerInfo(cred: any, ticket?: any, member?: any) {
  return {
    customer: member ? `${member.first_name} ${member.last_name}`.trim() : ticket?.guest_name ?? null,
    memberCode: member?.member_code ?? null,
    ticketCode: ticket?.ticket_code ?? null,
    ticketType: ticket ? [ticket.package_name, ticket.ticket_type_name].filter(Boolean).join(' — ') : null,
    visitDate: ticket?.visit_date ?? null,
    ticketStatus: ticket ? (ticket.presence === 'INSIDE' ? 'INSIDE' : ticket.status) : null,
    credentialCode: cred?.code ?? null,
    credentialType: cred?.type ?? null,
  };
}

export async function scanAtGate(actor: Actor, gateId: string, raw: string) {
  const startedAt = Date.now();
  const pre = await one(pool, 'SELECT id, branch_id, state, is_enabled, emergency FROM gates WHERE id = $1', [gateId]);
  if (!pre) throw notFound('Gate');
  if (actor.branchId && pre.branch_id !== actor.branchId && actor.type !== 'STAFF') throw new AppError(403, 'FORBIDDEN', 'Device belongs to another branch');
  if (!SCANNABLE.includes(pre.state)) throw conflict('GATE_BUSY', `Gate is ${pre.state} — please wait`, { state: pre.state });
  displayPublish(pre, { mode: 'VALIDATING' });

  const outcome = await withTx(async (tx, after) => {
    const gate = await loadGateForUpdate(tx, gateId);
    if (!gate.is_enabled) throw unprocessable('GATE_DISABLED', 'Gate is disabled');
    if (gate.emergency || gate.state === 'EMERGENCY') throw unprocessable('GATE_EMERGENCY', 'Gate in emergency mode');
    if (gate.state === 'OFFLINE' || gate.state === 'ERROR') throw unprocessable('GATE_UNAVAILABLE', `Gate is ${gate.state}`);
    if (!SCANNABLE.includes(gate.state)) throw conflict('GATE_BUSY', `Gate is ${gate.state} — please wait`, { state: gate.state });
    const gcfg = await getSetting('gate', gate.branch_id, tx);
    const date = businessDate();

    let cred: any = null;
    let evaluation: Evaluation;
    let reasonCode: string | undefined;
    try {
      cred = (await resolveScan(tx, raw)).credential;
      if (cred.type === 'BOOKING' && !gcfg.bookingCredentialAtGate) throw new ScanError('NO_TICKET', 'Booking barcode must be exchanged at counter');
      // status / blacklist
      if (cred.status === 'ACTIVE' && cred.expires_at && new Date(cred.expires_at) < new Date()) {
        await tx.query(`UPDATE credentials SET status = 'EXPIRED' WHERE id = $1`, [cred.id]);
        cred.status = 'EXPIRED';
      }
      if (cred.status !== 'ACTIVE') throw new ScanError(`CREDENTIAL_${cred.status}`, STATUS_MESSAGES[cred.status] ?? cred.status, cred);
      const direction: 'IN' | 'OUT' = gate.direction === 'EXIT' ? 'OUT' : 'IN';
      if (gate.direction === 'BOTH') {
        const ts = await ticketsForCredential(tx, cred, date);
        evaluation = await evaluateEntry(tx, gate, cred, ts.some((t) => t.presence === 'INSIDE' && t.branch_id === gate.branch_id) ? 'OUT' : 'IN', date);
        (evaluation as any).direction = ts.some((t) => t.presence === 'INSIDE') ? 'OUT' : 'IN';
      } else {
        evaluation = await evaluateEntry(tx, gate, cred, direction, date);
        (evaluation as any).direction = direction;
      }
      reasonCode = evaluation.reasonCode;
    } catch (e) {
      if (!(e instanceof ScanError)) throw e;
      reasonCode = e.reasonCode;
      cred = e.credential ?? cred;
      evaluation = { ok: false, checks: [{ code: 'TICKET_FOUND', label: 'Ticket Found', ok: e.reasonCode !== 'NOT_FOUND' && e.reasonCode !== 'FORGED_QR', detail: e.message }] };
    }
    const direction: 'IN' | 'OUT' = (evaluation as any).direction ?? (gate.direction === 'EXIT' ? 'OUT' : 'IN');
    const ticket = evaluation.ticket;
    const member = (ticket?.member_id ?? cred?.member_id) ? await one(tx, 'SELECT id, first_name, last_name, member_code FROM members WHERE id = $1', [ticket?.member_id ?? cred?.member_id]) : null;
    const isDuplicate = reasonCode === 'DUPLICATE_ENTRY' || reasonCode === 'ALREADY_USED';
    const exitPass = direction === 'OUT'; // exits are always allowed (life safety); anomalies are logged
    const passes = evaluation.ok || exitPass;
    const auto = passes && (gate.mode === 'AUTO' || direction === 'OUT');
    const result = !passes ? 'DENIED' : auto ? 'AUTO_APPROVED' : 'PENDING';
    const scan = await one(tx, `INSERT INTO gate_scans(gate_id, branch_id, direction, raw_hash, credential_id, ticket_id, member_id, account_id, result, decision_mode,
         reason_code, reason, checks, is_duplicate, device_id, operator_staff_id, decided_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16, CASE WHEN $9 <> 'PENDING' THEN now() END) RETURNING *`,
      [gate.id, gate.branch_id, direction, sha256(raw.trim()), cred?.id ?? null, result === 'DENIED' && !ticket ? null : ticket?.id ?? null, member?.id ?? null,
       cred?.account_id ?? null, result, auto ? 'AUTO' : passes ? 'MANUAL' : null, reasonCode ?? null, reasonCode ? reasonOf(reasonCode).en : null,
       JSON.stringify(evaluation.checks), isDuplicate, actor.deviceId ?? null, actor.staffId ?? null]);

    const info = customerInfo(cred, ticket, member);
    if (isDuplicate) {
      const details = { ticketCode: ticket?.ticket_code, firstEntry: evaluation.duplicateOf ? { gate: evaluation.duplicateOf.gate_name, at: evaluation.duplicateOf.entry_time } : null,
        attempt: { gate: gate.name, at: new Date().toISOString() } };
      await tx.query(`INSERT INTO security_events(branch_id, type, gate_id, credential_id, ticket_id, details) VALUES ($1,'DUPLICATE_ENTRY',$2,$3,$4,$5)`,
        [gate.branch_id, gate.id, cred?.id ?? null, ticket?.id ?? null, JSON.stringify(details)]);
      if (gcfg.notifyDuplicate) {
        await notify({ branchId: gate.branch_id, type: 'DUPLICATE_QR', severity: 'WARNING', title: `${gate.name} — DUPLICATE ENTRY ATTEMPT`,
          message: `${ticket?.ticket_code ?? cred?.code}: first entry ${details.firstEntry?.gate ?? '-'}`, data: { gateId: gate.id, scanId: scan!.id, ...details },
          targetPermission: 'gate.view', dedupeKey: `dup:${ticket?.id ?? cred?.id}`, dedupeMinutes: 2 }, tx, after);
      }
      after(() => publish([rooms.gates(gate.branch_id)], 'gate.security', { gateId: gate.id, gateName: gate.name, type: 'DUPLICATE_ENTRY_ATTEMPT', scanId: scan!.id, ...details }));
    }
    if (reasonCode === 'FORGED_QR' || reasonCode === 'CREDENTIAL_LOST' || reasonCode === 'CREDENTIAL_BLOCKED') {
      const type = reasonCode === 'FORGED_QR' ? 'FORGED_QR' : reasonCode === 'CREDENTIAL_LOST' ? 'LOST_CARD_USED' : 'BLACKLISTED';
      await tx.query(`INSERT INTO security_events(branch_id, type, gate_id, credential_id, details) VALUES ($1,$2,$3,$4,$5)`,
        [gate.branch_id, type, gate.id, cred?.id ?? null, JSON.stringify({ gate: gate.name })]);
      await notify({ branchId: gate.branch_id, type: 'SECURITY', severity: 'CRITICAL', title: `${gate.name}: ${type}`, message: `${cred?.code ?? 'unknown QR'} scanned`,
        data: { gateId: gate.id }, targetPermission: 'gate.view', dedupeKey: `sec:${type}:${cred?.id ?? raw}`, dedupeMinutes: 5 }, tx, after);
    }
    await audit(tx, actor, { action: 'GATE_SCAN', entityType: 'gate', entityId: gate.code, branchId: gate.branch_id,
      after: { result, reasonCode, ticket: ticket?.ticket_code, credential: cred?.code, direction } });

    const consolePayload = {
      gateId: gate.id, gateName: gate.name, gateCode: gate.code, scanId: scan!.id, result, reasonCode, reason: reasonCode ? reasonOf(reasonCode) : null,
      direction, checks: evaluation.checks, isDuplicate, duplicateOf: evaluation.duplicateOf ?? null, scannedAt: scan!.scanned_at, mode: gate.mode, ...info,
    };
    if (result === 'DENIED') {
      await setState(tx, gate, 'DENIED', { currentScanId: scan!.id });
      after(() => {
        publish([rooms.gates(gate.branch_id)], 'gate.scan', consolePayload);
        displayPublish(gate, { mode: 'DENIED', reasonCode, reason: reasonOf(reasonCode ?? 'NOT_FOUND'), resetAfterMs: gcfg.displayResultMs, ...info });
        scheduleReset(gate.id, gcfg.displayResultMs);
      });
      return { scan: scan!, payload: consolePayload };
    }
    if (result === 'PENDING') {
      await setState(tx, gate, 'WAITING_APPROVAL', { currentScanId: scan!.id });
      after(() => {
        publish([rooms.gates(gate.branch_id)], 'gate.scan', consolePayload);
        displayPublish(gate, { mode: 'WAITING_APPROVAL', ...info });
        const rt = runtimeFor(gate);
        if (rt.approvalTimer) clearTimeout(rt.approvalTimer);
        rt.approvalTimer = setTimeout(() => expirePending(gate.id, scan!.id).catch(console.error), gcfg.approvalTimeoutSec * 1000);
      });
      return { scan: scan!, payload: consolePayload };
    }
    // AUTO approve
    const entry = await commitEntry(tx, actor, gate, scan!, ticket ?? null, cred, direction, { auto: true }, after);
    after(() => publish([rooms.gates(gate.branch_id)], 'gate.scan', { ...consolePayload, entryLogId: entry.entryLog.id }));
    return { scan: scan!, payload: consolePayload };
  });
  return { ...outcome.payload, latencyMs: Date.now() - startedAt };
}

/** Write entry/exit effects and start the gate opening sequence (after commit). */
async function commitEntry(tx: Db, actor: Actor, gate: any, scan: any, ticket: TicketRow | null, cred: any, direction: 'IN' | 'OUT',
  opts: { auto?: boolean; override?: boolean; approvalId?: string | null }, after: (cb: () => void) => void) {
  const date = businessDate();
  let entryLog: any;
  if (direction === 'IN' && ticket) {
    const day = await one(tx, `INSERT INTO ticket_day_usage(ticket_id, usage_date, first_entry_at) VALUES ($1,$2,now())
        ON CONFLICT (ticket_id, usage_date) DO UPDATE SET entries = ticket_day_usage.entries + 1 RETURNING entries`, [ticket.id, date]);
    await tx.query(`UPDATE tickets SET presence = 'INSIDE', entry_count = entry_count + 1, first_entry_at = COALESCE(first_entry_at, now()), last_entry_at = now(),
        last_gate_id = $2, current_zone_id = $3 WHERE id = $1`, [ticket.id, gate.id, gate.zone_id]);
    if (ticket.booking_id) await tx.query(`UPDATE bookings SET status = 'CHECKED_IN', checked_in_at = COALESCE(checked_in_at, now()) WHERE id = $1 AND status = 'CONFIRMED'`, [ticket.booking_id]);
    if (day.entries === 1 && ticket.member_id) await tx.query('UPDATE members SET visit_count = visit_count + 1 WHERE id = $1', [ticket.member_id]);
  } else if (direction === 'OUT' && ticket) {
    await tx.query(`UPDATE tickets SET presence = 'OUTSIDE', last_exit_at = now(), last_gate_id = $2, current_zone_id = NULL WHERE id = $1`, [ticket.id, gate.id]);
  }
  entryLog = await one(tx, `INSERT INTO entry_logs(gate_id, branch_id, scan_id, direction, credential_id, ticket_id, member_id, account_id, zone_id, operator_staff_id, device_id,
      override, approval_time) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12, now()) RETURNING *`,
    [gate.id, gate.branch_id, scan?.id ?? null, direction, cred?.id ?? null, ticket?.id ?? null, ticket?.member_id ?? cred?.member_id ?? null, ticket?.account_id ?? cred?.account_id ?? null,
     gate.zone_id, opts.auto ? null : actor.staffId ?? null, actor.deviceId ?? null, !!opts.override]);
  if (cred) await tx.query('UPDATE credentials SET last_used_at = now() WHERE id = $1', [cred.id]);
  await setState(tx, gate, 'APPROVED', { currentScanId: scan?.id ?? null });
  const gcfg = await getSetting('gate', gate.branch_id, tx);
  const occ = direction === 'IN' ? await occupancy(tx, gate.branch_id) : null;
  if (occ) await capacityAlerts(tx, gate.branch_id, occ, after);
  const member = (ticket?.member_id ?? cred?.member_id) ? await one(tx, 'SELECT first_name, last_name, member_code FROM members WHERE id = $1', [ticket?.member_id ?? cred?.member_id]) : null;
  const info = customerInfo(cred, ticket, member);
  after(async () => {
    displayPublish(gate, { mode: 'GRANTED', direction, resetAfterMs: Math.max(gcfg.displayResultMs, 2000), ...info });
    publish([rooms.branch(gate.branch_id), rooms.gates(gate.branch_id), rooms.owner], 'occupancy.changed', { branchId: gate.branch_id, direction, ...(occ ?? await occupancy(pool, gate.branch_id)) });
    publish([rooms.account(ticket?.account_id ?? cred?.account_id)], 'ticket.updated', { ticketId: ticket?.id, presence: direction === 'IN' ? 'INSIDE' : 'OUTSIDE' });
    await openSequence(gate.id, direction, entryLog.id);
  });
  return { entryLog };
}

/** APPROVED → OPENING → OPEN → (passage) → CLOSING → IDLE. Never sends OPEN twice. */
async function openSequence(gateId: string, direction: 'IN' | 'OUT', entryLogId: string | null) {
  const gate = await one(pool, 'SELECT * FROM gates WHERE id = $1', [gateId]);
  if (!gate) return;
  if (gate.state === 'OPEN' || gate.state === 'OPENING') return; // no duplicate OPEN command
  const rt = runtimeFor(gate);
  rt.pendingEntryLogId = entryLogId;
  rt.passageSeen = false;
  await moveGate(gateId, 'OPENING', ['APPROVED', 'IDLE', 'DENIED']);
  publish([rooms.gate(gateId)], 'gate.command', { gateId, command: 'OPEN', direction, durationMs: gate.open_duration_ms });
  try {
    await rt.controller.open({ durationMs: gate.open_duration_ms, direction });
    await moveGate(gateId, 'OPEN', ['OPENING']);
  } catch (err: any) {
    await moveGate(gateId, 'ERROR');
    await notify({ branchId: gate.branch_id, type: 'GATE_ERROR', severity: 'CRITICAL', title: `${gate.name} controller error`, message: String(err?.message ?? err),
      data: { gateId }, dedupeKey: `gateerr:${gateId}`, dedupeMinutes: 5 });
    if (entryLogId) await revertEntry(entryLogId, 'CONTROLLER_ERROR');
  }
}

async function revertEntry(entryLogId: string, why: string) {
  await withTx(async (tx) => {
    const e = await one(tx, 'SELECT * FROM entry_logs WHERE id = $1 FOR UPDATE', [entryLogId]);
    if (!e || e.passage_confirmed || e.direction !== 'IN' || !e.ticket_id) return;
    await tx.query(`UPDATE tickets SET presence = 'OUTSIDE', entry_count = GREATEST(entry_count - 1, 0) WHERE id = $1`, [e.ticket_id]);
    await tx.query(`UPDATE ticket_day_usage SET entries = entries - 1 WHERE ticket_id = $1 AND usage_date = $2`, [e.ticket_id, businessDate(new Date(e.entry_time))]);
    await tx.query(`DELETE FROM ticket_day_usage WHERE ticket_id = $1 AND entries <= 0`, [e.ticket_id]);
    await audit(tx, SYSTEM_ACTOR, { action: 'GATE_ENTRY_REVERTED', entityType: 'entry_log', entityId: e.id, reason: why, branchId: e.branch_id });
  });
}

async function handleHardwareEvent(gateId: string, e: GateHwEvent) {
  const rt = runtimes.get(gateId);
  const gate = await one(pool, 'SELECT id, branch_id, name, state FROM gates WHERE id = $1', [gateId]);
  if (!gate) return;
  switch (e.type) {
    case 'PASSAGE':
      if (rt) rt.passageSeen = true;
      if (rt?.pendingEntryLogId) {
        await pool.query('UPDATE entry_logs SET passage_confirmed = true WHERE id = $1', [rt.pendingEntryLogId]);
        await pool.query('UPDATE gate_scans SET passed_at = now() WHERE id = (SELECT scan_id FROM entry_logs WHERE id = $1)', [rt.pendingEntryLogId]);
      }
      publish([rooms.gates(gate.branch_id)], 'gate.passage', { gateId });
      break;
    case 'NO_PASSAGE':
      if (rt?.pendingEntryLogId) await revertEntry(rt.pendingEntryLogId, 'NO_PASSAGE');
      break;
    case 'CLOSED':
      await moveGate(gateId, 'CLOSING', ['OPEN', 'OPENING']);
      if (rt) rt.pendingEntryLogId = null;
      setTimeout(async () => {
        const g = await moveGate(gateId, 'IDLE', ['CLOSING']);
        if (g) displayPublish({ id: gateId }, { mode: 'WAITING' });
      }, 400);
      break;
    case 'OBSTRUCTION':
      publish([rooms.gates(gate.branch_id)], 'gate.alert', { gateId, type: 'OBSTRUCTION' });
      break;
    case 'FIRE_ALARM':
    case 'EMERGENCY_RELEASE':
      if (e.active) {
        await pool.query(`UPDATE gates SET emergency = true WHERE id = $1`, [gateId]);
        await moveGate(gateId, 'EMERGENCY');
        await notify({ branchId: gate.branch_id, type: 'GATE_EMERGENCY', severity: 'CRITICAL', title: `${gate.name}: ${e.type}`, message: 'Gate released by hardware safety system', data: { gateId } });
      }
      break;
    case 'FAULT':
      await moveGate(gateId, 'ERROR');
      await notify({ branchId: gate.branch_id, type: 'GATE_ERROR', severity: 'CRITICAL', title: `${gate.name} fault`, message: e.message, data: { gateId }, dedupeKey: `gatefault:${gateId}` });
      break;
    case 'OFFLINE':
      await moveGate(gateId, 'OFFLINE');
      await notify({ branchId: gate.branch_id, type: 'GATE_OFFLINE', severity: 'CRITICAL', title: `${gate.name} offline`, message: 'Gate controller is offline', data: { gateId }, dedupeKey: `gateoff:${gateId}` });
      break;
    case 'ONLINE':
      await moveGate(gateId, 'IDLE', ['OFFLINE', 'ERROR']);
      break;
  }
}

/** External hardware events (controller box / edge agent → backend). */
export async function ingestHardwareEvent(gateId: string, e: GateHwEvent) {
  await pool.query('UPDATE gates SET last_heartbeat_at = now() WHERE id = $1', [gateId]);
  await handleHardwareEvent(gateId, e);
}

async function expirePending(gateId: string, scanId: string) {
  await withTx(async (tx, after) => {
    const scan = await one(tx, `SELECT * FROM gate_scans WHERE id = $1 FOR UPDATE`, [scanId]);
    if (!scan || scan.result !== 'PENDING') return;
    await tx.query(`UPDATE gate_scans SET result = 'EXPIRED', reason_code = 'APPROVAL_TIMEOUT', reason = 'Approval timeout', decided_at = now() WHERE id = $1`, [scanId]);
    const gate = await loadGateForUpdate(tx, gateId);
    if (gate.state === 'WAITING_APPROVAL' && gate.current_scan_id === scanId) await setState(tx, gate, 'IDLE', { currentScanId: null });
    after(() => {
      publish([rooms.gates(gate.branch_id)], 'gate.decision', { gateId, scanId, result: 'EXPIRED' });
      displayPublish(gate, { mode: 'DENIED', reasonCode: 'APPROVAL_TIMEOUT', reason: REASON_TEXT.APPROVAL_TIMEOUT, resetAfterMs: 2500 });
      setTimeout(() => displayPublish(gate, { mode: 'WAITING' }), 2500);
    });
  });
}

/** Operator APPROVE / DENY for a WAITING_APPROVAL scan. */
export async function decideScan(actor: Actor, gateId: string, input: { scanId?: string; decision: 'APPROVE' | 'DENY'; reason?: string }) {
  return withTx(async (tx, after) => {
    const gate = await loadGateForUpdate(tx, gateId);
    const scanId = input.scanId ?? gate.current_scan_id;
    if (!scanId) throw conflict('NO_PENDING_SCAN', 'No scan waiting for approval');
    const scan = await one(tx, 'SELECT * FROM gate_scans WHERE id = $1 AND gate_id = $2 FOR UPDATE', [scanId, gateId]);
    if (!scan) throw notFound('Scan');
    if (scan.result !== 'PENDING') throw conflict('ALREADY_DECIDED', `Scan already ${scan.result}`);
    const gcfg = await getSetting('gate', gate.branch_id, tx);
    const rt = runtimes.get(gateId);
    if (rt?.approvalTimer) clearTimeout(rt.approvalTimer);
    if (input.decision === 'DENY') {
      await tx.query(`UPDATE gate_scans SET result = 'DENIED', decision_mode = 'MANUAL', reason_code = 'OPERATOR_DENIED', reason = $2, operator_staff_id = $3, decided_at = now() WHERE id = $1`,
        [scanId, input.reason ?? 'Denied by operator', actor.staffId ?? null]);
      await setState(tx, gate, 'DENIED');
      await audit(tx, actor, { action: 'GATE_DENY', entityType: 'gate_scan', entityId: scanId, reason: input.reason, branchId: gate.branch_id });
      after(() => {
        publish([rooms.gates(gate.branch_id)], 'gate.decision', { gateId, scanId, result: 'DENIED', operator: actor.name });
        displayPublish(gate, { mode: 'DENIED', reasonCode: 'OPERATOR_DENIED', reason: REASON_TEXT.OPERATOR_DENIED, resetAfterMs: gcfg.displayResultMs });
        scheduleReset(gateId, gcfg.displayResultMs);
      });
      return { result: 'DENIED' };
    }
    // re-validate (state may have changed while waiting)
    const cred = scan.credential_id ? await one(tx, 'SELECT * FROM credentials WHERE id = $1', [scan.credential_id]) : null;
    if (!cred || cred.status !== 'ACTIVE') throw unprocessable('CREDENTIAL_CHANGED', 'Credential no longer active');
    const ticket = scan.ticket_id ? (await ticketsForCredential(tx, cred, businessDate(), { lock: true })).find((t) => t.id === scan.ticket_id) ?? null : null;
    if (scan.direction === 'IN' && ticket?.presence === 'INSIDE') throw conflict('TICKET_ALREADY_INSIDE', 'Ticket entered through another gate meanwhile');
    await tx.query(`UPDATE gate_scans SET result = 'APPROVED', decision_mode = 'MANUAL', operator_staff_id = $2, decided_at = now() WHERE id = $1`, [scanId, actor.staffId ?? null]);
    await audit(tx, actor, { action: 'GATE_APPROVE', entityType: 'gate_scan', entityId: scanId, branchId: gate.branch_id, after: { ticket: ticket?.ticket_code } });
    const { entryLog } = await commitEntry(tx, actor, gate, scan, ticket, cred, scan.direction, {}, after);
    after(() => publish([rooms.gates(gate.branch_id)], 'gate.decision', { gateId, scanId, result: 'APPROVED', operator: actor.name, entryLogId: entryLog.id }));
    return { result: 'APPROVED', entryLogId: entryLog.id };
  });
}

/** Supervisor override of a denied scan (anti-passback, time window…) — requires approval. */
export async function overrideScan(actor: Actor, gateId: string, scanId: string, reason: string, approvalId?: string | null) {
  return withTx(async (tx, after) => {
    const gate = await loadGateForUpdate(tx, gateId);
    const scan = await one(tx, 'SELECT * FROM gate_scans WHERE id = $1 AND gate_id = $2 FOR UPDATE', [scanId, gateId]);
    if (!scan) throw notFound('Scan');
    if (!['DENIED', 'EXPIRED'].includes(scan.result)) throw conflict('NOT_OVERRIDABLE', `Scan is ${scan.result}`);
    if (Date.now() - new Date(scan.scanned_at).getTime() > 5 * 60_000) throw conflict('OVERRIDE_TOO_LATE', 'Scan older than 5 minutes — scan again');
    if (!['IDLE', 'DENIED'].includes(gate.state)) throw conflict('GATE_BUSY', `Gate is ${gate.state}`);
    const approval = await consumeApproval(tx, actor, approvalId, 'GATE_OVERRIDE', gate.branch_id);
    const cred = scan.credential_id ? await one(tx, 'SELECT * FROM credentials WHERE id = $1', [scan.credential_id]) : null;
    const ticket = scan.ticket_id && cred ? (await ticketsForCredential(tx, cred, businessDate(), { lock: true })).find((t) => t.id === scan.ticket_id) ?? null : null;
    if (ticket?.presence === 'INSIDE') await tx.query(`UPDATE tickets SET presence = 'OUTSIDE' WHERE id = $1`, [ticket.id]); // passback reset
    await tx.query(`UPDATE gate_scans SET result = 'APPROVED', decision_mode = 'OVERRIDE', operator_staff_id = $2, approval_id = $3, decided_at = now() WHERE id = $1`, [scanId, actor.staffId, approval]);
    await tx.query(`INSERT INTO security_events(branch_id, type, gate_id, credential_id, ticket_id, details) VALUES ($1,'MANUAL_OVERRIDE',$2,$3,$4,$5)`,
      [gate.branch_id, gate.id, cred?.id ?? null, ticket?.id ?? null, JSON.stringify({ reason, by: actor.name, scanId })]);
    await audit(tx, actor, { action: 'GATE_OVERRIDE', entityType: 'gate_scan', entityId: scanId, reason, branchId: gate.branch_id, metadata: { approvalId: approval } });
    if (ticket) ticket.presence = 'OUTSIDE';
    if (gate.state === 'DENIED') await setState(tx, gate, 'IDLE');
    const { entryLog } = await commitEntry(tx, actor, gate, scan, ticket, cred, scan.direction, { override: true, approvalId: approval }, after);
    after(() => publish([rooms.gates(gate.branch_id)], 'gate.decision', { gateId, scanId, result: 'APPROVED', override: true, operator: actor.name }));
    return { result: 'APPROVED', entryLogId: entryLog.id };
  });
}

/** Manual gate open (no ticket) — permission gate.open + manager approval per settings. */
export async function manualOpen(actor: Actor, gateId: string, reason: string, approvalId?: string | null) {
  return withTx(async (tx, after) => {
    const gate = await loadGateForUpdate(tx, gateId);
    if (['OPEN', 'OPENING'].includes(gate.state)) throw conflict('ALREADY_OPEN', 'Gate is already open');
    if (gate.state === 'WAITING_APPROVAL') throw conflict('GATE_BUSY', 'Resolve the pending scan first');
    const approval = await consumeApproval(tx, actor, approvalId, 'MANUAL_GATE_OPEN', gate.branch_id);
    const entry = await one(tx, `INSERT INTO entry_logs(gate_id, branch_id, direction, operator_staff_id, device_id, override, approval_time, zone_id)
        VALUES ($1,$2,$3,$4,$5,true,now(),$6) RETURNING *`, [gate.id, gate.branch_id, gate.direction === 'EXIT' ? 'OUT' : 'IN', actor.staffId, actor.deviceId ?? null, gate.zone_id]);
    await tx.query(`INSERT INTO security_events(branch_id, type, gate_id, details) VALUES ($1,'MANUAL_OVERRIDE',$2,$3)`, [gate.branch_id, gate.id, JSON.stringify({ reason, by: actor.name, manualOpen: true })]);
    await audit(tx, actor, { action: 'GATE_MANUAL_OPEN', entityType: 'gate', entityId: gate.code, reason, branchId: gate.branch_id, metadata: { approvalId: approval } });
    if (gate.state === 'DENIED') await setState(tx, gate, 'IDLE');
    await setState(tx, gate, 'APPROVED', { currentScanId: null });
    after(async () => {
      displayPublish(gate, { mode: 'GRANTED', manual: true, resetAfterMs: 2500 });
      await openSequence(gate.id, gate.direction === 'EXIT' ? 'OUT' : 'IN', null);
    });
    return { entryLogId: entry!.id };
  });
}

export async function closeGate(actor: Actor, gateId: string) {
  const gate = await one(pool, 'SELECT * FROM gates WHERE id = $1', [gateId]);
  if (!gate) throw notFound('Gate');
  const rt = runtimeFor(gate);
  await rt.controller.close();
  await moveGate(gateId, 'IDLE', ['OPEN', 'OPENING', 'CLOSING', 'APPROVED']);
  await audit(pool, actor, { action: 'GATE_CLOSE', entityType: 'gate', entityId: gate.code, branchId: gate.branch_id });
  publish([rooms.gate(gateId)], 'gate.command', { gateId, command: 'CLOSE' });
  return { ok: true };
}

export async function resetGate(actor: Actor, gateId: string) {
  return withTx(async (tx) => {
    const gate = await loadGateForUpdate(tx, gateId);
    if (gate.emergency) throw conflict('EMERGENCY_ACTIVE', 'Disable emergency mode first');
    await tx.query(`UPDATE gate_scans SET result = 'EXPIRED', reason_code = 'RESET', decided_at = now() WHERE gate_id = $1 AND result = 'PENDING'`, [gateId]);
    await tx.query(`UPDATE gates SET state = 'IDLE', current_scan_id = NULL, state_changed_at = now() WHERE id = $1`, [gateId]);
    await audit(tx, actor, { action: 'GATE_RESET', entityType: 'gate', entityId: gate.code, branchId: gate.branch_id, before: { state: gate.state } });
    publish([rooms.gates(gate.branch_id), rooms.gate(gateId)], 'gate.state', { gateId, state: 'IDLE', from: gate.state });
    displayPublish(gate, { mode: 'WAITING' });
    return { ok: true };
  });
}

/** Emergency mode: release all gates of a branch (software side; hardware safety acts independently). */
export async function setEmergency(actor: Actor, branchId: string, active: boolean, reason: string) {
  const gates = await query(pool, 'SELECT * FROM gates WHERE branch_id = $1', [branchId]);
  for (const g of gates) {
    try { await runtimeFor(g).controller.setEmergency(active); } catch (e) { console.error('emergency release failed', g.code, e); }
    publish([rooms.gate(g.id)], 'gate.command', { gateId: g.id, command: active ? 'EMERGENCY_OPEN' : 'EMERGENCY_CLEAR' });
  }
  await withTx(async (tx) => {
    await tx.query(`UPDATE gates SET emergency = $2, state = CASE WHEN $2 THEN 'EMERGENCY' ELSE 'IDLE' END, current_scan_id = NULL, state_changed_at = now() WHERE branch_id = $1`, [branchId, active]);
    await tx.query(`UPDATE gate_scans SET result = 'EXPIRED', reason_code = 'EMERGENCY', decided_at = now() WHERE branch_id = $1 AND result = 'PENDING'`, [branchId]);
    await tx.query(`INSERT INTO security_events(branch_id, type, details) VALUES ($1,'EMERGENCY',$2)`, [branchId, JSON.stringify({ active, reason, by: actor.name })]);
    await audit(tx, actor, { action: active ? 'GATE_EMERGENCY_ON' : 'GATE_EMERGENCY_OFF', entityType: 'branch', entityId: branchId, reason, branchId });
    await notify({ branchId, type: 'GATE_EMERGENCY', severity: 'CRITICAL', title: active ? 'EMERGENCY MODE ACTIVATED' : 'Emergency mode cleared', message: reason, data: { active } }, tx);
  });
  for (const g of gates) {
    publish([rooms.gates(branchId), rooms.gate(g.id)], 'gate.state', { gateId: g.id, state: active ? 'EMERGENCY' : 'IDLE' });
    displayPublish(g, { mode: active ? 'EMERGENCY' : 'WAITING' });
  }
  return { gates: gates.length, active };
}

// ---------------------------------------------------------------------
// Read models
// ---------------------------------------------------------------------
export async function occupancy(db: Db, branchId: string) {
  const date = businessDate();
  const r = await one(db, `SELECT
      (SELECT capacity FROM branches WHERE id = $1) AS capacity,
      (SELECT COUNT(*)::int FROM tickets WHERE branch_id = $1 AND presence = 'INSIDE') AS inside,
      (SELECT COUNT(*)::int FROM entry_logs WHERE branch_id = $1 AND direction = 'IN' AND entry_time >= ($2::date)::timestamp AT TIME ZONE 'Asia/Bangkok') AS entered,
      (SELECT COUNT(*)::int FROM entry_logs WHERE branch_id = $1 AND direction = 'OUT' AND entry_time >= ($2::date)::timestamp AT TIME ZONE 'Asia/Bangkok') AS exited,
      (SELECT COUNT(DISTINCT ticket_id)::int FROM ticket_day_usage u JOIN tickets t ON t.id = u.ticket_id WHERE t.branch_id = $1 AND u.usage_date = $2) AS visitors`, [branchId, date]);
  return { capacity: r.capacity, inside: r.inside, entered: r.entered, exited: r.exited, visitorsToday: r.visitors, percent: r.capacity ? Math.round((r.inside / r.capacity) * 1000) / 10 : 0 };
}

async function capacityAlerts(tx: Db, branchId: string, occ: { inside: number; capacity: number; percent: number }, after: (cb: () => void) => void) {
  const cfg = await getSetting('capacity', branchId, tx);
  const prevPct = occ.capacity ? ((occ.inside - 1) / occ.capacity) * 100 : 0;
  for (const t of [...cfg.warnPercents].sort((a, b) => b - a)) {
    if (occ.percent >= t && prevPct < t) {
      await notify({ branchId, type: 'CAPACITY_WARNING', severity: t >= 100 ? 'CRITICAL' : 'WARNING', title: `Park capacity ${t}%`,
        message: `${occ.inside.toLocaleString()} / ${occ.capacity.toLocaleString()} guests inside`, data: occ, dedupeKey: `cap:${branchId}:${t}`, dedupeMinutes: 30 }, tx, after);
      break;
    }
  }
}

export async function gatesSnapshot(db: Db, branchId: string) {
  const gates = await query(db, `SELECT g.*, z.name AS zone_name, s.first_name AS operator_name,
      (SELECT row_to_json(x) FROM (
         SELECT gs.id, gs.result, gs.reason_code, gs.reason, gs.checks, gs.scanned_at, gs.is_duplicate, gs.direction, gs.decision_mode,
                t.ticket_code, t.guest_name, t.visit_date, p.name AS package_name, tt.name AS ticket_type_name,
                m.first_name || ' ' || m.last_name AS member_name, m.member_code, c.code AS credential_code
           FROM gate_scans gs LEFT JOIN tickets t ON t.id = gs.ticket_id LEFT JOIN packages p ON p.id = t.package_id
           LEFT JOIN ticket_types tt ON tt.id = t.ticket_type_id LEFT JOIN members m ON m.id = gs.member_id LEFT JOIN credentials c ON c.id = gs.credential_id
          WHERE gs.gate_id = g.id ORDER BY gs.scanned_at DESC LIMIT 1) x) AS last_scan,
      (SELECT json_build_object('total', COUNT(*), 'approved', COUNT(*) FILTER (WHERE result IN ('APPROVED','AUTO_APPROVED')),
              'denied', COUNT(*) FILTER (WHERE result = 'DENIED'), 'duplicate', COUNT(*) FILTER (WHERE is_duplicate))
         FROM gate_scans WHERE gate_id = g.id AND scanned_at >= date_trunc('day', now() AT TIME ZONE 'Asia/Bangkok') AT TIME ZONE 'Asia/Bangkok') AS stats
    FROM gates g LEFT JOIN zones z ON z.id = g.zone_id LEFT JOIN staff s ON s.id = g.operator_staff_id
   WHERE g.branch_id = $1 ORDER BY g.number`, [branchId]);
  return gates;
}

export async function gateStatus(gateId: string) {
  const gate = await one(pool, 'SELECT * FROM gates WHERE id = $1', [gateId]);
  if (!gate) throw notFound('Gate');
  const hw = await runtimeFor(gate).controller.status().catch((e) => ({ online: false, detail: String(e) }));
  return { id: gate.id, code: gate.code, name: gate.name, state: gate.state, mode: gate.mode, direction: gate.direction, emergency: gate.emergency,
    enabled: gate.is_enabled, controllerType: gate.controller_type, hardware: hw, stateChangedAt: gate.state_changed_at };
}

/** Boot: clear transient states left by a restart; expire stale pending scans. */
export async function initGates() {
  await pool.query(`UPDATE gate_scans SET result = 'EXPIRED', reason_code = 'RESTART', decided_at = now() WHERE result = 'PENDING'`);
  await pool.query(`UPDATE gates SET state = CASE WHEN emergency THEN 'EMERGENCY' ELSE 'IDLE' END, current_scan_id = NULL
                    WHERE state NOT IN ('OFFLINE','EMERGENCY')`);
}

export function disposeGateRuntimes() {
  for (const rt of runtimes.values()) { rt.controller.dispose(); if (rt.resetTimer) clearTimeout(rt.resetTimer); if (rt.approvalTimer) clearTimeout(rt.approvalTimer); }
  runtimes.clear();
}
