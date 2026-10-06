import { clsx } from 'clsx';
import { create } from 'zustand';
import { AlertTriangle, CheckCircle2, Info, Loader2, X, XCircle } from 'lucide-react';
import { forwardRef, useEffect, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';

export const cx = clsx;

// --------------------------------------------------------------- Button
type Variant = 'primary' | 'secondary' | 'danger' | 'success' | 'ghost' | 'warning' | 'outline';
const variants: Record<Variant, string> = {
  primary: 'bg-brand-600 text-white hover:bg-brand-700 shadow-sm',
  secondary: 'bg-slate-100 text-slate-800 hover:bg-slate-200',
  outline: 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50',
  danger: 'bg-rose-600 text-white hover:bg-rose-700 shadow-sm',
  success: 'bg-emerald-600 text-white hover:bg-emerald-700 shadow-sm',
  warning: 'bg-amber-500 text-white hover:bg-amber-600 shadow-sm',
  ghost: 'text-slate-600 hover:bg-slate-100',
};
const sizes = { xs: 'px-2 py-1 text-xs', sm: 'px-3 py-1.5 text-sm', md: 'px-4 py-2 text-sm', lg: 'px-5 py-3 text-base', xl: 'px-6 py-4 text-lg' };
export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> { variant?: Variant; size?: keyof typeof sizes; loading?: boolean; icon?: ReactNode; block?: boolean }
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(({ variant = 'primary', size = 'md', loading, icon, block, className, children, disabled, ...p }, ref) => (
  <button ref={ref} disabled={disabled || loading} className={cx('inline-flex items-center justify-center gap-2 rounded-lg font-medium transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50',
    variants[variant], sizes[size], block && 'w-full', className)} {...p}>
    {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : icon}
    {children}
  </button>
));

// --------------------------------------------------------------- Inputs
export function Field({ label, hint, error, children, className }: { label?: ReactNode; hint?: ReactNode; error?: string | null; children: ReactNode; className?: string }) {
  return (
    <label className={cx('block', className)}>
      {label && <span className="mb-1 block text-xs font-medium text-slate-600">{label}</span>}
      {children}
      {hint && !error && <span className="mt-1 block text-xs text-slate-400">{hint}</span>}
      {error && <span className="mt-1 block text-xs text-rose-600">{error}</span>}
    </label>
  );
}
const inputCls = 'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100 disabled:bg-slate-100';
export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(({ className, ...p }, ref) => <input ref={ref} className={cx(inputCls, className)} {...p} />);
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className, ...p }, ref) => <textarea ref={ref} className={cx(inputCls, className)} {...p} />);
export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(({ className, children, ...p }, ref) => (
  <select ref={ref} className={cx(inputCls, 'pr-8', className)} {...p}>{children}</select>
));
export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode; disabled?: boolean }) {
  return (
    <button type="button" disabled={disabled} onClick={() => onChange(!checked)} className="inline-flex items-center gap-2 text-sm disabled:opacity-50">
      <span className={cx('relative h-5 w-9 rounded-full transition', checked ? 'bg-brand-600' : 'bg-slate-300')}>
        <span className={cx('absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition', checked ? 'left-4' : 'left-0.5')} />
      </span>
      {label}
    </button>
  );
}

