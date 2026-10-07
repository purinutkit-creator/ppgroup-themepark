import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type TextSurface = 'customer' | 'admin' | 'pos' | 'kiosk' | 'gate';

/** Per-device text size adjustment (A− / A+), multiplied with the admin setting for the surface. */
interface TextSizeState { adjust: Partial<Record<TextSurface, number>>; current: TextSurface; step: (d: number) => void; reset: () => void }
export const TEXT_STEPS = [80, 90, 100, 110, 125, 140, 160];
export const useTextSize = create<TextSizeState>()(persist((set, get) => ({
  adjust: {}, current: 'customer',
  step: (d) => {
    const cur = get().adjust[get().current] ?? 100;
    const i = TEXT_STEPS.findIndex((v) => v >= cur);
    const next = TEXT_STEPS[Math.min(TEXT_STEPS.length - 1, Math.max(0, (i < 0 ? TEXT_STEPS.length - 1 : i) + d))];
    set({ adjust: { ...get().adjust, [get().current]: next } });
  },
  reset: () => set({ adjust: { ...get().adjust, [get().current]: 100 } }),
}), { name: 'tp.textSize', partialize: (s) => ({ adjust: s.adjust }) as any }));
