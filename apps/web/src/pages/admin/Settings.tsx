import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Upload } from 'lucide-react';
import { sapi, errorMessage } from '../../lib/api';
import { useBranchId } from '../../lib/auth';
import { LANGS, useLang } from '../../lib/i18n';
import { Button, Card, Field, Input, Loading, PageHeader, Select, Tabs, Toggle, cx, toast } from '../../components/ui';

const LABELS: Record<string, string> = {
  'park.info': 'Park information & language', display: 'Language & text size', capacity: 'Park capacity', gate: 'Gate', wallet: 'Wallet policy', points: 'Member points', approvals: 'Manager approval',
  offline: 'Offline handling', payments: 'Payment methods', booking: 'Booking', queue: 'Queue', ride: 'Ride pricing (peak)', membership: 'Membership', wristband: 'Wristband',
  shift: 'Shift', inventory: 'Inventory', receipt: 'Receipt', printer: 'Printer', fonts: 'Fonts', security: 'Security', promotions: 'Promotions',
};
const GOOGLE_FONTS = ['IBM Plex Sans Thai', 'Prompt', 'Kanit', 'Sarabun', 'Noto Sans Thai', 'Mitr', 'Chakra Petch', 'Bai Jamjuree', 'Inter', 'Roboto', 'Noto Sans SC'];
const MONEY_KEYS = /(^min|^max|Topup|Balance|Amount|earnAmount|redeemValue|overShortTolerance|Presets)/;

export function Settings() {
  const branchId = useBranchId();
  const qc = useQueryClient();
  const [scope, setScope] = useState<'global' | 'branch'>('global');
  const q = useQuery({ queryKey: ['settings', scope, branchId], queryFn: () => sapi.get(`/api/admin/settings?scope=${scope}${scope === 'branch' && branchId ? `&branchId=${branchId}` : ''}`) });
  const [key, setKey] = useState('park.info');
  const [draft, setDraft] = useState<any>(null);
  const fonts = useQuery({ queryKey: ['public-config'], queryFn: () => sapi.get('/api/public/config') });
  useEffect(() => { if (q.data) setDraft(structuredClone(q.data.settings[key])); }, [q.data, key]);
  if (!q.data || !draft) return <Loading />;
  const save = async () => {
    try { await sapi.put(`/api/admin/settings/${key}`, { value: draft, branchId: scope === 'branch' ? branchId : null }); toast.success('Settings saved'); qc.invalidateQueries({ queryKey: ['settings'] }); qc.invalidateQueries({ queryKey: ['public-config'] }); }
    catch (e) { toast.error(errorMessage(e)); }
  };
  const fontOptions = [...GOOGLE_FONTS, ...(fonts.data?.customFonts ?? []).map((f: any) => f.family)];
  return (
    <div className="space-y-4">
      <PageHeader title="System Settings" subtitle="Dynamic configuration — no code changes required" actions={<Tabs value={scope} onChange={setScope} tabs={[{ value: 'global', label: 'Global defaults' }, { value: 'branch', label: 'This branch override' }]} />} />
      <div className="grid gap-4 lg:grid-cols-[240px_1fr]">
        <Card padded={false} className="h-fit">{q.data.keys.map((k: string) => <button key={k} onClick={() => setKey(k)} className={cx('block w-full border-b border-slate-100 px-4 py-2 text-left text-sm last:border-0', key === k ? 'bg-brand-50 font-semibold text-brand-700' : 'hover:bg-slate-50')}>{LABELS[k] ?? k}</button>)}</Card>
        <Card title={LABELS[key] ?? key} actions={<Button onClick={save}>Save</Button>}>
          {key === 'display' ? <DisplayEditor value={draft} onChange={setDraft} /> : key === 'fonts' ? (
            <div className="space-y-3">
              {Object.keys(draft).map((surface) => (
                <Field key={surface} label={`${surface} font`}><Select value={draft[surface]} onChange={(e) => setDraft({ ...draft, [surface]: e.target.value })} style={{ fontFamily: draft[surface] }}>{fontOptions.map((f) => <option key={f} style={{ fontFamily: f }}>{f}</option>)}</Select></Field>
              ))}
              <FontUpload onDone={() => qc.invalidateQueries({ queryKey: ['public-config'] })} />
            </div>
          ) : <ObjectEditor value={draft} onChange={setDraft} path={key} />}
          {key === 'park.info' && <div className="mt-4 rounded-lg bg-slate-50 p-3 text-sm">Kiosk language buttons: {LANGS.map((l) => l.label).join(' · ')}. Default language for this browser: <LangPicker /></div>}
          <div className="mt-4 text-xs text-slate-400">Money values are in satang (1 THB = 100). Branch overrides merge on top of global defaults.</div>
        </Card>
      </div>
    </div>
  );
}

