# API reference

Base URL: `/api`. JSON in / out. Money is **integer satang** (฿1 = 100). Dates are `YYYY-MM-DD` (park business day, Asia/Bangkok).

## Authentication

| Principal | How | Notes |
|---|---|---|
| Staff | `POST /api/auth/staff/login {employeeCode \| staffId, pin}` → `Authorization: Bearer <jwt>` | Session-backed JWT (revocable). Permissions from role (RBAC). |
| Member | `POST /api/member/login {identifier, password}` → Bearer | Phone or e-mail. Lockout + suspicious-login alerts. |
| Device | `X-Device-Key: tpd_<prefix>_<secret>` | Gate scanners, ride scanners, kiosks, KDS, controllers. Issue in Admin → Devices. |
| Guest booking | `?token=` (booking secret from confirmation link) | View booking, pay, upload slip, subscribe to realtime. |

## Conventions

* **Idempotency:** send `Idempotency-Key: <uuid>` on every money-moving POST (POS checkout, payments, top-up, ride purchase, refunds, bookings). Retries return the original response.
* **Errors:** `{ "error": { "code": "INSUFFICIENT_BALANCE", "message": "...", "details": {...} } }`. Common codes: `VALIDATION_ERROR` (400), `UNAUTHORIZED` (401), `FORBIDDEN` / `APPROVAL_REQUIRED` (403), `NOT_FOUND` (404), `GATE_BUSY` / `ALREADY_PAID` / `REQUEST_IN_PROGRESS` (409), business rule violations (422), `RATE_LIMITED` (429).
* **Manager approval:** when an action answers `403 APPROVAL_REQUIRED`, call `POST /api/approvals {employeeCode, pin, action, reason}` and retry with `approvalId`.
* **Scan payloads:** any endpoint that takes `code` / `scan` accepts the QR payload (`TP1.…` / `TP2.…`), the raw barcode token, or a URL ending in `/c/<payload>`. Staff with `credential.lookup_code` may also type the printed card ID or physical serial.

## Key flows

```
Gate:      POST /gates/:id/scan {code}  → result PENDING | AUTO_APPROVED | DENIED  (+ realtime gate.scan to gates:{branch})
           POST /gates/:id/approve {scanId} | /deny → gate.display GRANTED → controller OPEN → PASSAGE → CLOSED
Ride:      POST /rides/:id/scan {code, scanPointId} → GRANTED | NOT_INCLUDED (purchase offer) | DENIED
           POST /rides/:id/purchase {code, method: WALLET|PROMPTPAY|CARD|CASH}  (Idempotency-Key)
Booking:   POST /public/bookings → POST /public/bookings/:no/pay {token, method} → POST /public/payments/:id/slip
           → POST /payment-verifications/:id/review {decision: APPROVE} → realtime booking.updated
Counter:   POST /bookings → POST /orders/:id/payments (split) → POST /bookings/:id/checkin {assignments}
POS:       POST /pos/checkout {storeId, items, scan, payments}  (Idempotency-Key)
Wallet:    POST /wallet/topup · /wallet/adjust · /wallet/cashout
```

## Hardware events

`POST /api/gates/:id/hardware-event {type: PASSAGE|NO_PASSAGE|CLOSED|OBSTRUCTION|FIRE_ALARM|EMERGENCY_RELEASE|FAULT|ONLINE|OFFLINE, active?, message?}` (device key), `POST /api/devices/heartbeat` (device key).

## Realtime (Socket.IO, path `/socket.io`)

Handshake `auth: { token?, deviceKey? }`, then `emit('subscribe', { rooms: [...], bookingToken? })`. Events: `gate.scan`, `gate.state`, `gate.decision`, `gate.display`, `gate.security`, `gate.command`, `occupancy.changed`, `ride.scan`, `ride.status`, `ride.purchase.request`, `ride.purchase.updated`, `queue.changed`, `queue.updated`, `kitchen.order`, `order.paid`, `order.kitchen`, `wallet.updated`, `points.updated`, `entitlements.updated`, `ticket.updated`, `credential.updated`, `booking.created`, `booking.updated`, `payverify.new`, `payverify.updated`, `locker.updated`, `device.status`, `notification`, `dashboard.changed`, `config.changed`.

