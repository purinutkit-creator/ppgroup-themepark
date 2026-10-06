import { config } from '../../config.js';
import type { GateController, GateControllerConfig } from './types.js';
import { SimulatorGateController } from './simulator.js';
import { NetworkGateController, RelayGateController } from './network.js';
import { GpioGateController } from './gpio.js';

export * from './types.js';

export function createGateController(type: string, cfg: GateControllerConfig): GateController {
  if (config.hardwareMode === 'simulator' || type === 'SIMULATOR') return new SimulatorGateController(cfg);
  switch (type) {
    case 'TURNSTILE': return new NetworkGateController('TURNSTILE', cfg, 'PULSE');
    case 'FLAP_BARRIER': return new NetworkGateController('FLAP_BARRIER', cfg, 'HOLD');
    case 'SWING_GATE': return new NetworkGateController('SWING_GATE', cfg, 'HOLD');
    case 'NETWORK': return new NetworkGateController('NETWORK', cfg, 'HOLD');
    case 'RELAY': return new RelayGateController(cfg);
    case 'GPIO': return new GpioGateController(cfg);
    default: throw new Error(`Unknown gate controller type ${type}`);
  }
}
