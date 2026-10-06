import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { papi, errorMessage } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useT } from '../../lib/i18n';
import { Button, Card, Field, Input, Select, toast } from '../../components/ui';

export function MemberAuth({ mode }: { mode: 'login' | 'register' | 'forgot' }) {
  const t = useT();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const next = params.get('next') ?? '/account';
  const setMember = useAuth((s) => s.setMember);
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState<Record<string, string>>({ gender: 'UNSPECIFIED' });
  const [otpSent, setOtpSent] = useState(false);
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value });
  const run = async (fn: () => Promise<void>) => { setBusy(true); try { await fn(); } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); } };

  const login = () => run(async () => {
    const r = await papi.post('/api/member/login', { identifier: f.identifier, password: f.password });
    setMember(r.token, r.member);
    nav(next);
  });
  const register = () => run(async () => {
    if (f.password !== f.password2) throw new Error('Passwords do not match');
    const r = await papi.post('/api/member/register', { phone: f.phone, firstName: f.firstName, lastName: f.lastName, birthday: f.birthday || null, email: f.email || null,
      password: f.password, gender: f.gender, address: f.address || null, emergencyContact: f.emergencyContact || null });
    setMember(r.token, { id: r.member.id, memberCode: r.member.member_code, firstName: r.member.first_name, lastName: r.member.last_name });
    toast.success(`Welcome! Member ID ${r.member.member_code}`);
    nav(next === '/account' ? '/membership' : next);
  });
  const forgot = () => run(async () => {
    if (!otpSent) {
      const r = await papi.post('/api/member/password/forgot', { identifier: f.identifier });
      setOtpSent(true);
      toast.success(r.devCode ? `OTP sent (dev code: ${r.devCode})` : 'OTP sent');
    } else {
      await papi.post('/api/member/password/reset', { identifier: f.identifier, code: f.code, newPassword: f.password });
      toast.success('Password reset — please log in');
      nav('/login');
    }
  });

  return (
    <div className="mx-auto max-w-md px-4 py-10">
      <Card title={mode === 'login' ? t('login') : mode === 'register' ? t('register') : t('forgotPassword')}>
        {mode === 'login' && (
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); login(); }}>
            <Field label={t('phoneOrEmail')}><Input value={f.identifier ?? ''} onChange={set('identifier')} autoFocus autoComplete="username" /></Field>
            <Field label={t('password')}><Input type="password" value={f.password ?? ''} onChange={set('password')} autoComplete="current-password" /></Field>
            <Button block size="lg" loading={busy} type="submit">{t('login')}</Button>
            <div className="flex justify-between text-sm"><Link to="/forgot" className="text-brand-600">{t('forgotPassword')}</Link><Link to={`/register?next=${encodeURIComponent(next)}`} className="text-brand-600">{t('register')}</Link></div>
          </form>
        )}
        {mode === 'register' && (
          <form className="grid gap-3 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); register(); }}>
            <Field label="First name *"><Input value={f.firstName ?? ''} onChange={set('firstName')} required /></Field>
            <Field label="Last name *"><Input value={f.lastName ?? ''} onChange={set('lastName')} required /></Field>
            <Field label={`${t('phone')} *`}><Input inputMode="tel" value={f.phone ?? ''} onChange={(e) => setF({ ...f, phone: e.target.value.replace(/[^\d+]/g, '') })} required /></Field>
            <Field label={t('email')}><Input type="email" value={f.email ?? ''} onChange={set('email')} /></Field>
            <Field label="Birthday"><Input type="date" value={f.birthday ?? ''} onChange={set('birthday')} /></Field>
            <Field label="Gender"><Select value={f.gender} onChange={set('gender')}><option value="UNSPECIFIED">-</option><option value="MALE">Male</option><option value="FEMALE">Female</option><option value="OTHER">Other</option></Select></Field>
            <Field label={`${t('password')} * (8+)`}><Input type="password" value={f.password ?? ''} onChange={set('password')} required minLength={8} autoComplete="new-password" /></Field>
            <Field label="Confirm password *"><Input type="password" value={f.password2 ?? ''} onChange={set('password2')} required /></Field>
            <Field label="Address (optional)" className="sm:col-span-2"><Input value={f.address ?? ''} onChange={set('address')} /></Field>
            <Field label="Emergency contact (optional)" className="sm:col-span-2"><Input value={f.emergencyContact ?? ''} onChange={set('emergencyContact')} /></Field>
            <Button block size="lg" loading={busy} type="submit" className="sm:col-span-2">{t('register')}</Button>
          </form>
        )}
        {mode === 'forgot' && (
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); forgot(); }}>
            <Field label={t('phoneOrEmail')}><Input value={f.identifier ?? ''} onChange={set('identifier')} disabled={otpSent} /></Field>
            {otpSent && <>
              <Field label="OTP code"><Input inputMode="numeric" value={f.code ?? ''} onChange={set('code')} maxLength={6} /></Field>
              <Field label="New password"><Input type="password" value={f.password ?? ''} onChange={set('password')} minLength={8} /></Field>
            </>}
            <Button block loading={busy} type="submit">{otpSent ? 'Reset password' : 'Send OTP'}</Button>
          </form>
        )}
      </Card>
    </div>
  );
}
