import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { papi } from './api';
import { useTextSize, type TextSurface } from './textSize';

export interface PublicConfig {
  park: { name: string; logoUrl: string | null; currency: string; defaultLanguage: string; languages: string[]; supportPhone: string };
  fonts: Record<'customer' | 'admin' | 'pos' | 'kiosk' | 'gate' | 'receipt' | 'ticket', string>;
  display?: { staffLanguage?: 'th' | 'en'; textSize?: Partial<Record<TextSurface, number>> };
  customFonts: Array<{ family: string; url: string }>;
  paymentMethods: Array<{ method: string; online: boolean; counter: boolean }>;
  booking: { payAtParkEnabled: boolean; maxGuests: number; advanceDays: number; guestCheckout: boolean };
  wallet: { topupPresets: number[]; minTopup: number; maxTopup: number };
  simulator: boolean;
}

export function usePublicConfig() {
  return useQuery({ queryKey: ['public-config'], queryFn: () => papi.get<PublicConfig>('/api/public/config'), staleTime: 60_000 });
}

const textSurface = (s: string): TextSurface => (['customer', 'admin', 'pos', 'kiosk', 'gate'].includes(s) ? s : 'customer') as TextSurface;

const loaded = new Set<string>();
/** Apply the admin-selected font for a surface (Google Font or uploaded custom font). */
export function useSurfaceFont(surface: keyof PublicConfig['fonts']) {
  const { data } = usePublicConfig();
  useEffect(() => {
    if (!data) return;
    const family = data.fonts[surface];
    const custom = data.customFonts.find((f) => f.family === family);
    if (custom && !loaded.has(family)) {
      const style = document.createElement('style');
      style.textContent = `@font-face { font-family: "${family}"; src: url("${custom.url}"); font-display: swap; }`;
      document.head.appendChild(style);
      loaded.add(family);
    } else if (!custom && family && !loaded.has(family) && !['Prompt', 'Kanit', 'Sarabun', 'IBM Plex Sans Thai'].includes(family)) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family)}:wght@400;500;600;700&display=swap`;
      document.head.appendChild(link);
      loaded.add(family);
    }
    document.documentElement.style.setProperty('--font-main', `"${family}"`);
  }, [data, surface]);

  // text size: admin setting (per surface) × this device's own adjustment; everything is rem-based, so the root size scales the UI
  const ts = textSurface(surface);
  const local = useTextSize((s) => s.adjust[ts] ?? 100);
  const admin = data?.display?.textSize?.[ts] ?? 100;
  useEffect(() => {
    useTextSize.setState({ current: ts });
    const pct = Math.min(250, Math.max(60, (admin * local) / 100));
    document.documentElement.style.fontSize = `${(16 * pct) / 100}px`;
  }, [ts, admin, local]);
}