## Endpoints

### Auth & sessions

```
POST   /api/auth/staff/login
GET    /api/auth/staff-directory
GET    /api/auth/me
POST   /api/auth/logout
POST   /api/auth/logout-all
```

### Member portal (member JWT)

```
POST   /api/member/register
POST   /api/member/login
POST   /api/member/password/forgot
POST   /api/member/password/reset
POST   /api/member/password/change
GET    /api/member/me
PATCH  /api/member/me
GET    /api/member/card
GET    /api/member/tickets
GET    /api/member/bookings
POST   /api/member/tickets/attach
GET    /api/member/wallet
GET    /api/member/transactions
GET    /api/member/points
GET    /api/member/rides
GET    /api/member/entitlements
GET    /api/member/queues
POST   /api/member/queues/:rideId/join
POST   /api/member/queues/entry/:id/cancel
GET    /api/member/orders
GET    /api/member/lockers
GET    /api/member/coupons
GET    /api/member/vouchers
GET    /api/member/rewards
POST   /api/member/rewards/:id/redeem
GET    /api/member/notifications
POST   /api/member/notifications/read
GET    /api/member/sessions
POST   /api/member/checkout
GET    /api/member/orders/:id/status
```

### Public website / booking / payments

```
GET    /api/public/config
GET    /api/public/fonts/:file
GET    /api/public/branches
GET    /api/public/ticket-types
GET    /api/public/packages
GET    /api/public/addons
GET    /api/public/availability
GET    /api/public/occupancy
GET    /api/public/rides
GET    /api/public/membership-products
GET    /api/public/menu
GET    /api/public/stores
GET    /api/public/kitchen/:storeId/board
POST   /api/public/quote
POST   /api/public/bookings
GET    /api/public/bookings/:no
POST   /api/public/bookings/:no/pay
POST   /api/public/payments/:id/slip
POST   /api/public/payments/:id/simulate
GET    /api/public/payments/:id
POST   /api/payments/webhook/:provider
POST   /api/public/food-orders
```

### Approvals

```
POST   /api/approvals
```

### Cards / wristbands / credentials

```
POST   /api/credentials/scan
GET    /api/credentials
GET    /api/credentials/:id
GET    /api/credentials/:id/barcode
GET    /api/credentials/:id/history
POST   /api/credentials/issue
POST   /api/credentials/:id/status
POST   /api/credentials/:id/replace
POST   /api/credentials/:id/bind
POST   /api/credentials/:id/unbind
POST   /api/credentials/:id/rotate
POST   /api/credentials/:id/link-ticket
```

### Wallet

```
POST   /api/wallet/topup
POST   /api/wallet/adjust
POST   /api/wallet/cashout
GET    /api/wallet/reconcile
```

### POS / orders / payments

```
GET    /api/pos/catalog
POST   /api/pos/checkout
POST   /api/orders/:id/payments
POST   /api/orders/:id/payments/initiate
POST   /api/payments/:id/confirm
GET    /api/orders
GET    /api/orders/:id
POST   /api/orders/:id/cancel
POST   /api/orders/:id/refund
POST   /api/orders/:id/void
GET    /api/promptpay-qr
```

### Kitchen

```
GET    /api/kitchen/:storeId/orders
POST   /api/kitchen/orders/:id/status
```

### Bookings (staff)

```
GET    /api/bookings
GET    /api/bookings/calendar
POST   /api/bookings/scan
GET    /api/bookings/:id
POST   /api/bookings/quote
POST   /api/bookings
POST   /api/bookings/:id/checkin
POST   /api/bookings/:id/cancel
```

### Members (staff)

