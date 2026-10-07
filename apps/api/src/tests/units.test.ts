import { describe, expect, it } from 'vitest';
import { crc16, promptPayPayload } from '../lib/promptpay.js';
import { dynamicQrPayload, hashSecret, newCredentialToken, parseScanPayload, staticQrPayload, verifySecret, DYNAMIC_WINDOW_SEC } from '../lib/crypto.js';
import { canTransition } from '../services/gates.js';
import { ageOn, dateCheck } from '../services/tickets.js';

describe('PromptPay EMVCo payload', () => {
  it('CRC16-CCITT (FALSE) standard check value', () => expect(crc16('123456789')).toBe('29B1'));
  it('encodes mobile target + amount with a valid CRC', () => {
    const p = promptPayPayload('081-234-5678', 12000);
    expect(p).toContain('0113' + '0066812345678');
    expect(p).toContain('5406120.00');
    expect(p.slice(-4)).toBe(crc16(p.slice(0, -4)));
    expect(p.startsWith('000201010212')).toBe(true); // dynamic QR (has amount)
  });
});

describe('credential QR security', () => {
  const token = newCredentialToken();
  it('static QR round-trips and rejects tampering', () => {
    const qr = staticQrPayload(token);
    expect(parseScanPayload(qr)).toEqual({ ok: true, token, kind: 'STATIC' });
    const forged = qr.slice(0, -1) + (qr.endsWith('A') ? 'B' : 'A');
    expect(parseScanPayload(forged)).toEqual({ ok: false, reason: 'FORGED' });
    expect(parseScanPayload(`https://park.example/c/${qr}`).ok).toBe(true);
  });
  it('dynamic QR expires (screenshot replay protection)', () => {
    const now = Date.now();
    const { payload } = dynamicQrPayload(token, now);
    expect(parseScanPayload(payload, now)).toMatchObject({ ok: true, kind: 'DYNAMIC' });
    expect(parseScanPayload(payload, now + DYNAMIC_WINDOW_SEC * 4 * 1000)).toEqual({ ok: false, reason: 'EXPIRED_DYNAMIC' });
  });
  it('raw barcode token accepted, garbage rejected', () => {
    expect(parseScanPayload(token).ok).toBe(true);
    expect(parseScanPayload('hello world')).toEqual({ ok: false, reason: 'MALFORMED' });
  });
  it('scrypt hashes verify and never store plain text', async () => {
    const h = await hashSecret('1234');
    expect(h).not.toContain('1234');
    expect(await verifySecret('1234', h)).toBe(true);
    expect(await verifySecret('4321', h)).toBe(false);
  });
});

describe('gate state machine', () => {
  it('allows the normal cycle', () => {
    expect(canTransition('IDLE', 'VALIDATING')).toBe(true);
    expect(canTransition('WAITING_APPROVAL', 'APPROVED')).toBe(true);
    expect(canTransition('APPROVED', 'OPENING')).toBe(true);
    expect(canTransition('OPEN', 'CLOSING')).toBe(true);
  });
  it('never re-opens an open gate and always allows safety states', () => {
    expect(canTransition('OPEN', 'OPENING')).toBe(false);
    expect(canTransition('OPEN', 'APPROVED')).toBe(false);
    expect(canTransition('OPEN', 'EMERGENCY')).toBe(true);
    expect(canTransition('WAITING_APPROVAL', 'OFFLINE')).toBe(true);
  });
});

describe('ticket rules', () => {
  const t: any = { valid_from: '2026-10-10', valid_to: '2026-10-11', days_allowed: 1, days_used: 1, entries_today: 0, valid_days_of_week: [0, 1, 2, 3, 4, 5, 6] };
  it('multi-day usage and validity window', () => {
    expect(dateCheck(t, '2026-10-09')).toMatchObject({ ok: false, code: 'WRONG_DATE' });
    expect(dateCheck(t, '2026-10-12')).toMatchObject({ ok: false, code: 'EXPIRED' });
    expect(dateCheck(t, '2026-10-11')).toMatchObject({ ok: false, code: 'DAYS_EXHAUSTED' });
    expect(dateCheck({ ...t, entries_today: 2 }, '2026-10-11').ok).toBe(true);
  });
  it('age on a date', () => {
    expect(ageOn('2016-10-08', '2026-10-07')).toBe(9);
    expect(ageOn('2016-10-07', '2026-10-07')).toBe(10);
  });
});

describe('scanner typing with the Thai keyboard layout', () => {
  it('maps Thai-layout keystrokes back to the scanned code', async () => {
    const { fixThaiKeyboardLayout } = await import('../lib/keyboard.js');
    const thai = (s: string) => [...s].map((c) => ({ T: 'ธ', P: 'ญ', '1': 'ๅ', '.': 'ใ', A: 'ฤ', B: 'ฺ', '8': 'ค', '5': 'ถ', '0': 'จ', '2': '/', '3': '-', '-': 'ข' } as Record<string, string>)[c] ?? c).join('');
    expect(fixThaiKeyboardLayout(thai('TP1.AB'))).toBe('TP1.AB');
    expect(fixThaiKeyboardLayout(thai('8850023'))).toBe('8850023');
    expect(fixThaiKeyboardLayout('CARD-0001')).toBe('CARD-0001'); // untouched without Thai characters
  });
});
