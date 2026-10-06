# Architecture

```
 Customer website / portal / kiosk / gate display / ride scanner / KDS        Back office / counter / POS / consoles
                 │  HTTPS (REST, JSON)        WebSocket (Socket.IO rooms)                    │
                 └──────────────────────────────┬───────────────────────────────────────────────┘
                                                ▼
 ┌──────────────────────────────── Fastify API (apps/api) ────────────────────────────────┐
 │ middleware: actor resolution (staff JWT · member JWT · device API key), RBAC, rate limit │
 │ routes/*  →  services/*  (all business rules)  →  PostgreSQL (withTx + row locks)      │
 │                    │                    │                                                │
 │            realtime/hub (afterCommit)   hardware/* adapters (gate, locker, printer,     │
 │                                          payment gateway, card terminal)               │
 │ jobs.ts: device sweep, payment expiry, end-of-day, queue expiry, fulfilment retry,      │
 │          wallet reconciliation (PG advisory locks → one runner per cluster)            │
 └─────────────────────────────────────────────────────────────────────────────────────────┘
```

The frontend never touches the database. Every money movement, entitlement change, gate decision and
configuration change goes through an authorised API call and a database transaction.

## Service layer (`apps/api/src/services`)

| Service | Responsibility |
|---|---|
| `auth` | Staff login (employee code / staff picker + PIN), member login (phone/email + password), sessions (revocable, “logout all devices”), lockout, suspicious-login alerts, OTP password reset |
| `credentials` | Issue / activate / suspend / lost / block / close / replace / rotate token, bind & unbind member, card profile, scan resolution |
| `accounts` | Customer accounts. Every credential points to one account. Member: one account. Guest: one per visit or wristband. Wallet, tickets and entitlements belong to the account |
| `wallet` | Ledger-based wallet (`postLedger` is the only way to change a balance), transfers, reconciliation |
| `orders` | Server-side pricing, order creation, split payments, payment capture, **fulfilment** (tickets, entitlements, top-ups, membership, lockers, stock, kitchen, points, promotions) in the payment transaction |
| `payments` | Online / async payments (gateway, PromptPay QR, card terminal), slip verification center |
| `promotions` | Rule engine: conditions, priority, stackable / non-stackable, coupons, usage limits, tier discounts |
| `bookings` | Packages for sale, availability & capacity (advisory lock per branch+date), quotes, bookings, tickets, check-in → wristbands |
| `tickets` | Ticket ↔ credential resolution, date / time / multi-day validity, package entitlements |
| `gates` | Gate state machine, scan validation, manual approval, overrides, manual open, emergency, hardware event handling, occupancy |
| `rides` | Ride entitlement engine, consumption, buy-at-scanner, cash confirmation, manual approve/deny, operator snapshot |
| `queue` | Virtual queue (join, position, ETA, call next batch, no-show expiry, priority benefit) |
| `lockers` | Rent, open with the same wristband, end, overdue |
| `membership` | Pricing for new / renewal (early discount, grace period) / upgrade (full, difference, prorated), activation, expiry reminders |
| `points` / `rewards` | Points ledger, earn rules & multipliers, reward store, vouchers / coupons / instant wallet credit / ride passes |
| `inventory` | Stock per store/warehouse, movements, transfer, low-stock alerts |
| `shifts` | Open/close, expected cash, over/short with approval, cash in/out |
| `refunds` | Full / partial / item refunds and voids that reverse whatever was granted, wallet cash-out by policy, wallet adjustment |
| `approvals` | Manager PIN → single-use, short-lived approval records consumed inside the protected transaction |
| `notify`, `audit`, `settings`, `devices`, `dashboard`, `reports` | Notification center, append-only audit, dynamic configuration, device heartbeats, KPIs, 20 reports + exports |

## Data model highlights (`apps/api/src/db/migrations`)

* **Money** is `BIGINT` satang everywhere. CHECK constraints enforce non-negative amounts, `paid_total ≤ total`, `refunded ≤ paid`.
* **credentials** (`code` = human id such as `WB-00038102`, `token` = 16-char random secret printed in the QR / barcode) → `account_id`, `member_id`.
  `credential_links` connect credentials to tickets / bookings with history (`unlinked_at`), so a lost-card replacement moves links and keeps the trail.
