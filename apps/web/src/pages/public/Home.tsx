import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { CalendarCheck, CreditCard, FerrisWheel, QrCode, ShoppingBag, Utensils, Wallet } from 'lucide-react';
import { papi } from '../../lib/api';
import { useT } from '../../lib/i18n';
import { thb0 } from '../../lib/format';
import { Badge } from '../../components/ui';

export function Home() {
  const t = useT();
  const branches = useQuery({ queryKey: ['pub-branches'], queryFn: () => papi.get('/api/public/branches') });
  const branchId = branches.data?.[0]?.id;
  const pkgs = useQuery({ queryKey: ['pub-pkgs', branchId], queryFn: () => papi.get(`/api/public/packages?branchId=${branchId}`), enabled: !!branchId });
  const occ = useQuery({ queryKey: ['pub-occ', branchId], queryFn: () => papi.get(`/api/public/occupancy?branchId=${branchId}`), enabled: !!branchId, refetchInterval: 60_000 });
  const steps = [
    { icon: CalendarCheck, th: 'จอง', en: 'BOOK' }, { icon: CreditCard, th: 'จ่าย', en: 'PAY' }, { icon: QrCode, th: 'สแกน', en: 'SCAN' }, { icon: FerrisWheel, th: 'เล่น', en: 'PLAY' },
    { icon: Utensils, th: 'กิน', en: 'EAT' }, { icon: ShoppingBag, th: 'ช้อป', en: 'SHOP' }, { icon: Wallet, th: 'แลก', en: 'REDEEM' },
  ];
  return (
    <div>
      <section className="mx-auto grid max-w-6xl items-center gap-8 px-4 py-12 md:grid-cols-2 md:py-20">
        <div>
          <Badge tone="brand">{t('tagline')}</Badge>
          <h1 className="mt-4 text-4xl font-extrabold leading-tight text-slate-900 md:text-5xl">{t('appName')}</h1>
          <p className="mt-4 text-lg text-slate-600">บัตรเดียว ใช้ได้ทุกอย่าง — เข้าสวนสนุก เล่นเครื่องเล่น จ่ายค่าอาหาร ช้อปปิ้ง ล็อกเกอร์ และสะสมแต้ม<br /><span className="text-base text-slate-500">One card for admission, rides, food, shopping, lockers and rewards.</span></p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link to="/book" className="rounded-xl bg-brand-600 px-6 py-3 text-lg font-semibold text-white shadow-lg shadow-brand-600/30 hover:bg-brand-700">{t('bookNow')}</Link>
            <Link to="/membership" className="rounded-xl border border-slate-300 bg-white px-6 py-3 text-lg font-semibold text-slate-700 hover:bg-slate-50">{t('membership')}</Link>
          </div>
          {occ.data && <div className="mt-4 text-sm text-slate-500">Today: <Badge tone={occ.data.level === 'CROWDED' ? 'red' : occ.data.level === 'BUSY' ? 'amber' : 'green'}>{occ.data.level}</Badge></div>}
        </div>
        <div className="relative">
          <div className="absolute -inset-4 rounded-[2rem] bg-gradient-to-br from-brand-400 to-fuchsia-400 opacity-30 blur-2xl" />
          <div className="relative grid grid-cols-4 gap-3 rounded-[2rem] bg-white p-6 shadow-xl">
            {steps.map((s, i) => (
              <div key={s.en} className="flex flex-col items-center gap-1 rounded-2xl bg-slate-50 p-3 text-center">
                <s.icon className="h-7 w-7 text-brand-600" /><div className="text-xs font-bold">{s.en}</div><div className="text-[11px] text-slate-500">{s.th}</div>
                {i < steps.length - 1 && <span className="sr-only">→</span>}
              </div>
            ))}
            <div className="col-span-4 mt-2 text-center text-xs text-slate-500">BOOK → PAY → SCAN → ENTER → PLAY → BUY → EAT → SHOP → REDEEM → EXIT</div>
          </div>
        </div>
      </section>
      <section className="mx-auto max-w-6xl px-4 pb-16">
        <h2 className="mb-4 text-2xl font-bold">{t('selectPackage')}</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {pkgs.data?.slice(0, 6).map((p: any) => {
            const from = p.pricing_mode === 'BUNDLE' ? p.bundle_price : Math.min(...p.prices.map((x: any) => x.price));
            return (
              <Link to={`/book?package=${p.id}`} key={p.id} className="group rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-lg">
                <div className="flex items-start justify-between"><div className="text-lg font-bold">{p.name}</div><Badge tone="brand">{p.category.replace('_', ' ')}</Badge></div>
                <div className="mt-1 text-sm text-slate-500">{p.description ?? p.name_en}</div>
                <div className="mt-3 text-sm text-slate-600">{p.ride_access === 'ALL' ? '✓ ALL RIDES' : p.ride_access === 'NONE' ? 'Admission only' : `✓ ${p.rides.length} rides`}</div>
                <div className="mt-4 text-2xl font-extrabold text-brand-700">{Number.isFinite(from) ? `${thb0(from)}+` : '-'}</div>
              </Link>
            );
          })}
        </div>
      </section>
    </div>
  );
}