const TEXT_SURFACES: Array<[string, string]> = [
  ['admin', 'Back office'], ['pos', 'POS & kitchen'], ['customer', 'Customer website & portal'], ['kiosk', 'Kiosk & ride scanners'], ['gate', 'Gate displays'],
];
function DisplayEditor({ value, onChange }: { value: any; onChange: (v: any) => void }) {
  const sizes = value.textSize ?? {};
  return (
    <div className="space-y-5">
      <Field label="Staff screens language" className="max-w-xs">
        <Select value={value.staffLanguage ?? 'th'} onChange={(e) => onChange({ ...value, staffLanguage: e.target.value })} data-no-tr>
          <option value="th">ไทย (Thai)</option><option value="en">English</option>
        </Select>
      </Field>
      <div>
        <div className="mb-2 text-sm font-semibold">Text size (%)</div>
        <div className="space-y-3">
          {TEXT_SURFACES.map(([k, label]) => {
            const v = sizes[k] ?? 100;
            return (
              <div key={k} className="grid items-center gap-2 sm:grid-cols-[220px_1fr_64px]">
                <span className="text-sm text-slate-600">{label}</span>
                <input type="range" min={70} max={160} step={5} value={v} onChange={(e) => onChange({ ...value, textSize: { ...sizes, [k]: Number(e.target.value) } })} className="accent-brand-600" />
                <span className="text-right font-mono text-sm font-semibold">{v}%</span>
              </div>
            );
          })}
        </div>
        <div className="mt-3 rounded-lg bg-slate-50 p-3">
          <div className="text-xs text-slate-500">Preview</div>
          <div style={{ fontSize: `${(sizes.admin ?? 100) / 100}rem` }}>ตัวอย่างข้อความ Sample text 123</div>
        </div>
        <p className="mt-2 text-xs text-slate-500">Default for every device; each person can still switch TH / EN and A− / A+ in the top bar.</p>
      </div>
    </div>
  );
}

function LangPicker() { const { lang, setLang } = useLang(); return <select value={lang} onChange={(e) => setLang(e.target.value as any)} className="rounded border px-1">{LANGS.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}</select>; }

function ObjectEditor({ value, onChange, path }: { value: any; onChange: (v: any) => void; path: string }) {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {Object.entries(value).map(([k, v]) => {
        const set = (nv: any) => onChange({ ...value, [k]: nv });
        const label = /^[A-Z0-9_]+$/.test(k) ? k : k.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase());
        if (typeof v === 'boolean') return <div key={k} className="flex items-end pb-1"><Toggle checked={v} onChange={set} label={label} /></div>;
        if (typeof v === 'number') return <Field key={k} label={`${label}${MONEY_KEYS.test(k) ? ' (satang)' : ''}`}><Input type="number" value={v} onChange={(e) => set(Number(e.target.value))} /></Field>;
        if (Array.isArray(v)) return <Field key={k} label={`${label} (comma separated)`} className="md:col-span-2"><Input value={v.join(', ')} onChange={(e) => set(e.target.value.split(',').map((x) => x.trim()).filter(Boolean).map((x) => (typeof v[0] === 'number' || /^\d+$/.test(x) && typeof v[0] !== 'string' ? Number(x) : x)))} /></Field>;
        if (v && typeof v === 'object') return <div key={k} className="rounded-xl border border-slate-200 p-3 md:col-span-2"><div className="mb-2 text-xs font-bold uppercase text-slate-500">{label}</div><ObjectEditor value={v} onChange={set} path={`${path}.${k}`} /></div>;
        return <Field key={k} label={label}><Input value={String(v ?? '')} onChange={(e) => set(e.target.value || null)} /></Field>;
      })}
    </div>
  );
}

function FontUpload({ onDone }: { onDone: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [family, setFamily] = useState('');
  return (
    <div className="rounded-xl border border-dashed border-slate-300 p-3">
      <div className="mb-2 text-sm font-semibold">Upload custom font (TTF / OTF / WOFF / WOFF2)</div>
      <div className="flex flex-wrap gap-2"><Input type="file" accept=".ttf,.otf,.woff,.woff2" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="w-auto" /><Input placeholder="Font family name" value={family} onChange={(e) => setFamily(e.target.value)} className="w-56" />
        <Button variant="outline" icon={<Upload className="h-4 w-4" />} disabled={!file} onClick={async () => {
          const form = new FormData(); form.append('family', family || file!.name.replace(/\.\w+$/, '')); form.append('font', file!);
          try { await sapi.upload('/api/admin/fonts', form); toast.success('Font uploaded'); onDone(); } catch (e) { toast.error(errorMessage(e)); }
        }}>Upload</Button></div>
    </div>
  );
}
