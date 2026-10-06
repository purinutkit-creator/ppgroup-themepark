import { useQuery } from '@tanstack/react-query';
import { papi } from '../../lib/api';
import { useT, useLang } from '../../lib/i18n';
import { thb } from '../../lib/format';
import { Badge, Loading } from '../../components/ui';

export function RideStatusPublic() {
  const t = useT();
  const lang = useLang((s) => s.lang);
  const branches = useQuery({ queryKey: ['pub-branches'], queryFn: () => papi.get('/api/public/branches') });
  const id = branches.data?.[0]?.id;
  const rides = useQuery({ queryKey: ['pub-rides', id], queryFn: () => papi.get(`/api/public/rides?branchId=${id}`), enabled: !!id, refetchInterval: 30_000 });
  if (rides.isLoading) return <Loading />;
  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <h1 className="mb-4 text-2xl font-bold">{t('rideStatus')}</h1>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {rides.data?.map((r: any) => (
          <div key={r.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-start justify-between gap-2"><div className="font-bold">{lang === 'th' ? r.name : r.name_en ?? r.name}</div><Badge>{r.entry_paused ? 'PAUSED' : r.status}</Badge></div>
            <div className="text-xs text-slate-500">{r.zone_name}</div>
            <div className="mt-2 flex flex-wrap gap-1 text-xs">
              {r.min_height_cm && <Badge tone="gray">≥ {r.min_height_cm} cm</Badge>}{r.min_age && <Badge tone="gray">{r.min_age}+ yrs</Badge>}
              {r.addon_price > 0 && <Badge tone="brand">Add-on {thb(r.addon_price)}</Badge>}
            </div>
            {r.status === 'OPEN' && <div className="mt-3 text-2xl font-black text-brand-700">{r.wait_min} <span className="text-sm font-medium text-slate-500">{t('minutes')}</span></div>}
          </div>
        ))}
      </div>
    </div>
  );
}