```
GET    /api/members
POST   /api/members
GET    /api/members/:id
PATCH  /api/members/:id
POST   /api/members/:id/link-card
POST   /api/members/:id/points
POST   /api/members/:id/membership
```

### Shifts

```
GET    /api/shifts/current
POST   /api/shifts/open
POST   /api/shifts/cash-movement
POST   /api/shifts/:id/close
GET    /api/shifts/:id
GET    /api/shifts
```

### Transactions & refunds

```
GET    /api/transactions
GET    /api/refunds
```

### Gates

```
GET    /api/gates
GET    /api/gates/:gateId/status
GET    /api/gates/:gateId
POST   /api/gates/:gateId/scan
POST   /api/gates/:gateId/approve
POST   /api/gates/:gateId/deny
POST   /api/gates/:gateId/open
POST   /api/gates/:gateId/close
POST   /api/gates/:gateId/reset
POST   /api/gates/:gateId/scans/:scanId/override
POST   /api/gates/emergency
PATCH  /api/gates/:gateId/mode
POST   /api/gates/:gateId/hardware-event
GET    /api/gates/scans/log
GET    /api/occupancy
GET    /api/security-events
POST   /api/security-events/:id/ack
```

### Rides & queue

```
GET    /api/rides
GET    /api/rides/:rideId/operator
GET    /api/rides/:rideId/scan-points
POST   /api/rides/:rideId/scan
POST   /api/rides/:rideId/purchase
POST   /api/rides/purchase-requests/:id/confirm-cash
POST   /api/rides/purchase-requests/:id/cancel
GET    /api/rides/purchase-requests/:id
POST   /api/rides/:rideId/status
POST   /api/rides/:rideId/manual-approve
POST   /api/rides/:rideId/manual-deny
GET    /api/rides/:rideId/queue
POST   /api/rides/:rideId/queue/join
POST   /api/rides/:rideId/queue/call
POST   /api/queue/:entryId/cancel
```

### Lockers

```
GET    /api/lockers
GET    /api/lockers/rates
POST   /api/lockers/rent
POST   /api/lockers/open
POST   /api/lockers/sessions/:id/end
```

### Kiosk (device key)

```
POST   /api/kiosk/card
POST   /api/kiosk/topup
POST   /api/kiosk/food-order
```

### Dashboard & reports

```
GET    /api/dashboard
GET    /api/dashboard/consolidated
GET    /api/reports
GET    /api/reports/:key
```

### Notifications / audit / devices

```
GET    /api/notifications
POST   /api/notifications/:id/ack
POST   /api/notifications/ack-all
GET    /api/audit
POST   /api/devices/heartbeat
```

### Inventory

```
GET    /api/inventory
GET    /api/inventory/movements
POST   /api/inventory/move
POST   /api/inventory/transfer
```

### Payment verification center

```
GET    /api/payment-verifications
POST   /api/payment-verifications/:id/review
GET    /api/payment-verifications/:id/slip
```

### Admin configuration (CRUD)

