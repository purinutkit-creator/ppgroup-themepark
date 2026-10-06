import net from 'node:net';

/**
 * Minimal ESC/POS command builder for 58 / 80 mm thermal printers and ticket / wristband printers
 * that accept ESC/POS. Thai text requires a printer code page with TIS-620 (most Thai-market printers).
 */
export class EscPos {
  private chunks: Buffer[] = [Buffer.from([0x1b, 0x40])]; // init
  constructor(private width = 48) {}
  private raw(...b: number[]) { this.chunks.push(Buffer.from(b)); return this; }
  text(s: string) { this.chunks.push(encodeTis620(s)); return this; }
  line(s = '') { return this.text(s + '\n'); }
  align(a: 'left' | 'center' | 'right') { return this.raw(0x1b, 0x61, a === 'left' ? 0 : a === 'center' ? 1 : 2); }
  bold(on = true) { return this.raw(0x1b, 0x45, on ? 1 : 0); }
  size(w: 1 | 2, h: 1 | 2) { return this.raw(0x1d, 0x21, ((w - 1) << 4) | (h - 1)); }
  rule() { return this.line('-'.repeat(this.width)); }
  cols(left: string, right: string) {
    const space = Math.max(1, this.width - visualLength(left) - visualLength(right));
    return this.line(left + ' '.repeat(space) + right);
  }
  qr(data: string, size = 6) {
    const d = Buffer.from(data, 'ascii');
    const len = d.length + 3;
    this.raw(0x1d, 0x28, 0x6b, 4, 0, 0x31, 0x41, 0x32, 0x00);           // model 2
    this.raw(0x1d, 0x28, 0x6b, 3, 0, 0x31, 0x43, size);                  // module size
    this.raw(0x1d, 0x28, 0x6b, 3, 0, 0x31, 0x45, 0x31);                  // error correction M
    this.raw(0x1d, 0x28, 0x6b, len & 0xff, len >> 8, 0x31, 0x50, 0x30); this.chunks.push(d);
    return this.raw(0x1d, 0x28, 0x6b, 3, 0, 0x31, 0x51, 0x30);           // print
  }
  barcode128(data: string) {
    const d = Buffer.from(`{B${data}`, 'ascii');
    this.raw(0x1d, 0x68, 80, 0x1d, 0x77, 2, 0x1d, 0x48, 2);
    this.raw(0x1d, 0x6b, 73, d.length); this.chunks.push(d);
    return this.line();
  }
  feed(n = 3) { return this.raw(0x1b, 0x64, n); }
  cut() { return this.raw(0x1d, 0x56, 0x42, 0x00); }
  build() { return Buffer.concat(this.chunks); }
}

function visualLength(s: string) { return [...s.replace(/[ัิ-ฺ็-๎]/g, '')].length; }

/** UTF-8 → TIS-620 (Thai) single-byte encoding; other non-ASCII chars become '?'. */
export function encodeTis620(s: string): Buffer {
  const out: number[] = [];
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    if (c < 0x80) out.push(c);
    else if (c >= 0x0e01 && c <= 0x0e5b) out.push(c - 0x0e00 + 0xa0);
    else out.push(0x3f);
  }
  return Buffer.from(out);
}

export function sendToNetworkPrinter(host: string, port: number, data: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    const sock = net.createConnection({ host, port, timeout: 5000 }, () => { sock.end(data, () => resolve()); });
    sock.on('error', reject);
    sock.on('timeout', () => { sock.destroy(); reject(new Error('Printer timeout')); });
  });
}
