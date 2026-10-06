import type { GateController, GateControllerConfig, GateHwEvent } from './types.js';

/** Software gate for development / demos: opens, "detects" a passage, closes. */
export class SimulatorGateController implements GateController {
  readonly type = 'SIMULATOR';
  private listeners: Array<(e: GateHwEvent) => void> = [];
  private timers: NodeJS.Timeout[] = [];
  private emergency = false;
  constructor(private cfg: GateControllerConfig = {}) {}
  private emit(e: GateHwEvent) { for (const l of this.listeners) l(e); }
  async open({ durationMs }: { durationMs: number }) {
    if (this.emergency) return;
    const passAt = Number(this.cfg.simulatePassageMs ?? Math.min(1500, durationMs / 2));
    this.timers.push(setTimeout(() => this.emit({ type: 'PASSAGE' }), passAt));
    this.timers.push(setTimeout(() => this.emit({ type: 'CLOSED' }), durationMs));
  }
  async close() { this.clear(); this.emit({ type: 'CLOSED' }); }
  async setEmergency(active: boolean) { this.emergency = active; this.clear(); this.emit({ type: 'EMERGENCY_RELEASE', active }); }
  async status() { return { online: true, detail: { simulator: true, emergency: this.emergency } }; }
  onEvent(cb: (e: GateHwEvent) => void) { this.listeners.push(cb); }
  private clear() { this.timers.forEach(clearTimeout); this.timers = []; }
  dispose() { this.clear(); this.listeners = []; }
}
