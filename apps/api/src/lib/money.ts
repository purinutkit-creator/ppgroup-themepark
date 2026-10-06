/** Amounts are integer satang. */
export const toSatang = (baht: number) => Math.round(baht * 100);
export const fmtTHB = (satang: number) => `฿${(satang / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const pct = (amount: number, percent: number) => Math.round((amount * percent) / 100);