// --------------------------------------------------------------- Layout primitives
export function Card({ className, children, title, actions, padded = true }: { className?: string; children?: ReactNode; title?: ReactNode; actions?: ReactNode; padded?: boolean }) {
  return (
    <div className={cx('rounded-xl border border-slate-200 bg-white shadow-sm', className)}>
      {(title || actions) && (
        <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
          <div className="font-semibold text-slate-800">{title}</div>
          <div className="flex items-center gap-2">{actions}</div>
        </div>
      )}
      <div className={cx(padded && 'p-4')}>{children}</div>
    </div>
  );
}
export function PageHeader({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-bold text-slate-900 md:text-2xl">{title}</h1>
        {subtitle && <p className="text-sm text-slate-500">{subtitle}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-2">{actions}</div>
    </div>
  );
}
export function Stat({ label, value, sub, icon, tone = 'slate', onClick }: { label: ReactNode; value: ReactNode; sub?: ReactNode; icon?: ReactNode; tone?: 'slate' | 'brand' | 'emerald' | 'amber' | 'rose' | 'sky' | 'violet'; onClick?: () => void }) {
  const tones = { slate: 'bg-slate-100 text-slate-600', brand: 'bg-brand-100 text-brand-700', emerald: 'bg-emerald-100 text-emerald-700', amber: 'bg-amber-100 text-amber-700', rose: 'bg-rose-100 text-rose-700', sky: 'bg-sky-100 text-sky-700', violet: 'bg-violet-100 text-violet-700' };
  return (
    <div onClick={onClick} className={cx('rounded-xl border border-slate-200 bg-white p-4 shadow-sm', onClick && 'cursor-pointer hover:border-brand-300')}>
      <div className="flex items-start justify-between gap-2">
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</div>
        {icon && <div className={cx('rounded-lg p-2', tones[tone])}>{icon}</div>}
      </div>
      <div className="mt-1 text-2xl font-bold tabular-nums text-slate-900">{value}</div>
      {sub && <div className="mt-1 text-xs text-slate-500">{sub}</div>}
    </div>
  );
}

const badgeTones: Record<string, string> = {
  green: 'bg-emerald-100 text-emerald-700', red: 'bg-rose-100 text-rose-700', amber: 'bg-amber-100 text-amber-800', blue: 'bg-sky-100 text-sky-700',
  gray: 'bg-slate-100 text-slate-600', violet: 'bg-violet-100 text-violet-700', brand: 'bg-brand-100 text-brand-700', black: 'bg-slate-800 text-white',
};
const STATUS_TONE: Record<string, string> = {
  ACTIVE: 'green', PAID: 'green', CONFIRMED: 'green', OPEN: 'green', ONLINE: 'green', APPROVED: 'green', AUTO_APPROVED: 'green', GRANTED: 'green', COMPLETED: 'green', IDLE: 'green',
  AVAILABLE: 'green', READY: 'green', BOARDED: 'green', ISSUED: 'blue', CHECKED_IN: 'blue', INSIDE: 'blue', USED: 'gray', NEW: 'blue', SCANNING: 'blue', VALIDATING: 'blue',
  PENDING: 'amber', PENDING_PAYMENT: 'amber', RESERVED: 'amber', WAITING: 'amber', WAITING_APPROVAL: 'amber', PENDING_VERIFICATION: 'amber', WAITING_VERIFICATION: 'amber',
  PARTIALLY_PAID: 'amber', PREPARING: 'amber', CALLED: 'amber', MAINTENANCE: 'amber', TEMPORARILY_CLOSED: 'amber', SUSPENDED: 'amber', OCCUPIED: 'violet', OPENING: 'blue', CLOSING: 'blue',
  DENIED: 'red', CANCELLED: 'gray', EXPIRED: 'gray', REFUNDED: 'violet', PARTIALLY_REFUNDED: 'violet', VOID: 'red', FAILED: 'red', LOST: 'red', BLOCKED: 'red', ERROR: 'red', OFFLINE: 'red',
  CLOSED: 'gray', REPLACED: 'gray', OUTSIDE: 'gray', NO_SHOW: 'gray', REJECTED: 'red', EMERGENCY: 'red', NOT_INCLUDED: 'amber', UNPAID: 'amber', OUT_OF_SERVICE: 'gray', EXHAUSTED: 'gray',
};
export function Badge({ children, tone, className }: { children: ReactNode; tone?: string; className?: string }) {
  const t = tone ?? (typeof children === 'string' ? STATUS_TONE[children] : undefined) ?? 'gray';
  return <span className={cx('inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold', badgeTones[t] ?? badgeTones.gray, className)}>{typeof children === 'string' ? children.replaceAll('_', ' ') : children}</span>;
}

export function Spinner({ className }: { className?: string }) { return <Loader2 className={cx('h-5 w-5 animate-spin text-brand-600', className)} />; }
export function Loading({ label = 'Loading…' }: { label?: string }) {
  return <div className="flex items-center justify-center gap-2 p-10 text-sm text-slate-500"><Spinner />{label}</div>;
}
export function Empty({ title = 'No data', hint, icon }: { title?: ReactNode; hint?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1 p-10 text-center">
      <div className="text-slate-300">{icon ?? <Info className="h-8 w-8" />}</div>
      <div className="font-medium text-slate-600">{title}</div>
      {hint && <div className="text-sm text-slate-400">{hint}</div>}
    </div>
  );
}
export function ErrorBox({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
      <div className="flex items-center gap-2"><XCircle className="h-4 w-4" />{(error as Error)?.message ?? String(error)}</div>
      {onRetry && <Button size="sm" variant="outline" onClick={onRetry}>Retry</Button>}
    </div>
  );
}

export function Modal({ open, onClose, title, children, footer, size = 'md' }: { open: boolean; onClose: () => void; title?: ReactNode; children: ReactNode; footer?: ReactNode; size?: 'sm' | 'md' | 'lg' | 'xl' | 'full' }) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, onClose]);
  if (!open) return null;
  const w = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-3xl', xl: 'max-w-5xl', full: 'max-w-[96vw]' }[size];
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 p-0 backdrop-blur-sm sm:items-center sm:p-4" onMouseDown={onClose}>
      <div className={cx('pop flex max-h-[95vh] w-full flex-col rounded-t-2xl bg-white shadow-2xl sm:rounded-2xl', w)} onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
          <div className="text-lg font-semibold">{title}</div>
          <button onClick={onClose} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100"><X className="h-5 w-5" /></button>
        </div>
        <div className="overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange, className }: { tabs: Array<{ value: T; label: ReactNode; count?: number }>; value: T; onChange: (v: T) => void; className?: string }) {
  return (
    <div className={cx('flex gap-1 overflow-x-auto border-b border-slate-200', className)}>
      {tabs.map((t) => (
        <button key={t.value} onClick={() => onChange(t.value)} className={cx('whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition',
          value === t.value ? 'border-brand-600 text-brand-700' : 'border-transparent text-slate-500 hover:text-slate-800')}>
          {t.label}{t.count !== undefined && <span className="ml-1.5 rounded-full bg-slate-100 px-1.5 text-xs text-slate-600">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

export interface Column<T> { key: string; header: ReactNode; render?: (row: T) => ReactNode; className?: string; align?: 'left' | 'right' | 'center' }
export function Table<T extends Record<string, any>>({ columns, rows, onRowClick, empty, rowKey, dense }: { columns: Column<T>[]; rows: T[]; onRowClick?: (r: T) => void; empty?: ReactNode; rowKey?: (r: T) => string; dense?: boolean }) {
  if (!rows.length) return <Empty title={empty ?? 'No records'} />;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
            {columns.map((c) => <th key={c.key} className={cx('whitespace-nowrap px-3 py-2 font-semibold', c.align === 'right' && 'text-right', c.align === 'center' && 'text-center', c.className)}>{c.header}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={rowKey ? rowKey(r) : r.id ?? i} onClick={() => onRowClick?.(r)} className={cx('border-b border-slate-100 last:border-0', onRowClick && 'cursor-pointer hover:bg-slate-50')}>
              {columns.map((c) => <td key={c.key} className={cx('px-3', dense ? 'py-1.5' : 'py-2.5', c.align === 'right' && 'text-right tabular-nums', c.align === 'center' && 'text-center', c.className)}>
                {c.render ? c.render(r) : (r[c.key] ?? '-')}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// --------------------------------------------------------------- Toasts
interface Toast { id: number; kind: 'success' | 'error' | 'info' | 'warning'; text: string }
const useToasts = create<{ toasts: Toast[]; push: (t: Omit<Toast, 'id'>) => void; remove: (id: number) => void }>((set) => ({
  toasts: [],
  push: (t) => { const id = Date.now() + Math.random(); set((s) => ({ toasts: [...s.toasts, { ...t, id }] })); setTimeout(() => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })), t.kind === 'error' ? 6000 : 3500); },
  remove: (id) => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })),
}));
export const toast = {
  success: (text: string) => useToasts.getState().push({ kind: 'success', text }),
  error: (text: string) => useToasts.getState().push({ kind: 'error', text }),
  info: (text: string) => useToasts.getState().push({ kind: 'info', text }),
  warning: (text: string) => useToasts.getState().push({ kind: 'warning', text }),
};
export function Toaster() {
  const { toasts, remove } = useToasts();
  const icons = { success: <CheckCircle2 className="h-5 w-5 text-emerald-500" />, error: <XCircle className="h-5 w-5 text-rose-500" />, info: <Info className="h-5 w-5 text-sky-500" />, warning: <AlertTriangle className="h-5 w-5 text-amber-500" /> };
  return (
    <div className="pointer-events-none fixed right-3 top-3 z-[100] flex w-[min(380px,92vw)] flex-col gap-2">
      {toasts.map((t) => (
        <div key={t.id} className="pop pointer-events-auto flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-3 text-sm shadow-lg">
          {icons[t.kind]}<div className="flex-1">{t.text}</div>
          <button onClick={() => remove(t.id)} className="text-slate-400 hover:text-slate-600"><X className="h-4 w-4" /></button>
        </div>
      ))}
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) { return <kbd className="rounded border border-slate-300 bg-slate-50 px-1.5 text-xs text-slate-600">{children}</kbd>; }
export function KV({ k, v, className }: { k: ReactNode; v: ReactNode; className?: string }) {
  return <div className={cx('flex items-center justify-between gap-3 py-1 text-sm', className)}><span className="text-slate-500">{k}</span><span className="text-right font-medium text-slate-800">{v}</span></div>;
}
