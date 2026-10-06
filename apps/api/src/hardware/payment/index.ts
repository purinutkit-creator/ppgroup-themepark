import crypto from 'node:crypto';
import { config } from '../../config.js';
import { promptPayPayload } from '../../lib/promptpay.js';
import { randomBase32 } from '../../lib/crypto.js';

/**
 * Payment provider abstraction. Card numbers NEVER touch this system: card payments are
 * tokenised by the provider (hosted checkout / provider JS) and we only keep references.
 * Implement a real adapter (Omise, 2C2P, GB Prime Pay, Stripe…) with this interface and
 * select it via PAYMENT_PROVIDER.
 */
export interface ChargeRequest { paymentId: string; paymentNo: string; amount: number; method: string; description: string; returnUrl?: string }
export interface ChargeResult { reference: string; checkoutUrl?: string; qrPayload?: string; expiresAt: Date; requiresAction: boolean }
export interface WebhookResult { reference: string; status: 'PAID' | 'FAILED'; amount: number; raw: unknown }

export interface PaymentGateway {
  readonly name: string;
  createCharge(req: ChargeRequest): Promise<ChargeResult>;
  verifyWebhook(headers: Record<string, unknown>, rawBody: string): WebhookResult;
  refund(reference: string, amount: number): Promise<{ ok: boolean; reference: string }>;
}

class SimulatorGateway implements PaymentGateway {
  readonly name: string = 'simulator';
  async createCharge(req: ChargeRequest): Promise<ChargeResult> {
    const reference = `SIM-${randomBase32(12)}`;
    const expiresAt = new Date(Date.now() + 15 * 60_000);
    if (req.method === 'PROMPTPAY') {
      return { reference, qrPayload: promptPayPayload(config.promptpayId, req.amount), expiresAt, requiresAction: true };
    }
    return { reference, checkoutUrl: `/pay/simulator/${req.paymentId}`, expiresAt, requiresAction: true };
  }
  verifyWebhook(headers: Record<string, unknown>, rawBody: string): WebhookResult {
    const sig = String(headers['x-simulator-signature'] ?? '');
    const expected = crypto.createHmac('sha256', config.jwtSecret).update(rawBody).digest('hex');
    if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) throw new Error('Invalid webhook signature');
    const body = JSON.parse(rawBody);
    return { reference: body.reference, status: body.status, amount: body.amount, raw: body };
  }
  async refund(reference: string, _amount: number) {
    return { ok: true, reference: `SIMRF-${reference}` };
  }
}

/** Static PromptPay without a gateway: QR is generated locally, confirmation by slip verification. */
class PromptPayManualGateway extends SimulatorGateway {
  override readonly name = 'promptpay-manual';
}

const gateways: Record<string, PaymentGateway> = {
  simulator: new SimulatorGateway(),
  'promptpay-manual': new PromptPayManualGateway(),
};

export function gateway(name = config.paymentProvider): PaymentGateway {
  const g = gateways[name];
  if (!g) throw new Error(`Payment provider "${name}" not configured`);
  return g;
}

export const simulatorEnabled = () => config.paymentProvider === 'simulator' && (!config.isProd || process.env.ALLOW_PAYMENT_SIMULATOR === 'true');

// ---------------------------------------------------------------------
// Card payment terminal (EDC) at counters / ride scanners / kiosks
// ---------------------------------------------------------------------
export interface PaymentTerminal {
  charge(input: { amount: number; paymentNo: string; deviceId?: string | null }): Promise<{ approved: boolean; reference: string; message?: string }>;
}

class SimulatorTerminal implements PaymentTerminal {
  async charge(input: { amount: number; paymentNo: string }) {
    await new Promise((r) => setTimeout(r, config.isTest ? 10 : 1500));
    return { approved: true, reference: `EDC-${randomBase32(8)}`, message: `Approved ${input.amount / 100} THB` };
  }
}
export const terminal = (): PaymentTerminal => new SimulatorTerminal();
