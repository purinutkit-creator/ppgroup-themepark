import { useState } from 'react';
import { CreditCard, Link2 } from 'lucide-react';
import { sapi, errorMessage } from '../lib/api';
import { Button, Input, Modal, toast } from './ui';
import { CameraScanner } from './CameraScanner';

/**
 * "Link card": scan a card the customer already holds (pre-printed park card, wristband, or any outside card with a
 * barcode / QR / number) and attach it to the member. From then on that card works at gates, rides, POS and lockers.
 */
export function LinkCardDialog({ memberId, open, onClose, onLinked }: {
  memberId: string; open: boolean; onClose: () => void; onLinked?: (r: { created: boolean; credential: any }) => void;
}) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const link = async (raw: string) => {
    const scan = raw.trim();
    if (!scan || busy) return;
    setBusy(true);
    try {
      const r = await sapi.post(`/api/members/${memberId}/link-card`, { scan });
      toast.success(r.created ? `Card registered and linked: ${r.credential.physicalSerial}` : `Card ${r.credential.code} linked to member`);
      setValue('');
      onLinked?.(r);
      onClose();
    } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  };
  return (
    <Modal open={open} onClose={onClose} title="Link card" size="md" footer={<Button onClick={() => link(value)} loading={busy} disabled={!value.trim()} icon={<Link2 className="h-4 w-4" />}>Link card</Button>}>
      <div className="space-y-3">
        <p className="text-sm text-slate-600">Scan the customer's card with the camera or a USB scanner, or type the number printed on the card.</p>
        {open && <CameraScanner className="aspect-video w-full rounded-xl" onScan={link} locked={busy} />}
        <div className="relative">
          <CreditCard className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input className="pl-9" autoFocus value={value} placeholder="Card number / barcode" onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && link(value)} disabled={busy} />
        </div>
      </div>
    </Modal>
  );
}

export function LinkCardButton({ memberId, onLinked, size = 'sm', variant = 'outline', block }: {
  memberId: string; onLinked?: (r: { created: boolean; credential: any }) => void; size?: 'sm' | 'md' | 'lg'; variant?: any; block?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size={size} variant={variant} block={block} icon={<Link2 className="h-4 w-4" />} onClick={() => setOpen(true)}>Link card</Button>
      <LinkCardDialog memberId={memberId} open={open} onClose={() => setOpen(false)} onLinked={onLinked} />
    </>
  );
}
