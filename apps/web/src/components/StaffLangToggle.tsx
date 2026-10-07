import { useStaffLang } from '../lib/staffI18n';
import { cx } from './ui';

/** TH / EN switch for staff screens (remembered on this device). */
export function StaffLangToggle({ className, dark }: { className?: string; dark?: boolean }) {
  const [lang, setLang] = useStaffLang();
  return (
    <div className={cx('inline-flex overflow-hidden rounded-lg border text-xs font-bold', dark ? 'border-white/20' : 'border-slate-200', className)} data-no-tr title="ภาษา / Language">
      {(['th', 'en'] as const).map((l) => (
        <button key={l} type="button" onClick={() => setLang(l)}
          className={cx('px-2 py-1 transition', lang === l ? 'bg-brand-600 text-white' : dark ? 'text-white/70 hover:bg-white/10' : 'text-slate-600 hover:bg-slate-100')}>
          {l === 'th' ? 'ไทย' : 'EN'}
        </button>
      ))}
    </div>
  );
}