* **wallet_accounts** (cached balance, `CHECK balance >= 0`) + **wallet_ledger** (append-only trigger; `CHECK balance_after = balance_before + credit − debit`; unique `(wallet_id, idempotency_key)`).
* **transactions**: one journal row per financial event (sale, top-up, refund, void, cash in/out, wallet adjust / cash-out). It drives the Transaction Center, reports and shift reconciliation.
* **gate_scans** logs every scan, including denied ones. A partial unique index allows at most one PENDING decision per ticket across all gates. **entry_logs** records actual passages, **security_events** records duplicates, forged QR codes, lost cards and overrides.
* **ride_entitlements** (`ride_id NULL` = all rides; `uses_remaining` CHECK ≥ 0) + **ride_entitlement_usage**.
* **audit_logs** is append-only (trigger rejects UPDATE/DELETE).
* Spec-compatible views: `wallets`, `wallet_transactions`, `booking_payments`, `ticket_products`.

## Transaction safety

* `withTx()` runs each business operation in one transaction and retries on serialization failures or deadlocks.
  Side effects (WebSocket pushes, gate OPEN commands, locker unlocks) run **after commit** only.
* Wallet: `SELECT … FOR UPDATE` on the wallet row → balance check → ledger insert → balance update. Concurrent debits are serialised (tested).
* Idempotency at two levels:
  1. `Idempotency-Key` header → `idempotency_keys` table returns the stored response for retries, double taps and offline replays.
  2. Business uniqueness: `orders.idempotency_key`, `payments.idempotency_key`, `wallet_ledger (wallet_id, idempotency_key)`, `points_ledger.idempotency_key`, `refunds.idempotency_key`.
* Double payment: the order row is locked, the amount must fit the outstanding balance, and `markPaymentPaid` refuses payments that would exceed the total.
* **Paid but fulfilment failed**: `confirmExternalPayment` records the money, flags the order (`fulfillment_error`), raises a CRITICAL notification and the `fulfillment-retry` job retries. A customer is never charged without a recovery path.
* Wallet reconciliation job compares cached balances with ledger sums every 15 minutes.

## Credential & QR security

* QR payloads carry no customer data: `TP1.<token>.<hmac6>` (static, printed) or `TP2.<token>.<30s-window>.<hmac10>` (rotating digital member card, which defeats screenshot sharing). The barcode carries the raw token (Code128).
* The HMAC lets the server reject forged codes; the backend always loads the current state (status, expiry, tickets, wallet).
* Token rotation, revoke (status), expiry, and lost/stolen replacement with full transfer of links.
* Gate protections: scanner lock per gate (the state must be IDLE/DENIED), one pending decision per ticket (partial unique index + ticket row lock), anti-passback (`presence = INSIDE` until an exit event), re-entry & entries-per-day policy, duplicate attempts produce security events + operator alerts, replayed dynamic QR codes expire.

## Realtime

`realtime/hub.publish(rooms, event, data)` is called from services after commit. Rooms: `branch:{id}`, `gates:{branch}`,
`gate:{id}`, `ride:{id}`, `kds:{store}`, `kdsready:{store}`, `payverify:{branch}`, `account:{id}`, `member:{id}`,
`booking:{id}` (requires the booking's secret token), `devices:{branch}`, `owner`. Socket subscriptions are authorised
server-side (`realtime/socket.ts`). Example: a wallet debit at a POS emits `wallet.updated` to `account:{id}` → POS,
member portal, card profile, kiosk and ride scanner all show the new balance without refresh.

For multiple API instances add `@socket.io/redis-adapter` in `createSocketServer` (publish API unchanged). Gate runtime
timers are in-process: pin each branch's gates to one instance (sticky routing) or move them to a leader-elected worker.

## Offline handling

* The web client tracks connectivity (browser events + `/api/health` probe) and shows **OFFLINE MODE**.
* Safe actions (configurable `offline.allowedActions`, e.g. cash POS sales, KDS status, exit scans) are queued in
  `localStorage` with their idempotency keys and replayed through `POST /api/sync/batch` when back online.
* High-risk actions (manual gate open, refunds, wallet adjustments, wallet payments) are rejected offline
  (`offline.blockedActions`) and the server refuses them in the sync endpoint too.

## Security summary

scrypt hashes for PINs and passwords; revocable JWT sessions; per-route rate limits on auth; account lockout; Helmet;
CORS allow-list; device API keys stored as SHA-256 hashes; branch scoping on every staff query; RBAC with 70+ permissions;
manager approvals for refund / void / manual gate open / overrides / wallet adjustment / over-limit discount /
points adjustment / shift over-short / card replacement (configurable); card numbers never stored (gateway tokenisation
interface + hosted page simulator); uploads type-checked and stored outside the web root.
