import fs from 'node:fs/promises';
import type { GateController, GateControllerConfig, GateHwEvent } from './types.js';

/**
 * GPIO controller for an on-site edge deployment (e.g. Raspberry Pi running the API / edge agent)
 * driving a relay through the Linux sysfs GPIO interface.
 */
export class GpioGateController implements GateController {
  readonly type = 'GPIO';
  private listeners: Array<(e: GateHwEvent) => void> = [];
  private ready: Promise<void>;
  constructor(private cfg: GateControllerConfig) {
    if (cfg.gpioPin == null) throw new Error('GPIO controller requires gpioPin');
    this.ready = this.init();
  }
  private get base() { return `/sys/class/gpio/gpio${this.cfg.gpioPin}`; }
  private async init() {
    try { await fs.access(this.base); } catch { await fs.writeFile('/sys/class/gpio/export', String(this.cfg.gpioPin)); }
    await fs.writeFile(`${this.base}/direction`, 'out');
  }
  private async write(v: 0 | 1) { await this.ready; await fs.writeFile(`${this.base}/value`, String(v)); }
  async open({ durationMs }: { durationMs: number }) {
    await this.write(1);
    setTimeout(() => { this.write(0).catch(() => {}); this.emit({ type: 'CLOSED' }); }, Number(this.cfg.pulseMs ?? durationMs));
  }
  async close() { await this.write(0); }
  async setEmergency(active: boolean) { await this.write(active ? 1 : 0); }
  async status() { try { await this.ready; return { online: true }; } catch (e) { return { online: false, detail: String(e) }; } }
  onEvent(cb: (e: GateHwEvent) => void) { this.listeners.push(cb); }
  private emit(e: GateHwEvent) { for (const l of this.listeners) l(e); }
  dispose() { this.listeners = []; }
}
