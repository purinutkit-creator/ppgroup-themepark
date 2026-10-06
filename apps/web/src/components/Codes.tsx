import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import JsBarcode from 'jsbarcode';

export function QR({ value, size = 200, className }: { value: string; size?: number; className?: string }) {
  const [src, setSrc] = useState<string>('');
  useEffect(() => {
    if (!value) return;
    QRCode.toDataURL(value, { errorCorrectionLevel: 'M', margin: 1, width: size * 2 }).then(setSrc).catch(() => setSrc(''));
  }, [value, size]);
  if (!src) return <div style={{ width: size, height: size }} className="animate-pulse rounded bg-slate-100" />;
  return <img src={src} width={size} height={size} alt="QR" className={className} style={{ imageRendering: 'pixelated' }} />;
}

export function Barcode({ value, height = 60, width = 2, className, displayValue = true }: { value: string; height?: number; width?: number; className?: string; displayValue?: boolean }) {
  const ref = useRef<SVGSVGElement>(null);
  useEffect(() => {
    if (!ref.current || !value) return;
    try { JsBarcode(ref.current, value, { format: 'CODE128', height, width, displayValue, margin: 4, fontSize: 14 }); } catch { /* invalid */ }
  }, [value, height, width, displayValue]);
  return <svg ref={ref} className={className} />;
}
