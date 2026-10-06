import { config } from '../../config.js';

/** Locker controller abstraction (electronic lock boards). Simulator logs; network adapter calls the lock board API. */
export interface LockerController { unlock(lockerCode: string): Promise<void> }

class SimulatorLocker implements LockerController {
  async unlock(code: string) { if (!config.isTest) console.log(`[locker-sim] unlock ${code}`); }
}
class NetworkLocker implements LockerController {
  constructor(private baseUrl: string, private token?: string) {}
  async unlock(code: string) {
    const r = await fetch(`${this.baseUrl}/unlock`, { method: 'POST', headers: { 'content-type': 'application/json', ...(this.token ? { authorization: `Bearer ${this.token}` } : {}) },
      body: JSON.stringify({ locker: code }), signal: AbortSignal.timeout(3000) });
    if (!r.ok) throw new Error(`Locker controller HTTP ${r.status}`);
  }
}
export function lockerController(type: string, cfg: any): LockerController {
  if (config.hardwareMode === 'simulator' || type === 'SIMULATOR') return new SimulatorLocker();
  return new NetworkLocker(cfg.baseUrl, cfg.token);
}
