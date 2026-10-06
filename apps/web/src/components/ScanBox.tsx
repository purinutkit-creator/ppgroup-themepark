import { useState } from 'react';
import { Camera, ScanLine } from 'lucide-react';
import { Button, Input, Modal, cx } from './ui';
import { CameraScanner } from './CameraScanner';
import { useKeyboardScanner } from '../lib/scanner';

/**
 * Universal credential input for staff screens: USB/2D scanner (keyboard wedge, global),
 * manual entry of printed code / barcode, or device camera.
 */
export function ScanBox({ onScan, placeholder = 'Scan card / wristband / QR or type code', busy, autoFocus, className, global = true, compact }: {
  onScan: (code: string) => void; placeholder?: string; busy?: boolean; autoFocus?: boolean; className?: string; global?: boolean; compact?: boolean;
}) {
  const [value, setValue] = useState('');
  const [camera, setCamera] = useState(false);
  useKeyboardScanner((c) => onScan(c), { enabled: global && !busy });
  const submit = () => { const v = value.trim(); if (v) { onScan(v); setValue(''); } };
  return (
    <div className={cx('flex gap-2', className)}>
      <div className="relative flex-1">
        <ScanLine className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <Input value={value} onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} placeholder={placeholder}
          autoFocus={autoFocus} className={cx('pl-9', compact ? '' : 'py-2.5')} disabled={busy} />
      </div>
      <Button variant="outline" onClick={submit} disabled={busy || !value.trim()}>{compact ? 'Go' : 'Lookup'}</Button>
      <Button variant="outline" onClick={() => setCamera(true)} icon={<Camera className="h-4 w-4" />} title="Camera">{compact ? '' : 'Camera'}</Button>
      <Modal open={camera} onClose={() => setCamera(false)} title="Scan with camera" size="md">
        <CameraScanner className="aspect-square w-full rounded-xl" onScan={(c) => { setCamera(false); onScan(c); }} />
      </Modal>
    </div>
  );
}
