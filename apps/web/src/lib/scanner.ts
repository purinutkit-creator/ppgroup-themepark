import { useEffect, useRef } from 'react';

/**
 * USB / Bluetooth barcode scanners act as keyboards ("keyboard wedge"): they type the code
 * very fast and finish with Enter. This hook captures those bursts globally (unless the user
 * is typing in an input) and calls onScan once per code, ignoring repeats within `lockMs`.
 */
export function useKeyboardScanner(onScan: (code: string) => void, opts: { enabled?: boolean; lockMs?: number; minLength?: number } = {}) {
  const buf = useRef('');
  const last = useRef(0);
  const lastCode = useRef<{ code: string; at: number } | null>(null);
  const cb = useRef(onScan);
  cb.current = onScan;
  useEffect(() => {
    if (opts.enabled === false) return;
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) && !target.dataset.scanCapture) return;
      const now = Date.now();
      if (now - last.current > 80) buf.current = '';
      last.current = now;
      if (e.key === 'Enter') {
        const code = buf.current.trim();
        buf.current = '';
        if (code.length >= (opts.minLength ?? 6)) {
          if (lastCode.current && lastCode.current.code === code && now - lastCode.current.at < (opts.lockMs ?? 2500)) return;
          lastCode.current = { code, at: now };
          e.preventDefault();
          cb.current(code);
        }
        return;
      }
      if (e.key.length === 1) buf.current += e.key;
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [opts.enabled, opts.lockMs, opts.minLength]);
}
