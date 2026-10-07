import { useEffect, useRef, useState } from 'react';
import { BrowserMultiFormatReader } from '@zxing/browser';
import { BarcodeFormat, DecodeHintType } from '@zxing/library';
import { CameraOff, SwitchCamera } from 'lucide-react';
import { cx } from './ui';

type Facing = 'environment' | 'user';

const FORMATS = [
  BarcodeFormat.QR_CODE, BarcodeFormat.CODE_128, BarcodeFormat.CODE_39, BarcodeFormat.CODE_93, BarcodeFormat.CODABAR, BarcodeFormat.ITF,
  BarcodeFormat.EAN_13, BarcodeFormat.EAN_8, BarcodeFormat.UPC_A, BarcodeFormat.UPC_E, BarcodeFormat.DATA_MATRIX, BarcodeFormat.PDF_417, BarcodeFormat.AZTEC,
];
const NATIVE_FORMATS = ['qr_code', 'code_128', 'code_39', 'code_93', 'codabar', 'itf', 'ean_13', 'ean_8', 'upc_a', 'upc_e', 'data_matrix', 'pdf417', 'aztec'];

// remembered per default (gates / counters default to the back camera, the kiosk to the front one)
const facingKey = (fallback: Facing) => `tp.camera.facing.${fallback}`;
const loadFacing = (fallback: Facing): Facing => {
  try { const v = localStorage.getItem(facingKey(fallback)); return v === 'user' || v === 'environment' ? v : fallback; } catch { return fallback; }
};

/** Native BarcodeDetector (Chrome / Android / recent Safari) is far faster and more tolerant than the JS decoder. */
async function nativeDetector(): Promise<any | null> {
  const BD = (window as any).BarcodeDetector;
  if (!BD) return null;
  try {
    const supported: string[] = await BD.getSupportedFormats();
    const formats = NATIVE_FORMATS.filter((f) => supported.includes(f));
    return formats.length ? new BD({ formats }) : null;
  } catch { return null; }
}

/**
 * Continuous camera scanner (QR, Code128/39/93, EAN/UPC, ITF, Codabar, DataMatrix, PDF417).
 * Starts on the back camera (or the remembered choice); the flip button switches front/back and the choice is
 * remembered per device. After a read the scanner is LOCKED until `locked` becomes false again (the current
 * transaction finished), preventing duplicate scans of the same code.
 */
export function CameraScanner({ onScan, locked = false, className, overlay = true, facing: initialFacing = 'environment' }: {
  onScan: (code: string) => void; locked?: boolean; className?: string; overlay?: boolean; facing?: Facing;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const lockedRef = useRef(locked);
  const cb = useRef(onScan);
  cb.current = onScan;
  lockedRef.current = locked;
  const [facing, setFacing] = useState<Facing>(() => loadFacing(initialFacing));
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const last = useRef<{ code: string; at: number } | null>(null);

  const flip = () => setFacing((f) => {
    const next = f === 'environment' ? 'user' : 'environment';
    try { localStorage.setItem(facingKey(initialFacing), next); } catch { /* private mode */ }
    return next;
  });

  useEffect(() => {
    let cancelled = false;
    let stream: MediaStream | null = null;
    let timer: number | undefined;
    setReady(false);

    const emit = (raw: string) => {
      const code = raw.trim();
      if (!code || lockedRef.current) return;
      const now = Date.now();
      if (last.current && last.current.code === code && now - last.current.at < 3000) return;
      last.current = { code, at: now };
      lockedRef.current = true; // lock immediately until the parent releases
      navigator.vibrate?.(60);
      cb.current(code);
    };

    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error(window.isSecureContext ? 'Camera not supported' : 'Camera needs HTTPS');
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: facing }, width: { ideal: 1280 }, height: { ideal: 720 } },
        });
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        const track = stream.getVideoTracks()[0];
        // continuous autofocus where the camera supports it (Android)
        try { await track.applyConstraints({ advanced: [{ focusMode: 'continuous' } as any] }); } catch { /* unsupported */ }
        const el = video.current!;
        el.srcObject = stream;
        await el.play().catch(() => undefined);
        setError(null);
        setReady(true);

        const native = await nativeDetector();
        if (native) {
          const tick = async () => {
            if (cancelled) return;
            if (!lockedRef.current && el.readyState >= 2) {
              try { const found = await native.detect(el); if (found?.[0]?.rawValue) emit(found[0].rawValue); } catch { /* frame not ready */ }
            }
            timer = window.setTimeout(tick, 100);
          };
          tick();
        } else {
          const hints = new Map();
          hints.set(DecodeHintType.POSSIBLE_FORMATS, FORMATS);
          hints.set(DecodeHintType.TRY_HARDER, true);
          const reader = new BrowserMultiFormatReader(hints);
          const canvas = document.createElement('canvas');
          const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
          const tick = () => {
            if (cancelled) return;
            if (!lockedRef.current && el.readyState >= 2 && el.videoWidth) {
              // decode a bounded-size copy of the frame: faster on phones, still sharp enough for 1D barcodes
              const scale = Math.min(1, 1024 / el.videoWidth);
              canvas.width = Math.round(el.videoWidth * scale); canvas.height = Math.round(el.videoHeight * scale);
              ctx.drawImage(el, 0, 0, canvas.width, canvas.height);
              try { emit(reader.decodeFromCanvas(canvas).getText()); } catch { /* nothing found in this frame */ }
            }
            timer = window.setTimeout(tick, 150);
          };
          tick();
        }
      } catch (e: any) {
        if (cancelled) return;
        setError(e?.name === 'NotAllowedError' ? 'Camera permission denied — allow camera access in the browser'
          : e?.name === 'NotFoundError' || e?.name === 'OverconstrainedError' ? 'No camera found' : e?.message ?? 'Camera unavailable');
      }
    })();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [facing]);

  return (
    <div className={cx('relative overflow-hidden bg-black', className)}>
      <video ref={video} className={cx('h-full w-full object-cover', facing === 'user' && '-scale-x-100')} muted playsInline autoPlay />
      {overlay && !error && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className={cx('relative aspect-square w-[62%] max-w-[420px] rounded-3xl border-4 transition', locked ? 'border-white/30' : 'border-white/90')}>
            {!locked && ready && <div className="scanline absolute left-3 right-3 h-0.5 bg-emerald-400 shadow-[0_0_12px_2px_rgba(52,211,153,0.9)]" />}
          </div>
        </div>
      )}
      {error && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-4 text-center text-white/80">
          <CameraOff className="h-10 w-10" /><div className="text-sm">{error}</div><div className="text-xs text-white/50">USB / 2D scanners still work</div>
        </div>
      )}
      <button type="button" onClick={flip} title={facing === 'environment' ? 'Switch to front camera' : 'Switch to back camera'}
        className="absolute right-3 top-3 flex items-center gap-1.5 rounded-full bg-black/60 px-3 py-2 text-xs font-semibold text-white backdrop-blur hover:bg-black/80">
        <SwitchCamera className="h-5 w-5" />{facing === 'environment' ? 'Back camera' : 'Front camera'}
      </button>
    </div>
  );
}
