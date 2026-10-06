import { useEffect, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../lib/auth';
import { sapi } from '../../lib/api';

/** Device screens authenticate with a device API key (Device Setup) or a staff login. */
export function DeviceGuard({ children, need }: { children: ReactNode; need: string }) {
  const { deviceKey, staffToken } = useAuth();
  useEffect(() => {
    if (!deviceKey) return;
    const beat = () => sapi.post('/api/devices/heartbeat', { firmware: 'web-1.0' }).catch(() => {});
    beat();
    const i = setInterval(beat, 30_000);
    return () => clearInterval(i);
  }, [deviceKey]);
  if (!deviceKey && !staffToken) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 bg-slate-900 p-6 text-center text-white">
        <div className="text-2xl font-bold">Device not configured</div>
        <div className="text-white/60">This screen requires a device key ({need}) or a staff login.</div>
        <div className="flex gap-2">
          <Link to={`/device-setup?next=${encodeURIComponent(location.pathname)}`} className="rounded-lg bg-brand-600 px-4 py-2 font-semibold">Device setup</Link>
          <Link to={`/staff/login?next=${encodeURIComponent(location.pathname)}`} className="rounded-lg bg-white/10 px-4 py-2 font-semibold">Staff login</Link>
        </div>
      </div>
    );
  }
  return <>{children}</>;
}
