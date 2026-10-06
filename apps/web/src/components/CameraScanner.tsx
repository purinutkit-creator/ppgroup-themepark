import { useEffect, useRef, useState } from 'react';
import { BrowserMultiFormatReader, type IScannerControls } from '@zxing/browser';
import { BarcodeFormat, DecodeHintType } from '@zxing/library';
import { CameraOff, SwitchCamera } from 'lucide-react';
import { cx } from './ui';

/**
 * Continuous camera scanner (QR + Code128 + EAN). After a successful read the scanner is
 * LOCKED until `locked` becomes false again (i.e. the current transaction finished),
 * preventing duplicate scans of the same code.
 */
export function CameraScanner({ onScan, locked = false, className, overlay = true, facing = 'environment' }: {
  onScan: (code: string) => void; locked?: boolean; className?: string; overlay?: boolean; facing?: 'environment' | 'user';
}) {
  const video = useRef<HTMLVideoElement>(null);
  const controls = useRef<IScannerControls | null>(null);
  const lockedRef = useRef(locked);
  const cb = useRef(onScan);
  cb.current = onScan;
  lockedRef.current = locked;
  const [error, setError] = useState<string | null>(null);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceIdx, setDeviceIdx] = useState(0);
  const last = useRef<{ code: string; at: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    const hints = new Map();
    hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.QR_CODE, BarcodeFormat.CODE_128, BarcodeFormat.EAN_13, BarcodeFormat.CODE_39]);
    const reader = new BrowserMultiFormatReader(hints, { delayBetweenScanAttempts: 120 });
    (async () => {
      try {
        const list = await BrowserMultiFormatReader.listVideoInputDevices();
        if (cancelled) return;
        setDevices(list);
        const pref = list.findIndex((d) => (facing === 'environment' ? /back|rear|environment/i : /front|user/i).test(d.label));
        const dev = list[deviceIdx] ?? list[pref >= 0 ? pref : 0];
        controls.current = await reader.decodeFromVideoDevice(dev?.deviceId, video.current!, (res) => {
          if (!res || lockedRef.current) return;
          const code = res.getText();
          const now = Date.now();
          if (last.current && last.current.code === code && now - last.current.at < 3000) return;
          last.current = { code, at: now };
          lockedRef.current = true; // lock immediately until parent releases
          cb.current(code);
        });
        setError(null);
      } catch (e: any) {
        setError(e?.name === 'NotAllowedError' ? 'Camera permission denied' : e?.message ?? 'Camera unavailable');
      }
    })();
    return () => { cancelled = true; controls.current?.stop(); };
  }, [deviceIdx, facing]);

  return (
    <div className={cx('relative overflow-hidden bg-black', className)}>
      <video ref={video} className="h-full w-full object-cover" muted playsInline />
      {overlay && !error && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className={cx('relative aspect-square w-[62%] max-w-[420px] rounded-3xl border-4 transition', locked ? 'border-white/30' : 'border-white/90')}>
            {!locked && <div className="scanline absolute left-3 right-3 h-0.5 bg-emerald-400 shadow-[0_0_12px_2px_rgba(52,211,153,0.9)]" />}
          </div>
        </div>
      )}
      {error && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-white/80">
          <CameraOff className="h-10 w-10" /><div className="text-sm">{error}</div><div className="text-xs text-white/50">USB / 2D scanners still work</div>
        </div>
      )}
      {devices.length > 1 && (
        <button onClick={() => setDeviceIdx((i) => (i + 1) % devices.length)} className="absolute right-3 top-3 rounded-full bg-black/50 p-2 text-white"><SwitchCamera className="h-5 w-5" /></button>
      )}
    </div>
  );
}
