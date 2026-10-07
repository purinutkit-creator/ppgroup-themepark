import { Link, NavLink, Outlet } from 'react-router-dom';
import { Globe, User } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { LANGS, useLang, useT } from '../lib/i18n';
import { usePublicConfig, useSurfaceFont } from '../lib/config';
import { TextSizeControl, cx } from '../components/ui';

export function PublicLayout() {
  useSurfaceFont('customer');
  const t = useT();
  const { lang, setLang } = useLang();
  const member = useAuth((s) => s.member);
  const cfg = usePublicConfig();
  const link = ({ isActive }: { isActive: boolean }) => cx('rounded-lg px-3 py-2 text-sm font-medium', isActive ? 'text-brand-700' : 'text-slate-600 hover:text-slate-900');
  return (
    <div className="flex min-h-full flex-col bg-gradient-to-b from-brand-50 via-white to-white">
      <header className="sticky top-0 z-30 border-b border-slate-200/70 bg-white/80 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-4">
          <Link to="/" className="flex items-center gap-2">
            {cfg.data?.park.logoUrl ? <img src={cfg.data.park.logoUrl} className="h-9" alt="logo" /> : <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-600 text-xl">🎡</span>}
            <span className="hidden font-bold text-slate-900 sm:block">{cfg.data?.park.name ?? t('appName')}</span>
          </Link>
          <nav className="ml-4 hidden items-center md:flex">
            <NavLink to="/book" className={link}>{t('buyTickets')}</NavLink>
            <NavLink to="/membership" className={link}>{t('membership')}</NavLink>
            <NavLink to="/rides-status" className={link}>{t('rides')}</NavLink>
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <TextSizeControl className="hidden md:inline-flex" />
            <div className="relative flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1">
              <Globe className="h-4 w-4 text-slate-400" />
              <select value={lang} onChange={(e) => setLang(e.target.value as any)} className="bg-transparent text-sm outline-none">
                {LANGS.map((l) => <option key={l.code} value={l.code}>{l.flag} {l.label}</option>)}
              </select>
            </div>
            {member ? (
              <Link to="/account" className="flex items-center gap-2 rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white"><User className="h-4 w-4" />{member.firstName}</Link>
            ) : (
              <>
                <Link to="/login" className="rounded-lg px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100">{t('login')}</Link>
                <Link to="/register" className="hidden rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white sm:block">{t('register')}</Link>
              </>
            )}
          </div>
        </div>
        <nav className="flex items-center justify-center gap-1 border-t border-slate-100 md:hidden">
          <NavLink to="/book" className={link}>{t('buyTickets')}</NavLink>
          <NavLink to="/membership" className={link}>{t('membership')}</NavLink>
          <NavLink to="/rides-status" className={link}>{t('rides')}</NavLink>
        </nav>
      </header>
      <main className="flex-1"><Outlet /></main>
      <footer className="border-t border-slate-200 bg-white py-6 text-center text-xs text-slate-500">
        {cfg.data?.park.name} · {t('tagline')} · <Link to="/staff/login" className="hover:text-slate-700">Staff</Link>
      </footer>
    </div>
  );
}
