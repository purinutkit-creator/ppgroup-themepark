import { useEffect } from 'react';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { usePublicConfig } from './config';
import { TH, TH_ENUM, TH_PATTERNS } from './staffTh';

/**
 * Staff / back-office language (TH / EN).
 *
 * The staff screens are written with English text. When Thai is selected, a translation layer replaces the
 * rendered English text (text nodes plus placeholder / title / aria-label) with the Thai entries from staffTh.ts,
 * and restores the English originals when switching back. It only edits the text content of existing DOM nodes,
 * never the node structure, so React keeps working normally: when React later writes a new English value into a
 * node, the observer simply translates that value again.
 * Customer-facing screens (website, kiosk, gate / ride displays) have their own TH / EN / 中文 texts and do not use this.
 */
export type StaffLang = 'th' | 'en';
interface StaffLangState { lang: StaffLang | null; setLang: (l: StaffLang) => void }
export const useStaffLangStore = create<StaffLangState>()(persist((set) => ({ lang: null, setLang: (lang) => set({ lang }) }), { name: 'tp.staffLang' }));

/** This device's choice, else the admin default (Settings → Language & text size), else Thai. */
export function useStaffLang(): [StaffLang, (l: StaffLang) => void] {
  const { lang, setLang } = useStaffLangStore();
  const cfg = usePublicConfig();
  return [lang ?? cfg.data?.display?.staffLanguage ?? 'th', setLang];
}

// ------------------------------------------------------------------ translation
const PATTERNS = TH_PATTERNS.map(([en, th]) => {
  const re = new RegExp(`^${en.split('{}').map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('(.+?)')}$`);
  return { re, th };
});
const SUFFIX = /^(.*?)([:：*…?!]+|\s*→|\s*↗)$/;

function lookup(core: string): string | undefined {
  const direct = TH[core] ?? TH_ENUM[core] ?? TH_ENUM[core.replaceAll(' ', '_')];
  if (direct !== undefined) return direct;
  for (const p of PATTERNS) {
    const m = core.match(p.re);
    if (m) { let i = 1; return p.th.replace(/\{\}/g, () => translateCore(m[i++]) ?? m[i - 1]); }
  }
  // "Label:" / "Label *" / "Label →" — translate the label, keep the punctuation
  const s = core.match(SUFFIX);
  if (s && s[1]) { const t = TH[s[1].trim()] ?? TH_ENUM[s[1].trim()]; if (t !== undefined) return `${t}${s[2]}`; }
  return undefined;
}
function translateCore(core: string): string | undefined {
  return /[A-Za-z]/.test(core) ? lookup(core) : undefined;
}
/** Translate one piece of UI text, keeping its surrounding whitespace. Returns undefined when there is no entry. */
export function translateText(text: string): string | undefined {
  const m = text.match(/^(\s*)([\s\S]*?)(\s*)$/)!;
  if (!m[2] || !/[A-Za-z]/.test(m[2])) return undefined;
  const t = lookup(m[2].replace(/\s+/g, ' '));
  return t === undefined ? undefined : `${m[1]}${t}${m[3]}`;
}

const ATTRS = ['placeholder', 'title', 'aria-label'] as const;
const SKIP = 'script,style,textarea,code,[data-no-tr],[contenteditable="true"]';
// per node: the English source and what we wrote, so we can tell React's updates from ours and restore English
const textMemo = new WeakMap<Text, { en: string; th: string }>();
const attrMemo = new WeakMap<Element, Record<string, { en: string; th: string }>>();

function skip(el: Element | null) { return !el || !!el.closest(SKIP); }

function doText(node: Text, on: boolean) {
  const memo = textMemo.get(node);
  const value = node.nodeValue ?? '';
  if (memo && value === memo.th) { if (!on) node.nodeValue = memo.en; return; }
  if (memo && !on && value === memo.en) return;
  if (!on || skip(node.parentElement)) return;
  const th = translateText(value);
  if (th !== undefined && th !== value) { textMemo.set(node, { en: value, th }); node.nodeValue = th; }
}
function doAttrs(el: Element, on: boolean) {
  for (const a of ATTRS) {
    const value = el.getAttribute(a);
    if (value == null) continue;
    const memo = attrMemo.get(el)?.[a];
    if (memo && value === memo.th) { if (!on) el.setAttribute(a, memo.en); continue; }
    if (!on || skip(el)) continue;
    const th = translateText(value);
    if (th !== undefined && th !== value) { attrMemo.set(el, { ...attrMemo.get(el), [a]: { en: value, th } }); el.setAttribute(a, th); }
  }
}
function walk(root: Node, on: boolean) {
  if (root.nodeType === Node.TEXT_NODE) { doText(root as Text, on); return; }
  if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) return;
  if (root.nodeType === Node.ELEMENT_NODE) doAttrs(root as Element, on);
  const it = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  for (let n = it.nextNode(); n; n = it.nextNode()) {
    if (n.nodeType === Node.TEXT_NODE) doText(n as Text, on); else doAttrs(n as Element, on);
  }
}

let active = 0;
let observer: MutationObserver | null = null;
// native confirm / prompt / alert texts never reach the DOM — translate them on the way in
const native = { confirm: window.confirm, prompt: window.prompt, alert: window.alert };
const trArg = (m?: any) => (typeof m === 'string' ? translateText(m) ?? m : m);
function start() {
  window.confirm = (m?: string) => native.confirm.call(window, trArg(m));
  window.prompt = (m?: string, d?: string) => native.prompt.call(window, trArg(m), d);
  window.alert = (m?: any) => native.alert.call(window, trArg(m));
  walk(document.body, true);
  observer = new MutationObserver((records) => {
    for (const r of records) {
      if (r.type === 'characterData') doText(r.target as Text, true);
      else if (r.type === 'attributes') doAttrs(r.target as Element, true);
      else r.addedNodes.forEach((n) => walk(n, true));
    }
  });
  observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: [...ATTRS] });
}
function stop() {
  Object.assign(window, native);
  observer?.disconnect();
  observer = null;
  walk(document.body, false);
}

/** Mount on staff screens: translates the page to Thai while the staff language is Thai. */
export function useStaffTranslation() {
  const [lang] = useStaffLang();
  useEffect(() => {
    if (lang !== 'th') return;
    if (active++ === 0) start();
    document.documentElement.lang = 'th';
    return () => { if (--active === 0) stop(); };
  }, [lang]);
}
