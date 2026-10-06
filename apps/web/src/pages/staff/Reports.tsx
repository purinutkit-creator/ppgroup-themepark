import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download, FileSpreadsheet, FileText } from 'lucide-react';
import { sapi, errorMessage, qs } from '../../lib/api';
import { useBranchId, useCan } from '../../lib/auth';
import { addDays, fmtDate, fmtDateTime, thb, today } from '../../lib/format';
import { Button, Card, Input, Loading, PageHeader, Table, cx, toast } from '../../components/ui';

export function Reports() {
  const branchId = useBranchId();
  const can = useCan();
  const list = useQuery({ queryKey: ['reports'], queryFn: () => sapi.get('/api/reports') });
  const [key, setKey] = useState('daily-sales');
  const [from, setFrom] = useState(addDays(today(), -6));
  const [to, setTo] = useState(today());
  const r = useQuery({ queryKey: ['report', key, branchId, from, to], queryFn: () => sapi.get(`/api/reports/${key}${qs({ branchId, from, to })}`), enabled: !!branchId });
  const exportAs = async (format: string) => {
    try {
      const res = await sapi.raw(`/api/reports/${key}${qs({ branchId, from, to, format })}`);
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement('a'); a.href = url; a.download = `${key}_${from}_${to}.${format}`; a.click(); URL.revokeObjectURL(url);
    } catch (e) { toast.error(errorMessage(e)); }
  };
  const fmt = (v: any, type?: string) => (v == null ? '-' : type === 'money' ? thb(v) : type === 'datetime' ? fmtDateTime(v) : type === 'date' ? fmtDate(v) : type === 'number' ? Number(v).toLocaleString() : String(v));
  return (
    <div className="grid gap-4 lg:grid-cols-[220px_1fr]">
      <Card padded={false} className="h-fit">
        {list.data?.map((x: any) => <button key={x.key} onClick={() => setKey(x.key)} className={cx('block w-full border-b border-slate-100 px-4 py-2 text-left text-sm last:border-0', key === x.key ? 'bg-brand-50 font-semibold text-brand-700' : 'hover:bg-slate-50')}>{x.title}</button>)}
      </Card>
      <div className="space-y-4">
        <PageHeader title={r.data?.title ?? 'Report'} actions={<>
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-auto" /><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-auto" />
          {can('report.export') && <><Button variant="outline" size="sm" icon={<FileText className="h-4 w-4" />} onClick={() => exportAs('pdf')}>PDF</Button>
            <Button variant="outline" size="sm" icon={<FileSpreadsheet className="h-4 w-4" />} onClick={() => exportAs('xlsx')}>Excel</Button>
            <Button variant="outline" size="sm" icon={<Download className="h-4 w-4" />} onClick={() => exportAs('csv')}>CSV</Button></>}
        </>} />
        <Card padded={false}>
          {r.isLoading ? <Loading /> : r.data && <>
            <Table dense rows={r.data.rows} columns={r.data.columns.map((c: any) => ({ key: c.key, header: c.label, align: ['money', 'number'].includes(c.type) ? 'right' : 'left', render: (row: any) => fmt(row[c.key], c.type) }))} />
            {r.data.totals && <div className="flex flex-wrap justify-end gap-6 border-t border-slate-200 p-3 text-sm">{Object.entries(r.data.totals).map(([k, v]) => {
              const col = r.data.columns.find((c: any) => c.key === k);
              return <div key={k}><span className="text-slate-500">{col?.label}: </span><b>{fmt(v, col?.type)}</b></div>;
            })}</div>}
          </>}
        </Card>
      </div>
    </div>
  );
}
