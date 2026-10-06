import { useAuth } from './auth';

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: any) { super(message); }
}

type Ctx = 'staff' | 'member' | 'public';
export interface ReqOpts { method?: string; body?: unknown; idempotencyKey?: string; form?: FormData; signal?: AbortSignal; raw?: boolean }

export const newKey = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

async function request<T>(ctx: Ctx, path: string, o: ReqOpts = {}): Promise<T> {
  const s = useAuth.getState();
  const headers: Record<string, string> = {};
  const token = ctx === 'staff' ? s.staffToken : ctx === 'member' ? s.memberToken : s.memberToken;
  if (token) headers.authorization = `Bearer ${token}`;
  if (ctx !== 'member' && s.deviceKey) headers['x-device-key'] = s.deviceKey;
  if (o.idempotencyKey) headers['idempotency-key'] = o.idempotencyKey;
  let body: BodyInit | undefined;
  if (o.form) body = o.form;
  else if (o.body !== undefined) { headers['content-type'] = 'application/json'; body = JSON.stringify(o.body); }
  let res: Response;
  try {
    res = await fetch(path, { method: o.method ?? (body ? 'POST' : 'GET'), headers, body, signal: o.signal });
  } catch (e: any) {
    if (e?.name === 'AbortError') throw e;
    throw new ApiError(0, 'NETWORK', 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ / Network error');
  }
  if (o.raw) {
    if (!res.ok) throw new ApiError(res.status, 'HTTP', `HTTP ${res.status}`);
    return res as any;
  }
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (!res.ok) {
    if (res.status === 401 && ctx === 'staff' && s.staffToken) s.logoutStaff(true);
    if (res.status === 401 && ctx === 'member' && s.memberToken) s.logoutMember();
    throw new ApiError(res.status, json?.error?.code ?? 'HTTP', json?.error?.message ?? `HTTP ${res.status}`, json?.error?.details);
  }
  return json as T;
}

const make = (ctx: Ctx) => ({
  get: <T = any>(p: string, o?: ReqOpts) => request<T>(ctx, p, o),
  post: <T = any>(p: string, body?: unknown, o?: ReqOpts) => request<T>(ctx, p, { ...o, method: 'POST', body: body ?? {} }),
  patch: <T = any>(p: string, body?: unknown, o?: ReqOpts) => request<T>(ctx, p, { ...o, method: 'PATCH', body }),
  put: <T = any>(p: string, body?: unknown, o?: ReqOpts) => request<T>(ctx, p, { ...o, method: 'PUT', body }),
  del: <T = any>(p: string, o?: ReqOpts) => request<T>(ctx, p, { ...o, method: 'DELETE' }),
  upload: <T = any>(p: string, form: FormData) => request<T>(ctx, p, { method: 'POST', form }),
  raw: (p: string) => request<Response>(ctx, p, { raw: true }),
});

/** staff back office / POS / devices */
export const sapi = make('staff');
/** member portal */
export const mapi = make('member');
/** public website (sends member token when logged in for member pricing) */
export const papi = make('public');

export function qs(params: Record<string, unknown>) {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') u.set(k, String(v));
  const s = u.toString();
  return s ? `?${s}` : '';
}

export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.code === 'VALIDATION_ERROR' && Array.isArray(e.details)) return `${e.message}: ${e.details.map((d: any) => `${d.path} ${d.message}`).join(', ')}`;
    return e.message;
  }
  return (e as Error)?.message ?? String(e);
}
