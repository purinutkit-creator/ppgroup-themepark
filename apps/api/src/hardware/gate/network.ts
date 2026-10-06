import type { GateController, GateControllerConfig, GateHwEvent } from './types.js';

/**
 * Network gate controller (turnstile / flap barrier / swing gate controller boxes with an
 * HTTP API). Expected endpoints on the controller (adapt `paths` in controller_config):
 *   POST {baseUrl}/open   {durationMs, direction, mode: 'PULSE'|'HOLD'}
 *   POST {baseUrl}/close
 *   POST {baseUrl}/emergency {active}
 *   GET  {baseUrl}/status  → {online, passage?}
 * Passage / fault events are pushed back by the controller (or an on-site edge agent) to
 *   POST /api/gates/{gateId}/hardware-event  (authenticated with the device API key)
 */
export class NetworkGateController implements GateController {
  private listeners: Array<(e: GateHwEvent) => void> = [];
  constructor(readonly type: string, private cfg: GateControllerConfig, private mode: 'PULSE' | 'HOLD') {
    if (!cfg.baseUrl) throw new Error(`${type} controller requires controller_config.baseUrl`);
  }
  private async call(path: string, body?: unknown, method = 'POST') {
    const res = await fetch(`${this.cfg.baseUrl}${path}`, {
      method, headers: { 'content-type': 'application/json', ...(this.cfg.token ? { authorization: `Bearer ${this.cfg.token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) throw new Error(`Gate controller ${path} → HTTP ${res.status}`);
    return res.headers.get('content-type')?.includes('json') ? res.json() : null;
  }
  async open(opts: { durationMs: number; direction: 'IN' | 'OUT' }) {
    await this.call('/open', { durationMs: this.mode === 'PULSE' ? Number(this.cfg.pulseMs ?? 500) : opts.durationMs, direction: opts.direction, mode: this.mode });
  }
  async close() { await this.call('/close'); }
  async setEmergency(active: boolean) { await this.call('/emergency', { active }); }
  async status() {
    try { const s: any = await this.call('/status', undefined, 'GET'); return { online: s?.online !== false, detail: s }; }
    catch (e) { return { online: false, detail: String(e) }; }
  }
  onEvent(cb: (e: GateHwEvent) => void) { this.listeners.push(cb); }
  emit(e: GateHwEvent) { for (const l of this.listeners) l(e); }
  dispose() { this.listeners = []; }
}

/** Generic network relay board (e.g. Shelly / ESP32 relay): GET {baseUrl}/relay/{ch}?turn=on&timer={sec} */
export class RelayGateController implements GateController {
  readonly type = 'RELAY';
  private listeners: Array<(e: GateHwEvent) => void> = [];
  constructor(private cfg: GateControllerConfig) { if (!cfg.baseUrl) throw new Error('RELAY controller requires baseUrl'); }
  private async relay(on: boolean, timerSec?: number) {
    const ch = Number(this.cfg.relayChannel ?? 0);
    const url = `${this.cfg.baseUrl}/relay/${ch}?turn=${on ? 'on' : 'off'}${timerSec ? `&timer=${timerSec}` : ''}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) throw new Error(`Relay HTTP ${res.status}`);
  }
  async open({ durationMs }: { durationMs: number }) {
    await this.relay(true, Math.max(1, Math.round(Number(this.cfg.pulseMs ?? durationMs) / 1000)));
    // relays have no passage sensor: report CLOSED after duration
    setTimeout(() => this.emit({ type: 'CLOSED' }), durationMs);
  }
  async close() { await this.relay(false); }
  async setEmergency(active: boolean) { await this.relay(active); }
  async status() {
    try { const r = await fetch(`${this.cfg.baseUrl}/status`, { signal: AbortSignal.timeout(2000) }); return { online: r.ok }; }
    catch { return { online: false }; }
  }
  onEvent(cb: (e: GateHwEvent) => void) { this.listeners.push(cb); }
  private emit(e: GateHwEvent) { for (const l of this.listeners) l(e); }
  dispose() { this.listeners = []; }
}
