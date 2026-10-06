# 🎡 PP Group Theme Park — “ONE QR — ONE EXPERIENCE”

Full-stack management platform for theme parks, indoor playgrounds and family entertainment centers.
One credential (QR ticket, barcode booking, printed/RFID-ready wristband, physical or digital member card)
works as **member ID, admission ticket, ride pass, cashless wallet, food & retail payment, locker key,
virtual-queue pass and coupon carrier**. Every scan is validated server-side against PostgreSQL, and every
screen updates in real time over WebSocket.

```
BOOK → PAY → SCAN → ENTER → PLAY → BUY → EAT → SHOP → REDEEM → EXIT   (one credential for the whole journey)
```

| Layer | Tech |
|---|---|
| API | Node 22, TypeScript, Fastify 5, Zod, `pg` (raw SQL, explicit transactions & row locks), Socket.IO |
| Database | PostgreSQL 16 — 60+ tables, FKs, CHECK constraints, partial unique indexes, append-only ledgers |
| Web | React 19, Vite, Tailwind 4, TanStack Query, Zustand, Recharts, ZXing camera scanner, QR/Code128 |
| Hardware | Adapter layer: gate controllers (simulator, turnstile, flap, swing, relay, GPIO, network), lockers, ESC/POS printers, card terminal, payment gateway |

---

## Quick start (development)

Requirements: Node ≥ 20, PostgreSQL ≥ 14.

```bash
npm install
cp apps/api/.env.example apps/api/.env        # adjust DATABASE_URL
createdb themepark                            # or: psql -c 'CREATE DATABASE themepark'
npm run db:migrate                            # applies apps/api/src/db/migrations/*.sql
npm run db:seed                               # optional: one fully configured demo branch
npm run dev                                   # API :4000 + Web :5173 (Vite proxies /api and /socket.io)
```

Open **http://localhost:5173** (customer website) and **http://localhost:5173/staff/login** (back office).

### Demo logins (created by the seed — change PINs immediately in production)

| Who | Login | PIN / password | Lands on |
|---|---|---|---|
| Owner (all branches) | `OWNER` | `000000` | Consolidated dashboard |
| Admin | `EMP001` | `1111` | Everything |
| Park manager (approver) | `EMP002` | `2222` | Dashboard, approvals |
| Supervisor (approver) | `EMP003` | `3333` | Overrides, refunds |
| Ticket cashier | `EMP010` | `1010` | Ticket counter |
| Gate operator | `EMP020` | `2020` | Gate console |
| Ride operator | `EMP030` | `3030` | Rides |
| Restaurant / kitchen | `EMP040` / `EMP041` | `4040` / `4141` | POS / KDS |
| Retail | `EMP050` | `5050` | POS |
| Customer service | `EMP070` | `7070` | Cards, bookings, refunds |
| Finance | `EMP080` | `8080` | Reports, transactions |
| Demo member (Gold, ฿500 wallet, 320 pts) | `0812345678` | `member1234` | `/account` |

Device API keys for every seeded scanner / controller / kiosk are written to `apps/api/.device-keys.local.json`
(git-ignored). Pair a browser with a device at **/device-setup**, or simply log in as staff on device screens.

### Screens

| URL | Surface |
|---|---|
| `/` `/book` `/booking/:no` `/membership` `/rides-status` | Customer website, booking wizard, booking confirmation with live payment status |
| `/login` `/register` `/forgot` `/account` | Member login (phone/email + password, OTP reset) and member portal (digital card with rotating QR, tickets, wallet, rewards, queue, orders, lockers, security) |
| `/order/:storeId` | QR / mobile food ordering |
| `/kiosk` | Self-service kiosk (TH / EN / 中文): buy ticket, top-up, balance/ticket/queue check, food, ride status, register |
| `/gate/:gateId/display` | Full-screen gate customer display with camera + USB scanner |
| `/ride/:rideId/scanner` | Ride scanner: entitlement check, buy-at-scanner (wallet / PromptPay / card / cash), join queue |
| `/kds/:storeId` `/board/:storeId` | Kitchen display, order-ready board |
| `/staff/*` | Back office: dashboard, consolidated, live park map, **10-gate operator console**, ride operator, ticket counter, POS, cards & wristbands, members, bookings + calendar, payment verification center, transaction center, lockers, shifts, inventory, reports (PDF/Excel/CSV), notifications, audit log, all configuration |

### Tests

```bash
createdb themepark_test
npm test        # 35 tests: full customer journey on a real database + unit tests
```

The journey test drives the real HTTP API: counter sale → cash with change → wristbands → top-up (idempotent) →
gate scan in MANUAL mode → operator approval → anti-passback duplicate at another gate → auto gate → ride
entitlement → VR not included → buy with wallet (idempotent) → Go-Kart 3→2→1→0→denied → cash-at-ride needs a shift →
POS double-tap idempotency → concurrent wallet debits can't overdraw → KDS → manager-approved void → ledger
reconciliation → online booking + PromptPay slip + verification → booking barcode at counter → lost wristband
replacement (old denied, wallet moved) → member dynamic QR → RBAC → append-only audit.

### Production

```bash
export JWT_SECRET=$(openssl rand -base64 48) QR_SIGNING_SECRET=$(openssl rand -base64 48)
docker compose up -d --build          # db + api + web (nginx on :8080)
docker compose exec api node dist/db/seed.js   # optional demo configuration
```

See **[docs/OPERATIONS.md](docs/OPERATIONS.md)** before going live.

## Documentation

* [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): services, data model, transaction safety, realtime, security, offline
* [docs/API.md](docs/API.md): endpoint catalogue
* [docs/HARDWARE.md](docs/HARDWARE.md): gate / locker / printer / payment adapters, edge agent, safety
* [docs/OPERATIONS.md](docs/OPERATIONS.md): deployment, secrets, backups, payment provider, scaling
* [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md): requirement-by-requirement coverage and known limitations
