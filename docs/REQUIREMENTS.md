# Requirement coverage

Legend: ✅ implemented end-to-end (DB + API + UI) · 🔌 implemented behind an adapter interface with a simulator (needs a real provider / device driver) · 🟡 partial (see notes)

| # | Requirement | Status | Where |
|---|---|---|---|
| 1 | All 34 modules | ✅ | see rows below |
| 2 | Online ticket flow, configurable ticket types/packages (price, age, height, dates, times, entries, rides, zones, expiry, blackout, capacity, refund, re-entry, transfer), ticket ID/booking/QR/barcode/status lifecycle, attach to member | ✅ | `services/bookings.ts`, `/book`, Admin → Packages (+ composition editor), `/account` → Tickets → “Add booking” |
| 3 | Online payment: PromptPay, cards, transfer, e-wallet, gateway, cash at counter. Separate payment records, double-payment prevention | ✅ / 🔌 gateway | `payments` table, `services/payments.ts`, `hardware/payment` (simulator + interface) |
| 4 | Box office: sell, member register/search, promotions, add-ons, split payment, print ticket/receipt, QR/barcode, bind wristband ↔ ticket ↔ member | ✅ | `/staff/counter` |
| 5–6 | Membership & points: data, tiers (unlimited), earn rules per category, redeem | ✅ | `members`, `member_tiers`, `points_ledger`, Settings → Points, POINTS payment method, Reward store |
| 7, 114 | Promotion engine: rule conditions, dates, branch, ticket type, tier, min spend, %/amount/buy-X-pay-Y/fixed price, max discount, usage limits, coupons, stackable + priority | ✅ | `services/promotions.ts`, Admin → Promotions & Coupons |
| 8, 55, 71, 121, 127 | One credential (QR / barcode / wristband / member card / digital card / booking) → member, ticket, wallet, rides, locker, queue, transactions. Server-side validation, signed random tokens, rotation, revoke, expiry, statuses | ✅ (RFID/NFC: 🟡 serial field + device POST, no reader driver) | `credentials`, `credential_links`, `lib/crypto.ts`, `services/credentials.ts` |
| 9–13, 41 | 10 entrance gates (+ exits), customer display with camera, operator console grid, flashing gate, validation list, APPROVE/DENY, AUTO/MANUAL modes, displays (waiting/checking/granted/denied + reason), gate dashboard | ✅ | `/gate/:id/display`, `/staff/gates`, `services/gates.ts` |
| 14, 58, 59 | Hardware API (scan/approve/deny/open/close/status), adapters for turnstile/flap/swing/relay/GPIO/network, backend-only authorisation, state machine, no duplicate OPEN, emergency mode | ✅ / 🔌 vendor protocols | `hardware/gate/*`, `tools/gate-edge-agent.mjs`, docs/HARDWARE.md |
| 15, 56, 67 | Duplicate entry, replay, cloning, simultaneous scans, anti-passback, supervisor override, security log | ✅ | partial unique index, row locks, `security_events`, dynamic QR |
| 16 | Entry log of every scan (incl. denied) | ✅ | `gate_scans`, `entry_logs`, `/staff/gates/log` |
| 17–18, 51 | Live occupancy (entered/exited/inside/capacity %/peak/zone), exit gates, re-entry, capacity thresholds, stop online sales, block entry | ✅ | `occupancy()`, Settings → Capacity |
| 19–22, 42, 104–105 | Ride management, status, access checks (ticket, permission, age, height, usage, time, status), history, operator screen (open/close/maintenance/pause/manual approve/deny), ride dashboard + sort, unlimited scan points, new ride without code | ✅ | `services/rides.ts`, `/staff/rides/:id`, Admin → Rides & Scan Points |
| 23 | Virtual queue: join at scanner/portal, number, people ahead, ETA, call + notification | ✅ | `services/queue.ts` |
| 24–25, 74, 76, 122 | Cashless wallet, top-up (counter/kiosk/online), ledger with before/after balances, realtime balance everywhere | ✅ | `wallet_ledger`, `postLedger`, `wallet.updated` events |
| 26–29 | POS (food/drink/souvenir/photo/locker/service), member attach, promotions, points, mixed payment; food ordering (counter/kiosk/QR/mobile), modifiers, queue number, KDS (NEW→PREPARING→READY→COMPLETED), ready board; retail SKU/barcode/cost/stock | ✅ | `/staff/pos`, `/order/:storeId`, `/kiosk`, `/kds/:id`, `/board/:id` |
| 30 | Inventory per store/warehouse: in/out/transfer/adjust/waste, low-stock alerts | ✅ | `services/inventory.ts`, `/staff/inventory` |
| 31 | Lockers: scan, choose locker/duration, wallet payment, same wristband opens | ✅ / 🔌 lock boards | `services/lockers.ts`, `/staff/lockers` |
| 32 | Kiosk: buy ticket, register, top-up, balance/ticket/queue check, food, ride status, print | ✅ | `/kiosk` |
| 33, 84–86 | Customer portal & member website: login (phone/email + password), OTP reset, digital card with rotating QR + barcode, tier, expiry, points, wallet, tickets, bookings, benefits, coupons, rewards, ride packages, history | ✅ (OTP delivery 🔌 SMS/e-mail sender) | `/account`, `services/messaging.ts` |
| 34–37 | Staff (code + PIN or picker + PIN), 15 roles + custom roles, per-module permissions, manager PIN approval with staff/manager/reason/time/reference | ✅ | `staff`, `roles`, `role_permissions`, `manager_approvals`, Admin → Staff / Roles |
| 38 | Shift: opening cash, expected cash formula, actual cash, over/short (approval above tolerance), cash in/out | ✅ | `services/shifts.ts`, `/staff/shifts` |
| 39–40, 52 | Real-time dashboard KPIs & charts, live park map (green/yellow/red), consolidated multi-branch | ✅ | `/staff`, `/staff/map`, `/staff/consolidated` |
| 43–44 | Transaction center (search by txn/ticket/member/wristband/staff/store/date), refunds full/partial/item/ticket/wallet/POS with permission + approval | ✅ | `transactions`, `/staff/transactions`, `services/refunds.ts` |
| 45 | Device management (ID, type, location, IP, last seen, status), heartbeats, offline detection, API keys | ✅ | Admin → Devices |
| 46 | Realtime for gates, approval, status, tickets, rides, queue, POS, kitchen, wallet, dashboard, occupancy, devices | ✅ | Socket.IO rooms (docs/ARCHITECTURE.md) |
| 47 | Offline mode banner, local queue for safe actions, sync, configurable block of high-risk actions | ✅ | `lib/offline.ts`, `/api/sync/batch`, Settings → Offline |
| 48 | Audit log (timestamp, staff, role, device, IP, action, before/after, reason), append-only | ✅ | `audit_logs` + trigger, `/staff/audit` |
| 49 | 20 reports with PDF / Excel / CSV export | ✅ | `services/reports.ts`, `/staff/reports` |
| 50 | Notification center (gate offline, ride closed, capacity, payment failed, low stock, queue too long, duplicate QR, wallet error, device offline…) | ✅ | `notifications`, `/staff/notifications` |
| 53, 125 | Relational schema with FKs, indexes, unique constraints, transactions. All listed tables (or spec-compatible views) | ✅ | `db/migrations/*.sql` |
| 54, 126 | Ledger wallet, idempotency keys, transaction locks, retry, reconciliation, recovery for paid-but-unfulfilled | ✅ | docs/ARCHITECTURE.md → Transaction safety |
| 57 | Camera / USB / 2D scanners, continuous camera, lock after read | ✅ | `CameraScanner.tsx`, `lib/scanner.ts` |
| 60, 124 | Admin settings for everything (dynamic configuration, global + branch override) | ✅ | Settings page, `settings` table |
| 61 | Thai / English / 中文, default language, kiosk language switch | ✅ (staff back office is English with Thai data) | `lib/i18n.ts` |
| 62 | Google Fonts per surface + custom font upload | ✅ | Settings → Fonts |
| 63–64 | Modern, touch-friendly UI, responsive (desktop, POS, tablet, mobile, kiosk, gate display) | ✅ | Tailwind layouts |
| 65, 78 | Receipt 58/80 mm/A4, ticket, wristband printing (browser: USB/Bluetooth via OS; LAN ESC/POS), wristband template | ✅ / 🔌 vendor languages (ZPL/EPL not included) | `Print.tsx`, `hardware/printer/escpos.ts` |
| 66–67 | Sample gate scenarios | ✅ | covered by the journey test and verified in the browser |
| 68–69 | Service layer separation, no direct DB from frontend, validation, error handling, loading/empty states, retry, security, logging | ✅ | — |
| 72–73, 108 | Card management (issue, activate, deactivate, replace, suspend, lost, bind/unbind, balance, tickets, rides, transactions, points, expiration, full-screen barcode), card scan everywhere, card profile tabs | ✅ | `/staff/cards`, `CardProfileView` |
| 75, 98–103, 123 | Universal purchase → rights added instantly; buy ride at scanner (wallet / PromptPay dynamic QR / card terminal / cash waits for operator); add-on price normal/member/tier/peak | ✅ / 🔌 card terminal | `purchaseAtRide`, `/ride/:id/scanner` |
| 77, 110–112 | Temporary wristband (no membership), expiration policy, remaining balance policy (refundable / partial / non-refundable / transfer to member / keep), booking → wristband flow | ✅ | check-in, Settings → Wallet / Wristband, Counter → Balance refund |
| 79–83, 115–117 | Membership cards, unlimited tiers & prices, validity (days…lifetime), benefits builder, product builder, purchase at web/counter/kiosk, renewal (early discount, grace period), upgrade (full/difference/prorated) | ✅ | `services/membership.ts`, Admin → Membership, `/membership` |
| 86 | Reward store with stock / dates / tier requirement → vouchers | ✅ | `services/rewards.ts` |
| 87–93 | Guest booking, confirmation page with QR/barcode, counter booking scan, pay now / pay at park, slip upload / “check payment”, Payment Verification Center with realtime update of the waiting customer page | ✅ | `/booking/:no`, `/staff/verify` |
| 94–97, 106–107 | Packages (unlimited), multi-day (consecutive / any N within M days, usage per day), ride entitlement ALL / SELECT, engine with ONE_TIME / MULTI_USE / UNLIMITED / TIME_BASED / DATE_BASED, consumption 3→2→1→0 | ✅ | `createPackageEntitlements`, `scanAtRide` |
| 109 | Lost card: search by phone/email/member ID, report lost, transfer member/wallet/tickets/points/rides/booking, history kept | ✅ | `replaceCredential` |
| 113, 120 | Member booking flow with auto member price, booking linked to member card, guest flow end-to-end | ✅ | — |
| 118–119 | Booking back office filters & search, calendar with capacity warnings | ✅ | `/staff/bookings` |
| 128 | Password hashing, rate limiting, sessions, logout all devices, reset, OTP, suspicious login detection, no card numbers stored | ✅ | `services/auth.ts` |
| 129 | Unified experience | ✅ | — |

## Known limitations / next steps

* **Payment gateway**: ships with a simulator (PromptPay dynamic QR is real EMVCo and payable, and the card page is simulated) and a manual PromptPay/slip mode. A production acquirer adapter (Omise, 2C2P, KBank, …) must be implemented against `PaymentGateway`.
* **SMS / e-mail**: `MessageSender` logs to the console. Plug in a provider for OTP, renewal reminders and queue notifications outside the app (in-app/WebSocket notifications already work).
* **Card terminals (EDC), lock boards, gate controllers**: protocol adapters are generic (HTTP / relay / GPIO). Vendor SDKs need thin adapters. RFID/NFC readers are not bundled.
* **Wristband printers**: browser printing + ESC/POS. Zebra ZPL / thermal transfer wristband languages need an adapter.
* **Horizontal scaling**: add the Socket.IO Redis adapter; gate runtimes are per-process (see OPERATIONS.md).
* **Timezone**: business-day calculations assume Asia/Bangkok (UTC+7). Branches in other time zones need the offset threaded through `businessDate()` / reporting SQL.
* The staff back office UI is English (data and customer surfaces are trilingual).
