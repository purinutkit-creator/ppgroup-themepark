export const thb = (satang: number | null | undefined, opts: { sign?: boolean } = {}) => {
  const v = Number(satang ?? 0) / 100;
  const s = v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${opts.sign && v > 0 ? '+' : ''}฿${s}`;
};
export const thb0 = (satang: number | null | undefined) => `฿${Math.round(Number(satang ?? 0) / 100).toLocaleString('en-US')}`;
export const toSatang = (baht: string | number) => Math.round(Number(baht || 0) * 100);
export const fmtDate = (d?: string | Date | null) => (d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Bangkok' }) : '-');
export const fmtDateTime = (d?: string | Date | null) => (d ? new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok' }) : '-');
export const fmtTime = (d?: string | Date | null) => (d ? new Date(d).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Asia/Bangkok' }) : '-');
export const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(new Date());
export const addDays = (date: string, n: number) => { const d = new Date(`${date}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
export const num = (n: number | null | undefined) => Number(n ?? 0).toLocaleString('en-US');
