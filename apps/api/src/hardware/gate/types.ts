/**
 * Gate controller hardware abstraction. Business logic (GateService) never talks to
 * hardware directly — it calls a GateController. Swap SIMULATOR for a real adapter
 * per gate (gates.controller_type + controller_config) without touching business code.
 *
 * SAFETY: these adapters only *request* open/close. Physical safety (emergency release,
 * obstruction / anti-crush sensors, fire-alarm fail-open, manual emergency release) MUST be
 * implemented in the gate hardware / PLC itself and must work with this software offline.
 */
export type GateHwEvent =
  | { type: 'PASSAGE' }          // sensor confirmed a person passed
  | { type: 'NO_PASSAGE' }       // opened but nobody passed before timeout
  | { type: 'CLOSED' }
  | { type: 'OBSTRUCTION' }
  | { type: 'FIRE_ALARM'; active: boolean }
  | { type: 'EMERGENCY_RELEASE'; active: boolean }
  | { type: 'FAULT'; message: string }
  | { type: 'ONLINE' } | { type: 'OFFLINE' };

export interface GateControllerConfig {
  [k: string]: unknown;
  baseUrl?: string;        // network / relay controllers
  token?: string;
  relayChannel?: number;
  gpioPin?: number;
  pulseMs?: number;        // turnstiles: momentary pulse; flap / swing: hold open
  passageTimeoutMs?: number;
  simulatePassageMs?: number;
}

export interface GateController {
  readonly type: string;
  open(opts: { durationMs: number; direction: 'IN' | 'OUT' }): Promise<void>;
  close(): Promise<void>;
  setEmergency(active: boolean): Promise<void>;
  status(): Promise<{ online: boolean; detail?: unknown }>;
  onEvent(cb: (e: GateHwEvent) => void): void;
  dispose(): void;
}