```
GET    /api/admin/branches
GET    /api/admin/branches/:id
POST   /api/admin/branches
PATCH  /api/admin/branches/:id
DELETE /api/admin/branches/:id
GET    /api/admin/zones
GET    /api/admin/zones/:id
POST   /api/admin/zones
PATCH  /api/admin/zones/:id
DELETE /api/admin/zones/:id
GET    /api/admin/ticket-types
GET    /api/admin/ticket-types/:id
POST   /api/admin/ticket-types
PATCH  /api/admin/ticket-types/:id
DELETE /api/admin/ticket-types/:id
GET    /api/admin/packages
GET    /api/admin/packages/:id
POST   /api/admin/packages
PATCH  /api/admin/packages/:id
DELETE /api/admin/packages/:id
GET    /api/admin/packages/:id/composition
PUT    /api/admin/packages/:id/composition
GET    /api/admin/rides
GET    /api/admin/rides/:id
POST   /api/admin/rides
PATCH  /api/admin/rides/:id
DELETE /api/admin/rides/:id
PUT    /api/admin/rides/:id/tier-prices
GET    /api/admin/rides/:id/tier-prices
GET    /api/admin/scan-points
GET    /api/admin/scan-points/:id
POST   /api/admin/scan-points
PATCH  /api/admin/scan-points/:id
DELETE /api/admin/scan-points/:id
GET    /api/admin/gates
GET    /api/admin/gates/:id
POST   /api/admin/gates
PATCH  /api/admin/gates/:id
DELETE /api/admin/gates/:id
GET    /api/admin/devices
GET    /api/admin/devices/:id
POST   /api/admin/devices
PATCH  /api/admin/devices/:id
DELETE /api/admin/devices/:id
POST   /api/admin/devices/:id/key
PUT    /api/admin/gates/:id/devices
GET    /api/admin/stores
GET    /api/admin/stores/:id
POST   /api/admin/stores
PATCH  /api/admin/stores/:id
DELETE /api/admin/stores/:id
GET    /api/admin/categories
GET    /api/admin/categories/:id
POST   /api/admin/categories
PATCH  /api/admin/categories/:id
DELETE /api/admin/categories/:id
GET    /api/admin/products
GET    /api/admin/products/:id
POST   /api/admin/products
PATCH  /api/admin/products/:id
DELETE /api/admin/products/:id
PUT    /api/admin/products/:id/stores
GET    /api/admin/tiers
GET    /api/admin/tiers/:id
POST   /api/admin/tiers
PATCH  /api/admin/tiers/:id
DELETE /api/admin/tiers/:id
GET    /api/admin/membership-products
GET    /api/admin/membership-products/:id
POST   /api/admin/membership-products
PATCH  /api/admin/membership-products/:id
DELETE /api/admin/membership-products/:id
PUT    /api/admin/membership-products/:id/benefits
GET    /api/admin/promotions
GET    /api/admin/promotions/:id
POST   /api/admin/promotions
PATCH  /api/admin/promotions/:id
DELETE /api/admin/promotions/:id
GET    /api/admin/coupons
GET    /api/admin/coupons/:id
POST   /api/admin/coupons
PATCH  /api/admin/coupons/:id
DELETE /api/admin/coupons/:id
POST   /api/admin/coupons/generate
GET    /api/admin/rewards
GET    /api/admin/rewards/:id
POST   /api/admin/rewards
PATCH  /api/admin/rewards/:id
DELETE /api/admin/rewards/:id
GET    /api/admin/lockers
GET    /api/admin/lockers/:id
POST   /api/admin/lockers
PATCH  /api/admin/lockers/:id
DELETE /api/admin/lockers/:id
GET    /api/admin/locker-rates
GET    /api/admin/locker-rates/:id
POST   /api/admin/locker-rates
PATCH  /api/admin/locker-rates/:id
DELETE /api/admin/locker-rates/:id
GET    /api/admin/staff
GET    /api/admin/staff/:id
POST   /api/admin/staff
PATCH  /api/admin/staff/:id
DELETE /api/admin/staff/:id
GET    /api/admin/roles
GET    /api/admin/roles/:id
POST   /api/admin/roles
PATCH  /api/admin/roles/:id
DELETE /api/admin/roles/:id
PUT    /api/admin/roles/:id/permissions
GET    /api/admin/permissions
GET    /api/admin/settings
PUT    /api/admin/settings/:key
POST   /api/admin/fonts
GET    /api/admin/print-templates
GET    /api/admin/print-templates/:id
POST   /api/admin/print-templates
PATCH  /api/admin/print-templates/:id
DELETE /api/admin/print-templates/:id
```

### Printing

```
GET    /api/print/receipt/:orderId
GET    /api/print/wristband/:credentialId
GET    /api/print/booking/:bookingId
POST   /api/print/network
```

### Offline sync

```
POST   /api/sync/batch
```

### Runtime settings

```
GET    /api/settings/runtime
```

