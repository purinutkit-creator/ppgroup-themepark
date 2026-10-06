# Operations

## Environment variables (`apps/api/.env`)

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `JWT_SECRET` | Session token signing (≥ 32 chars in production) |
| `QR_SIGNING_SECRET` | HMAC for credential QR payloads (≥ 32 chars). **Rotating it invalidates every printed QR**, and barcodes (raw token) keep working |
| `CORS_ORIGIN` | Comma-separated allowed web origins |
| `UPLOAD_DIR` | Slip images & custom fonts (persist this volume) |
| `PAYMENT_PROVIDER` | `simulator` \| `promptpay-manual` \| your adapter |
| `ALLOW_PAYMENT_SIMULATOR` | Must be `true` to allow the simulator in production (demo / staging only) |
| `PROMPTPAY_ID` | Merchant PromptPay mobile number / tax ID / e-wallet ID |
| `HARDWARE_MODE` | `simulator` or `real` |
| `AUTO_MIGRATE` | `false` to disable migrations at boot (run `npm run db:migrate` in your pipeline instead) |
| `RATE_LIMIT_MAX`, `DB_POOL_MAX`, `STAFF_SESSION_HOURS`, `MEMBER_SESSION_DAYS`, `LOG_LEVEL` | Tuning |

## Go-live checklist

1. Generate strong `JWT_SECRET` / `QR_SIGNING_SECRET`; keep them in a secret manager.
2. Run migrations, then create real configuration (the seed is a demo). At minimum: branch, zones, roles (seeded roles are a good start), staff with new PINs, ticket types, packages, rides, scan points, gates, devices, stores, products, tiers, membership products, payment methods, wallet policy, approvals, receipt header / tax ID.
3. Change or deactivate the seeded `OWNER` / `EMP*` accounts.
4. Issue device keys for every scanner, controller, kiosk and KDS, and pair them at `/device-setup`.
5. Implement and configure your payment gateway adapter and the SMS / e-mail `MessageSender` (`services/messaging.ts`) for OTP and notifications.
6. Configure gate controllers (`HARDWARE_MODE=real`) and verify hardware safety functions independently of the software.
7. Put the API behind TLS (nginx config in `apps/web/nginx.conf` proxies `/api` and `/socket.io`).
8. Schedule PostgreSQL backups (PITR recommended). `wallet_ledger`, `transactions`, `audit_logs` and `points_ledger` are your financial record.

## Background jobs (`apps/api/src/jobs.ts`)

All jobs take a PostgreSQL advisory lock, so only one API instance runs each job.

| Job | Every | Does |
|---|---|---|
| device-offline-sweep | 30 s | devices silent > 90 s → OFFLINE + notification |
| queue-expire | 30 s | called guests past their window → NO_SHOW |
| payment-expiry | 1 min | expire pending payments / unpaid online bookings, release tickets, expire scanner purchase requests |
| end-of-day | 10 min | tickets → USED / EXPIRED, reset presence, NO_SHOW bookings, expire entitlements & credentials, overdue lockers, membership expiry & renewal reminders |
| fulfillment-retry | 1 min | retry fulfilment of paid-but-unfulfilled orders |
| wallet-reconciliation | 15 min | cached balance vs ledger sum → CRITICAL notification on mismatch |
| idempotency-cleanup | 1 h | drop idempotency records older than 7 days |

## Scaling

* API is stateless except for gate runtime timers and Socket.IO rooms. For more than one instance:
  add the Socket.IO Redis adapter and use sticky sessions. Pin gate hardware ownership per branch to one instance (or a dedicated gate worker).
* Read-heavy dashboards can move to a read replica (all report queries are plain SQL in `services/reports.ts` / `dashboard.ts`).
* Multi-branch: every operational table carries `branch_id`; staff are scoped to their branch unless HQ (`branch_id NULL`) or holding `dashboard.consolidated`.

## Monitoring

* `GET /api/health` (DB round-trip) is used by Docker health checks.
* Structured JSON logs (pino) with authorization headers and device keys redacted.
* Notification Center surfaces operational alerts (gate/device offline, capacity, low stock, long queues, duplicate QR, payment failures, wallet mismatches, fulfilment failures).
