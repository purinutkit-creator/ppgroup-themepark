# Hardware integration

Business logic never talks to hardware directly. Every device class sits behind an interface with a **simulator**
implementation, so a park can run end-to-end today and switch to real controllers later by configuration only
(Admin → Gates / Lockers / Devices / Settings → Printer).

`HARDWARE_MODE=simulator` (env) forces simulators everywhere. With `HARDWARE_MODE=real`, each gate uses its own
`controller_type` + `controller_config`.

## Gate controllers (`apps/api/src/hardware/gate`)

```ts
interface GateController {
  open({ durationMs, direction }): Promise<void>;
  close(): Promise<void>;
  setEmergency(active: boolean): Promise<void>;
  status(): Promise<{ online: boolean; detail?: unknown }>;
  onEvent(cb: (e: PASSAGE | NO_PASSAGE | CLOSED | OBSTRUCTION | FIRE_ALARM | EMERGENCY_RELEASE | FAULT | ONLINE | OFFLINE) => void);
}
```

| `controller_type` | Adapter | `controller_config` |
|---|---|---|
| `SIMULATOR` | Opens, reports PASSAGE after `simulatePassageMs`, CLOSED after the open duration | `{ "simulatePassageMs": 1200 }` |
| `TURNSTILE` | Network controller, momentary **pulse** | `{ "baseUrl": "http://10.0.1.21", "token": "…", "pulseMs": 500 }` |
| `FLAP_BARRIER` / `SWING_GATE` / `NETWORK` | Network controller, **hold open** for the open duration | `{ "baseUrl": "…", "token": "…" }` |
| `RELAY` | HTTP relay boards (Shelly / ESP32 style `GET /relay/{ch}?turn=on&timer=s`) | `{ "baseUrl": "http://10.0.1.30", "relayChannel": 0 }` |
| `GPIO` | Linux sysfs GPIO (API running on-site, e.g. Raspberry Pi) | `{ "gpioPin": 17, "pulseMs": 800 }` |

Network controller protocol (adapt or wrap your vendor SDK):
`POST {baseUrl}/open {durationMs, direction, mode: PULSE|HOLD}`, `POST /close`, `POST /emergency {active}`, `GET /status`.
Controllers (or the edge agent) push sensor events back to `POST /api/gates/{gateId}/hardware-event` with the device key.

### Gate state machine

```
IDLE → (SCANNING) → VALIDATING → WAITING_APPROVAL ─approve→ APPROVED → OPENING → OPEN → CLOSING → IDLE
                                   │        └─deny / timeout→ DENIED → IDLE
                                   └─(AUTO mode, all checks pass)→ APPROVED
any → ERROR | OFFLINE | EMERGENCY
```

* An OPEN command is never sent while the gate is OPENING / OPEN.
* The scanner is locked until the gate is IDLE / DENIED (`409 GATE_BUSY` otherwise).
* The entry is committed on approval, so a simultaneous scan elsewhere is blocked. If the controller reports
  `NO_PASSAGE` or fails, the entry is **reverted** (ticket back to OUTSIDE).
* Transient states are reset to IDLE on API restart and stale pending scans are expired.

### Edge agent

`tools/gate-edge-agent.mjs` is a reference on-site agent: it subscribes to `gate:{id}` over Socket.IO using the
device key, executes `gate.command` (OPEN / CLOSE / EMERGENCY_OPEN / EMERGENCY_CLEAR) on local hardware, reports
PASSAGE / CLOSED / FAULT, and sends heartbeats. Use it when the gate hardware is not reachable from the server
(cloud deployment) and replace the `hardware` object with your driver (GPIO, Modbus, RS-485, vendor SDK).

### ⚠️ Safety

The web UI and API only **request** gate movements. The following must be implemented in the gate hardware / PLC
and keep working with the software offline:

* emergency release (manual and fire-alarm triggered, fail-open),
* obstruction / anti-crush sensors,
* manual emergency open,
* power-loss behaviour defined by local safety regulations.

The software emergency mode (`POST /api/gates/emergency`) additionally releases all gates of a branch, blocks
scanning and records a security event. Hardware `FIRE_ALARM` / `EMERGENCY_RELEASE` events put the gate into EMERGENCY.

## Scanners

* **Device camera**: starts on the back camera; the flip button switches front / back and the choice is remembered per device.
  Uses the browser's native `BarcodeDetector` when available (Chrome / Android, recent Safari) and falls back to ZXing.
  Formats: QR, Code128, Code39, Code93, Codabar, ITF, EAN-13/8, UPC-A/E, DataMatrix, PDF417, Aztec. It locks after a
  successful read until the transaction finishes. Needs HTTPS (or localhost).
* **USB / Bluetooth / 2D scanners** (keyboard wedge) are captured globally (`useKeyboardScanner`): fast bursts ending with Enter, de-duplicated.
  If the computer's keyboard is on the Thai layout, the scanner's keystrokes arrive as Thai characters; the server maps them
  back to the US layout before resolving (`lib/keyboard.ts`).
* **Customers' existing cards**: any card with its own barcode / QR / printed number can be attached to a member with
  **Link card** (Members → member → Link card, or Ticket Counter → Membership). The value is stored as the card's physical
  serial and is accepted at gates, rides, POS and lockers from then on.
* **Dedicated scanners / RFID / NFC (future)**: any reader that can POST the decoded value to `/api/gates/:id/scan` or `/api/rides/:id/scan` with a device key.
  RFID UIDs can be stored as `credentials.physical_serial`; staff lookup accepts the serial, and gate/ride scanning can be enabled per device.

## Lockers (`hardware/locker`)

`LockerController.unlock(code)` has a simulator and a network implementation (`POST {baseUrl}/unlock {locker}`). Configure it per locker.

## Printers (`hardware/printer`)

* **Browser printing** (USB / Bluetooth printers installed in the OS, or PDF): receipt 58 / 80 mm / A4, wristband 25×254 mm, A4 tickets. Uses print CSS.
* **LAN thermal printers** (ESC/POS over TCP 9100): `POST /api/print/network {kind: RECEIPT|WRISTBAND, id}`. The builder supports text, Thai (TIS-620), bold/size, QR (GS ( k), Code128 and cut.
  Configure the host in Settings → Printer.

## Payments (`hardware/payment`)

```ts
interface PaymentGateway { createCharge(req); verifyWebhook(headers, rawBody); refund(reference, amount) }
interface PaymentTerminal { charge({ amount, paymentNo, deviceId }) }   // EDC at ride scanners / kiosks
```

* `simulator`: PromptPay dynamic QR (real EMVCo payload with CRC16, scannable by Thai banking apps), hosted card page simulator, signed webhooks.
* `promptpay-manual`: PromptPay / bank transfer confirmed through slip verification.
* Production: implement the interface for your acquirer (Omise, 2C2P, GB Prime Pay, KBank, SCB, Stripe…) and set `PAYMENT_PROVIDER`.
  The webhook endpoint is `POST /api/payments/webhook/{provider}`. Card numbers are never sent to or stored by this system.
