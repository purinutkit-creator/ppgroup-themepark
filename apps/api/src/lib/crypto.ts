import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { config } from '../config.js';

const scrypt = promisify(crypto.scrypt) as (pw: string | Buffer, salt: Buffer, keylen: number, opts: crypto.ScryptOptions) => Promise<Buffer>;
const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

/** scrypt password hash: scrypt$N$r$p$salt$hash (never store plain text) */
export async function hashSecret(secret: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(secret.normalize('NFKC'), salt, 32, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64url')}$${key.toString('base64url')}`;
}

export async function verifySecret(secret: string, stored: string | null | undefined): Promise<boolean> {
  if (!stored) return false;
  const [algo, n, r, p, saltB64, keyB64] = stored.split('$');
  if (algo !== 'scrypt') return false;
  const expected = Buffer.from(keyB64, 'base64url');
  const key = await scrypt(secret.normalize('NFKC'), Buffer.from(saltB64, 'base64url'), expected.length, {
    N: Number(n), r: Number(r), p: Number(p), maxmem: SCRYPT.maxmem,
  });
  return crypto.timingSafeEqual(key, expected);
}

// Crockford base32 (no I, L, O, U) — unambiguous for printing / manual entry / Code128 barcodes
const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export function randomBase32(len: number): string {
  const bytes = crypto.randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i++) out += B32[bytes[i] & 31];
  return out;
}
function toBase32(buf: Buffer, len: number): string {
  let out = '';
  for (let i = 0; out.length < len; i++) out += B32[buf[i % buf.length] & 31];
  return out;
}

export const sha256 = (s: string | Buffer) => crypto.createHash('sha256').update(s).digest('hex');
export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');
export const randomDigits = (n: number) => Array.from(crypto.randomBytes(n), (b) => String(b % 10)).join('');

function hmac(data: string): Buffer {
  return crypto.createHmac('sha256', config.qrSecret).update(data).digest();
}

// ---------------------------------------------------------------------
// Credential QR / barcode payloads
//   static  : TP1.<token>.<sig6>                 (printed wristbands, cards, tickets)
//   dynamic : TP2.<token>.<window>.<sig10>       (digital member card, rotates every 30s → anti-screenshot)
//   barcode : <token>                            (16 char base32, Code128)
// The token is a random credential identifier — the QR carries NO customer data;
// all state is looked up server-side on every scan.
// ---------------------------------------------------------------------
export const CREDENTIAL_TOKEN_LEN = 16;
export const DYNAMIC_WINDOW_SEC = 30;

export const newCredentialToken = () => randomBase32(CREDENTIAL_TOKEN_LEN);

export function staticQrPayload(token: string): string {
  return `TP1.${token}.${toBase32(hmac(`TP1.${token}`), 6)}`;
}

export function dynamicQrPayload(token: string, at = Date.now()): { payload: string; expiresInSec: number } {
  const window = Math.floor(at / 1000 / DYNAMIC_WINDOW_SEC);
  const sig = toBase32(hmac(`TP2.${token}.${window}`), 10);
  const expiresInSec = DYNAMIC_WINDOW_SEC - Math.floor((at / 1000) % DYNAMIC_WINDOW_SEC);
  return { payload: `TP2.${token}.${window}.${sig}`, expiresInSec };
}

export type ParsedScan =
  | { ok: true; token: string; kind: 'STATIC' | 'DYNAMIC' | 'RAW' }
  | { ok: false; reason: 'FORGED' | 'EXPIRED_DYNAMIC' | 'MALFORMED' };

function safeEq(a: string, b: string) {
  const ab = Buffer.from(a), bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

export function parseScanPayload(raw: string, now = Date.now()): ParsedScan {
  let s = (raw ?? '').trim();
  // allow URL-style QR: https://park/c/<payload>
  const m = s.match(/\/c\/([^/?#]+)$/);
  if (m) s = decodeURIComponent(m[1]);
  s = s.toUpperCase();
  if (s.startsWith('TP1.')) {
    const [, token, sig] = s.split('.');
    if (!token || !sig) return { ok: false, reason: 'MALFORMED' };
    if (!safeEq(sig, toBase32(hmac(`TP1.${token}`), 6))) return { ok: false, reason: 'FORGED' };
    return { ok: true, token, kind: 'STATIC' };
  }
  if (s.startsWith('TP2.')) {
    const [, token, windowStr, sig] = s.split('.');
    const window = Number(windowStr);
    if (!token || !sig || !Number.isInteger(window)) return { ok: false, reason: 'MALFORMED' };
    if (!safeEq(sig, toBase32(hmac(`TP2.${token}.${window}`), 10))) return { ok: false, reason: 'FORGED' };
    const current = Math.floor(now / 1000 / DYNAMIC_WINDOW_SEC);
    if (window < current - 2 || window > current + 1) return { ok: false, reason: 'EXPIRED_DYNAMIC' };
    return { ok: true, token, kind: 'DYNAMIC' };
  }
  if (new RegExp(`^[${B32}]{${CREDENTIAL_TOKEN_LEN}}$`).test(s)) return { ok: true, token: s, kind: 'RAW' };
  return { ok: false, reason: 'MALFORMED' };
}

/** Device API keys: tpd_<prefix>_<secret>; only a hash is stored */
export function newDeviceApiKey(): { key: string; prefix: string; hash: string } {
  const prefix = randomBase32(8).toLowerCase();
  const secret = randomToken(24);
  const key = `tpd_${prefix}_${secret}`;
  return { key, prefix, hash: sha256(key) };
}
