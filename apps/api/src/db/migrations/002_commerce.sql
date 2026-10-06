-- =====================================================================
-- Catalog, packages, rides, credentials, bookings, tickets, orders,
-- payments, wallet ledger, transactions
-- =====================================================================

-- ---------------------------------------------------------------------
-- Rides & scan points
-- ---------------------------------------------------------------------
CREATE TABLE rides (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id          UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  zone_id            UUID REFERENCES zones(id) ON DELETE SET NULL,
  code               TEXT NOT NULL,
  name               TEXT NOT NULL,
  name_en            TEXT,
  description        TEXT,
  image_url          TEXT,
  min_height_cm      INTEGER,
  max_height_cm      INTEGER,
  min_age            INTEGER,
  max_age            INTEGER,
  capacity_per_cycle INTEGER NOT NULL DEFAULT 10 CHECK (capacity_per_cycle > 0),
  cycle_minutes      NUMERIC(6,2) NOT NULL DEFAULT 5 CHECK (cycle_minutes > 0),
  status             TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','CLOSED','MAINTENANCE','TEMPORARILY_CLOSED')),
  entry_paused       BOOLEAN NOT NULL DEFAULT false,
  addon_enabled      BOOLEAN NOT NULL DEFAULT true,
  addon_price        BIGINT NOT NULL DEFAULT 0 CHECK (addon_price >= 0),
  addon_member_price BIGINT CHECK (addon_member_price >= 0),
  addon_peak_price   BIGINT CHECK (addon_peak_price >= 0),
  addon_entitlement_type TEXT NOT NULL DEFAULT 'ONE_TIME' CHECK (addon_entitlement_type IN ('ONE_TIME','MULTI_USE','UNLIMITED','TIME_BASED','DATE_BASED')),
  addon_uses         INTEGER NOT NULL DEFAULT 1 CHECK (addon_uses > 0),
  point_requirement  INTEGER NOT NULL DEFAULT 0,
  queue_enabled      BOOLEAN NOT NULL DEFAULT true,
  queue_prefix       TEXT NOT NULL DEFAULT 'A',
  queue_call_window_min INTEGER NOT NULL DEFAULT 10,
  operator_staff_id  UUID REFERENCES staff(id) ON DELETE SET NULL,
  sort               INTEGER NOT NULL DEFAULT 0,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (branch_id, code)
);
CREATE TRIGGER trg_rides_updated BEFORE UPDATE ON rides FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE ride_tier_prices (
  ride_id   UUID NOT NULL REFERENCES rides(id) ON DELETE CASCADE,
  tier_id   UUID NOT NULL REFERENCES member_tiers(id) ON DELETE CASCADE,
  price     BIGINT NOT NULL CHECK (price >= 0),
  PRIMARY KEY (ride_id, tier_id)
);

CREATE TABLE ride_scan_points (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code              TEXT NOT NULL UNIQUE,
  ride_id           UUID NOT NULL REFERENCES rides(id) ON DELETE CASCADE,
  zone_id           UUID REFERENCES zones(id) ON DELETE SET NULL,
  device_id         UUID REFERENCES devices(id) ON DELETE SET NULL,
  name              TEXT NOT NULL,
  location          TEXT,
  payment_enabled   BOOLEAN NOT NULL DEFAULT true,
  payment_methods   TEXT[] NOT NULL DEFAULT ARRAY['WALLET','PROMPTPAY','CARD','CASH'],
  operator_staff_id UUID REFERENCES staff(id) ON DELETE SET NULL,
  status            TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_rsp_updated BEFORE UPDATE ON ride_scan_points FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------
-- Ticket types (guest categories) & packages (sellable products)
-- ---------------------------------------------------------------------
CREATE TABLE ticket_types (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code        TEXT NOT NULL UNIQUE,     -- ADULT, CHILD, SENIOR, STUDENT ...
  name        TEXT NOT NULL,
  name_en     TEXT,
  min_age     INTEGER,
  max_age     INTEGER,
  min_height_cm INTEGER,
  max_height_cm INTEGER,
  requires_id BOOLEAN NOT NULL DEFAULT false,
  sort        INTEGER NOT NULL DEFAULT 0,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE packages (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id          UUID REFERENCES branches(id) ON DELETE CASCADE,  -- NULL = all branches
  code               TEXT NOT NULL UNIQUE,
  name               TEXT NOT NULL,
  name_en            TEXT,
  name_zh            TEXT,
  description        TEXT,
  image_url          TEXT,
  category           TEXT NOT NULL DEFAULT 'ADMISSION' CHECK (category IN ('ADMISSION','DAY_PASS','HALF_DAY','EVENING','UNLIMITED','VIP',
                        'GROUP','SCHOOL','CORPORATE','BIRTHDAY','FAMILY','MULTI_DAY','RIDE_PASS','OTHER')),
  pricing_mode       TEXT NOT NULL DEFAULT 'PER_GUEST' CHECK (pricing_mode IN ('PER_GUEST','BUNDLE')),
  bundle_price       BIGINT CHECK (bundle_price >= 0),
  bundle_member_price BIGINT CHECK (bundle_member_price >= 0),
  bundle_guests      JSONB NOT NULL DEFAULT '[]'::jsonb,   -- [{ticket_type_code, qty}]
  days               INTEGER NOT NULL DEFAULT 1 CHECK (days > 0),
  multi_day_mode     TEXT NOT NULL DEFAULT 'CONSECUTIVE' CHECK (multi_day_mode IN ('CONSECUTIVE','ANY_WITHIN')),
  any_within_days    INTEGER,
  valid_from         DATE,
  valid_to           DATE,
  valid_days_of_week INTEGER[] NOT NULL DEFAULT ARRAY[0,1,2,3,4,5,6],
  valid_time_start   TIME,
  valid_time_end     TIME,
  sale_start         TIMESTAMPTZ,
  sale_end           TIMESTAMPTZ,
  min_age            INTEGER,
  max_age            INTEGER,
  min_height_cm      INTEGER,
  max_height_cm      INTEGER,
  entries_per_day    INTEGER,                 -- NULL = unlimited (subject to reentry_allowed)
  reentry_allowed    BOOLEAN NOT NULL DEFAULT true,
  transferable       BOOLEAN NOT NULL DEFAULT false,
  ride_access        TEXT NOT NULL DEFAULT 'SELECT' CHECK (ride_access IN ('ALL','SELECT','NONE')),
  ride_access_type   TEXT NOT NULL DEFAULT 'UNLIMITED' CHECK (ride_access_type IN ('ONE_TIME','MULTI_USE','UNLIMITED','TIME_BASED','DATE_BASED')),
  ride_access_uses   INTEGER,
  zone_access        TEXT NOT NULL DEFAULT 'ALL' CHECK (zone_access IN ('ALL','SELECT')),
  refund_policy      TEXT NOT NULL DEFAULT 'NON_REFUNDABLE' CHECK (refund_policy IN ('NON_REFUNDABLE','FULL_BEFORE_VISIT','PARTIAL_BEFORE_VISIT','ANYTIME')),
  refund_percent     NUMERIC(5,2) NOT NULL DEFAULT 100,
  refund_cutoff_hours INTEGER NOT NULL DEFAULT 24,
  daily_capacity     INTEGER,
  wallet_credit      BIGINT NOT NULL DEFAULT 0 CHECK (wallet_credit >= 0),
  member_card_entry  BOOLEAN NOT NULL DEFAULT true,  -- member card may be used instead of ticket QR
  earn_points        BOOLEAN NOT NULL DEFAULT true,
  channels           TEXT[] NOT NULL DEFAULT ARRAY['ONLINE','COUNTER','KIOSK'],
  is_active          BOOLEAN NOT NULL DEFAULT true,
  sort               INTEGER NOT NULL DEFAULT 0,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_packages_updated BEFORE UPDATE ON packages FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE package_prices (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id     UUID NOT NULL REFERENCES packages(id) ON DELETE CASCADE,
  ticket_type_id UUID NOT NULL REFERENCES ticket_types(id),
  price          BIGINT NOT NULL CHECK (price >= 0),
  member_price   BIGINT CHECK (member_price >= 0),
  peak_price     BIGINT CHECK (peak_price >= 0),
  UNIQUE (package_id, ticket_type_id)
);

CREATE TABLE package_rides (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id       UUID NOT NULL REFERENCES packages(id) ON DELETE CASCADE,
  ride_id          UUID NOT NULL REFERENCES rides(id) ON DELETE CASCADE,
  entitlement_type TEXT NOT NULL DEFAULT 'UNLIMITED' CHECK (entitlement_type IN ('ONE_TIME','MULTI_USE','UNLIMITED','TIME_BASED','DATE_BASED')),
  uses             INTEGER CHECK (uses > 0),
  valid_until_time TIME,
  UNIQUE (package_id, ride_id)
);

CREATE TABLE package_zones (
  package_id UUID NOT NULL REFERENCES packages(id) ON DELETE CASCADE,
  zone_id    UUID NOT NULL REFERENCES zones(id) ON DELETE CASCADE,
  PRIMARY KEY (package_id, zone_id)
);

CREATE TABLE package_benefits (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id  UUID NOT NULL REFERENCES packages(id) ON DELETE CASCADE,
  type        TEXT NOT NULL CHECK (type IN ('FOOD_VOUCHER','LOCKER','FAST_PASS','WALLET_CREDIT','PHOTO','CUSTOM')),
  value       BIGINT NOT NULL DEFAULT 0,
  label       TEXT,
  config      JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE package_blackout_dates (
  package_id UUID NOT NULL REFERENCES packages(id) ON DELETE CASCADE,
  date       DATE NOT NULL,
  note       TEXT,
  PRIMARY KEY (package_id, date)
);

-- Compatibility view: the spec's "ticket_types" sellable products == packages × guest types
CREATE VIEW ticket_products AS
  SELECT p.id AS package_id, p.code AS package_code, p.name AS package_name, tt.id AS ticket_type_id,
         tt.code AS ticket_type_code, pp.price, pp.member_price
    FROM packages p JOIN package_prices pp ON pp.package_id = p.id JOIN ticket_types tt ON tt.id = pp.ticket_type_id;

-- ---------------------------------------------------------------------
-- Stores / catalog
-- ---------------------------------------------------------------------
CREATE TABLE stores (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id   UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  zone_id     UUID REFERENCES zones(id) ON DELETE SET NULL,
  code        TEXT NOT NULL,
  name        TEXT NOT NULL,
  type        TEXT NOT NULL CHECK (type IN ('TICKET','RESTAURANT','RETAIL','KIOSK','LOCKER','WAREHOUSE','RIDE','SERVICE')),
  is_active   BOOLEAN NOT NULL DEFAULT true,
  settings    JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (branch_id, code)
);

CREATE TABLE categories (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id   UUID REFERENCES branches(id) ON DELETE CASCADE,
  parent_id   UUID REFERENCES categories(id) ON DELETE SET NULL,
  code        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  type        TEXT NOT NULL CHECK (type IN ('FOOD','DRINK','SOUVENIR','MERCHANDISE','PHOTO','LOCKER','SERVICE','ADDON')),
  points_category TEXT NOT NULL DEFAULT 'RETAIL' CHECK (points_category IN ('TICKET','FOOD','RETAIL','TOPUP','PACKAGE','NONE')),
  sort        INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE products (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id           UUID REFERENCES branches(id) ON DELETE CASCADE,
  sku                 TEXT NOT NULL UNIQUE,
  barcode             TEXT UNIQUE,
  name                TEXT NOT NULL,
  name_en             TEXT,
  description         TEXT,
  image_url           TEXT,
  category_id         UUID REFERENCES categories(id) ON DELETE SET NULL,
  price               BIGINT NOT NULL CHECK (price >= 0),
  member_price        BIGINT CHECK (member_price >= 0),
  cost                BIGINT NOT NULL DEFAULT 0 CHECK (cost >= 0),
  tax_included        BOOLEAN NOT NULL DEFAULT true,
  track_stock         BOOLEAN NOT NULL DEFAULT false,
  low_stock_threshold INTEGER NOT NULL DEFAULT 10,
  modifiers           JSONB NOT NULL DEFAULT '[]'::jsonb,  -- [{group, required, max, options:[{name, price}]}]
  send_to_kitchen     BOOLEAN NOT NULL DEFAULT false,
  sellable_online     BOOLEAN NOT NULL DEFAULT false,      -- booking add-on
  is_active           BOOLEAN NOT NULL DEFAULT true,
  sort                INTEGER NOT NULL DEFAULT 0,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_products_category ON products(category_id);
CREATE TRIGGER trg_products_updated BEFORE UPDATE ON products FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE product_stores (
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  store_id   UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  PRIMARY KEY (product_id, store_id)
);

-- ---------------------------------------------------------------------
-- Credentials (cards / wristbands / QR tickets / booking barcodes)
-- ---------------------------------------------------------------------
CREATE TABLE credentials (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code              TEXT NOT NULL UNIQUE,   -- CARD-00001291, WB-00038102, TK-..., BK-...
  type              TEXT NOT NULL CHECK (type IN ('MEMBER_CARD','DIGITAL_CARD','TEMP_CARD','WRISTBAND','PRINTED_WRISTBAND','QR_TICKET','BOOKING')),
  token             TEXT NOT NULL UNIQUE,   -- secure random, printed in QR/barcode
  token_version     INTEGER NOT NULL DEFAULT 1,
  status            TEXT NOT NULL DEFAULT 'NEW' CHECK (status IN ('NEW','ACTIVE','SUSPENDED','LOST','BLOCKED','EXPIRED','REPLACED','CLOSED')),
  account_id        UUID REFERENCES customer_accounts(id),
  member_id         UUID REFERENCES members(id),
  branch_id         UUID REFERENCES branches(id),
  physical_serial   TEXT UNIQUE,            -- pre-printed number / RFID UID
  expiration_policy TEXT NOT NULL DEFAULT 'NONE' CHECK (expiration_policy IN ('NONE','END_OF_DAY','END_OF_VISIT','PACKAGE','FIXED')),
  expires_at        TIMESTAMPTZ,
  issued_by         UUID REFERENCES staff(id),
  issued_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  activated_at      TIMESTAMPTZ,
  replaced_by_id    UUID REFERENCES credentials(id),
  status_reason     TEXT,
  last_used_at      TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_credentials_account ON credentials(account_id);
CREATE INDEX ix_credentials_member ON credentials(member_id);
CREATE INDEX ix_credentials_type_status ON credentials(type, status);
CREATE TRIGGER trg_credentials_updated BEFORE UPDATE ON credentials FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE wristbands (
  credential_id  UUID PRIMARY KEY REFERENCES credentials(id) ON DELETE CASCADE,
  batch          TEXT,
  template_id    UUID,
  printed_at     TIMESTAMPTZ,
  print_count    INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE membership_cards (
  credential_id  UUID PRIMARY KEY REFERENCES credentials(id) ON DELETE CASCADE,
  membership_id  UUID REFERENCES memberships(id),
  is_physical    BOOLEAN NOT NULL DEFAULT true,
  printed_at     TIMESTAMPTZ
);

-- ---------------------------------------------------------------------
-- Orders / payments
-- ---------------------------------------------------------------------
CREATE TABLE shifts (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_no       TEXT NOT NULL UNIQUE,
  branch_id      UUID NOT NULL REFERENCES branches(id),
  store_id       UUID REFERENCES stores(id),
  staff_id       UUID NOT NULL REFERENCES staff(id),
  device_id      UUID REFERENCES devices(id),
  status         TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','CLOSED')),
  opening_cash   BIGINT NOT NULL CHECK (opening_cash >= 0),
  cash_sales     BIGINT,
  cash_topups    BIGINT,
  cash_refunds   BIGINT,
  cash_in        BIGINT,
  cash_out       BIGINT,
  expected_cash  BIGINT,
  actual_cash    BIGINT,
  over_short     BIGINT,
  opened_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at      TIMESTAMPTZ,
  closed_by      UUID REFERENCES staff(id),
  approval_id    UUID REFERENCES manager_approvals(id),
  note           TEXT
);
CREATE UNIQUE INDEX ux_shifts_one_open ON shifts(staff_id) WHERE status = 'OPEN';

CREATE TABLE cash_movements (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_id     UUID NOT NULL REFERENCES shifts(id),
  type         TEXT NOT NULL CHECK (type IN ('CASH_IN','CASH_OUT')),
  amount       BIGINT NOT NULL CHECK (amount > 0),
  reason       TEXT NOT NULL,
  staff_id     UUID NOT NULL REFERENCES staff(id),
  approval_id  UUID REFERENCES manager_approvals(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE orders (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_no         TEXT NOT NULL UNIQUE,
  branch_id        UUID NOT NULL REFERENCES branches(id),
  store_id         UUID REFERENCES stores(id),
  type             TEXT NOT NULL CHECK (type IN ('BOOKING','TICKET','POS','FOOD','RETAIL','TOPUP','MEMBERSHIP','RIDE_ADDON','LOCKER','REWARD')),
  channel          TEXT NOT NULL CHECK (channel IN ('ONLINE','COUNTER','POS','KIOSK','MOBILE','SCANNER','QR_ORDER')),
  status           TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','PARTIALLY_PAID','PAID','CANCELLED','VOID','REFUNDED','PARTIALLY_REFUNDED')),
  account_id       UUID REFERENCES customer_accounts(id),
  member_id        UUID REFERENCES members(id),
  credential_id    UUID REFERENCES credentials(id),
  staff_id         UUID REFERENCES staff(id),
  shift_id         UUID REFERENCES shifts(id),
  device_id        UUID REFERENCES devices(id),
  customer_name    TEXT,
  subtotal         BIGINT NOT NULL DEFAULT 0 CHECK (subtotal >= 0),
  discount_total   BIGINT NOT NULL DEFAULT 0 CHECK (discount_total >= 0),
  tax_total        BIGINT NOT NULL DEFAULT 0 CHECK (tax_total >= 0),
  total            BIGINT NOT NULL DEFAULT 0 CHECK (total >= 0),
  paid_total       BIGINT NOT NULL DEFAULT 0 CHECK (paid_total >= 0),
  refunded_total   BIGINT NOT NULL DEFAULT 0 CHECK (refunded_total >= 0),
  points_earned    INTEGER NOT NULL DEFAULT 0,
  points_redeemed  INTEGER NOT NULL DEFAULT 0,
  promotions       JSONB NOT NULL DEFAULT '[]'::jsonb,
  kitchen_status   TEXT CHECK (kitchen_status IN ('NEW','PREPARING','READY','COMPLETED','CANCELLED')),
  queue_no         TEXT,
  notes            TEXT,
  idempotency_key  TEXT UNIQUE,
  metadata         JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  paid_at          TIMESTAMPTZ,
  voided_at        TIMESTAMPTZ,
  void_reason      TEXT,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (paid_total <= total),
  CHECK (refunded_total <= paid_total)
);
CREATE INDEX ix_orders_branch_created ON orders(branch_id, created_at DESC);
CREATE INDEX ix_orders_store_kitchen ON orders(store_id, kitchen_status) WHERE kitchen_status IS NOT NULL;
CREATE INDEX ix_orders_member ON orders(member_id, created_at DESC);
CREATE INDEX ix_orders_account ON orders(account_id, created_at DESC);
CREATE TRIGGER trg_orders_updated BEFORE UPDATE ON orders FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE memberships ADD CONSTRAINT fk_memberships_order FOREIGN KEY (order_id) REFERENCES orders(id);

CREATE TABLE order_items (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id              UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  item_type             TEXT NOT NULL CHECK (item_type IN ('PRODUCT','PACKAGE','TOPUP','MEMBERSHIP','RIDE_ADDON','LOCKER','REWARD','PHYSICAL_CARD')),
  product_id            UUID REFERENCES products(id),
  package_id            UUID REFERENCES packages(id),
  ticket_type_id        UUID REFERENCES ticket_types(id),
  ride_id               UUID REFERENCES rides(id),
  membership_product_id UUID REFERENCES membership_products(id),
  name                  TEXT NOT NULL,
  qty                   INTEGER NOT NULL CHECK (qty > 0),
  unit_price            BIGINT NOT NULL CHECK (unit_price >= 0),
  discount              BIGINT NOT NULL DEFAULT 0 CHECK (discount >= 0),
  total                 BIGINT NOT NULL CHECK (total >= 0),
  points_category       TEXT,
  modifiers             JSONB NOT NULL DEFAULT '[]'::jsonb,
  notes                 TEXT,
  refunded_qty          INTEGER NOT NULL DEFAULT 0,
  metadata              JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX ix_order_items_order ON order_items(order_id);
CREATE INDEX ix_order_items_product ON order_items(product_id);

CREATE TABLE payments (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_no       TEXT NOT NULL UNIQUE,
  order_id         UUID NOT NULL REFERENCES orders(id),
  method           TEXT NOT NULL CHECK (method IN ('CASH','PROMPTPAY','CARD','DEBIT','BANK_TRANSFER','EWALLET','WALLET','POINTS','MOBILE_BANKING','GATEWAY','VOUCHER')),
  provider         TEXT,
  status           TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','WAITING_VERIFICATION','PAID','FAILED','CANCELLED','EXPIRED','REFUNDED','PARTIALLY_REFUNDED')),
  amount           BIGINT NOT NULL CHECK (amount > 0),
  tendered         BIGINT,
  change_amount    BIGINT,
  reference        TEXT,
  provider_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  channel          TEXT,
  staff_id         UUID REFERENCES staff(id),
  shift_id         UUID REFERENCES shifts(id),
  device_id        UUID REFERENCES devices(id),
  credential_id    UUID REFERENCES credentials(id),
  paid_at          TIMESTAMPTZ,
  refunded_amount  BIGINT NOT NULL DEFAULT 0 CHECK (refunded_amount >= 0),
  idempotency_key  TEXT UNIQUE,
  expires_at       TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (refunded_amount <= amount)
);
CREATE INDEX ix_payments_order ON payments(order_id);
CREATE INDEX ix_payments_status ON payments(status, created_at DESC);
CREATE UNIQUE INDEX ux_payments_provider_ref ON payments(provider, reference) WHERE reference IS NOT NULL AND provider IS NOT NULL;
CREATE TRIGGER trg_payments_updated BEFORE UPDATE ON payments FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------
-- Bookings & tickets
-- ---------------------------------------------------------------------
CREATE TABLE bookings (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_no      TEXT NOT NULL UNIQUE,
  branch_id       UUID NOT NULL REFERENCES branches(id),
  account_id      UUID REFERENCES customer_accounts(id),
  member_id       UUID REFERENCES members(id),
  order_id        UUID NOT NULL UNIQUE REFERENCES orders(id),
  credential_id   UUID REFERENCES credentials(id),
  customer_name   TEXT NOT NULL,
  phone           TEXT NOT NULL,
  email           TEXT,
  visit_date      DATE NOT NULL,
  guests          INTEGER NOT NULL CHECK (guests > 0),
  status          TEXT NOT NULL DEFAULT 'PENDING_PAYMENT' CHECK (status IN ('PENDING_PAYMENT','RESERVED','PENDING_VERIFICATION','CONFIRMED','CHECKED_IN','CANCELLED','REFUNDED','NO_SHOW','EXPIRED')),
  payment_mode    TEXT NOT NULL CHECK (payment_mode IN ('PAY_NOW','PAY_AT_PARK')),
  channel         TEXT NOT NULL DEFAULT 'ONLINE' CHECK (channel IN ('ONLINE','COUNTER','KIOSK')),
  public_token    TEXT NOT NULL UNIQUE,       -- secret for guest view / realtime subscription
  notes           TEXT,
  checked_in_at   TIMESTAMPTZ,
  expires_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_bookings_branch_date ON bookings(branch_id, visit_date);
CREATE INDEX ix_bookings_phone ON bookings(phone);
CREATE INDEX ix_bookings_email ON bookings(lower(email));
CREATE INDEX ix_bookings_member ON bookings(member_id);
CREATE INDEX ix_bookings_status ON bookings(status);
CREATE TRIGGER trg_bookings_updated BEFORE UPDATE ON bookings FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE booking_items (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id     UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  item_type      TEXT NOT NULL CHECK (item_type IN ('PACKAGE','ADDON')),
  package_id     UUID REFERENCES packages(id),
  ticket_type_id UUID REFERENCES ticket_types(id),
  product_id     UUID REFERENCES products(id),
  name           TEXT NOT NULL,
  qty            INTEGER NOT NULL CHECK (qty > 0),
  unit_price     BIGINT NOT NULL,
  total          BIGINT NOT NULL
);

CREATE TABLE tickets (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_code     TEXT NOT NULL UNIQUE,
  branch_id       UUID NOT NULL REFERENCES branches(id),
  booking_id      UUID REFERENCES bookings(id),
  order_id        UUID REFERENCES orders(id),
  package_id      UUID NOT NULL REFERENCES packages(id),
  ticket_type_id  UUID REFERENCES ticket_types(id),
  account_id      UUID REFERENCES customer_accounts(id),
  member_id       UUID REFERENCES members(id),
  guest_name      TEXT,
  guest_birthday  DATE,
  guest_height_cm INTEGER,
  visit_date      DATE NOT NULL,
  valid_from      DATE NOT NULL,
  valid_to        DATE NOT NULL,
  days_allowed    INTEGER NOT NULL DEFAULT 1,
  status          TEXT NOT NULL DEFAULT 'UNPAID' CHECK (status IN ('UNPAID','PAID','ACTIVE','USED','EXPIRED','CANCELLED','REFUNDED')),
  presence        TEXT NOT NULL DEFAULT 'OUTSIDE' CHECK (presence IN ('OUTSIDE','INSIDE')),
  current_zone_id UUID REFERENCES zones(id) ON DELETE SET NULL,
  entry_count     INTEGER NOT NULL DEFAULT 0,
  first_entry_at  TIMESTAMPTZ,
  last_entry_at   TIMESTAMPTZ,
  last_exit_at    TIMESTAMPTZ,
  last_gate_id    UUID,
  price           BIGINT NOT NULL DEFAULT 0,
  discount        BIGINT NOT NULL DEFAULT 0,
  activated_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (valid_to >= valid_from)
);
CREATE INDEX ix_tickets_branch_visit ON tickets(branch_id, visit_date);
CREATE INDEX ix_tickets_booking ON tickets(booking_id);
CREATE INDEX ix_tickets_account ON tickets(account_id);
CREATE INDEX ix_tickets_member ON tickets(member_id);
CREATE INDEX ix_tickets_presence ON tickets(branch_id, presence) WHERE presence = 'INSIDE';
CREATE TRIGGER trg_tickets_updated BEFORE UPDATE ON tickets FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE booking_guests (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id     UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  ticket_type_id UUID REFERENCES ticket_types(id),
  name           TEXT,
  birthday       DATE,
  height_cm      INTEGER,
  ticket_id      UUID REFERENCES tickets(id)
);

CREATE TABLE ticket_day_usage (
  ticket_id      UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  usage_date     DATE NOT NULL,
  first_entry_at TIMESTAMPTZ NOT NULL,
  entries        INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (ticket_id, usage_date)
);

-- credential ↔ ticket / booking links (many-to-many, history preserved)
CREATE TABLE credential_links (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  credential_id UUID NOT NULL REFERENCES credentials(id),
  link_type     TEXT NOT NULL CHECK (link_type IN ('TICKET','BOOKING')),
  ticket_id     UUID REFERENCES tickets(id),
  booking_id    UUID REFERENCES bookings(id),
  created_by    UUID REFERENCES staff(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  unlinked_at   TIMESTAMPTZ,
  CHECK ((link_type = 'TICKET' AND ticket_id IS NOT NULL) OR (link_type = 'BOOKING' AND booking_id IS NOT NULL))
);
CREATE UNIQUE INDEX ux_cred_link_ticket ON credential_links(credential_id, ticket_id) WHERE unlinked_at IS NULL AND ticket_id IS NOT NULL;
CREATE UNIQUE INDEX ux_cred_link_booking ON credential_links(credential_id, booking_id) WHERE unlinked_at IS NULL AND booking_id IS NOT NULL;
CREATE INDEX ix_cred_links_ticket ON credential_links(ticket_id) WHERE unlinked_at IS NULL;

CREATE TABLE card_replacements (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  old_credential_id  UUID NOT NULL REFERENCES credentials(id),
  new_credential_id  UUID NOT NULL REFERENCES credentials(id),
  reason             TEXT NOT NULL CHECK (reason IN ('LOST','DAMAGED','STOLEN','UPGRADE','OTHER')),
  staff_id           UUID REFERENCES staff(id),
  approval_id        UUID REFERENCES manager_approvals(id),
  transferred        JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE payment_verification_requests (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id     UUID NOT NULL REFERENCES payments(id),
  order_id       UUID NOT NULL REFERENCES orders(id),
  booking_id     UUID REFERENCES bookings(id),
  branch_id      UUID NOT NULL REFERENCES branches(id),
  amount_expected BIGINT NOT NULL,
  method         TEXT NOT NULL,
  slip_path      TEXT,
  slip_reference TEXT,
  paid_time      TIMESTAMPTZ,
  customer_note  TEXT,
  status         TEXT NOT NULL DEFAULT 'WAITING' CHECK (status IN ('WAITING','APPROVED','REJECTED','NEW_SLIP_REQUESTED')),
  reviewed_by    UUID REFERENCES staff(id),
  reviewed_at    TIMESTAMPTZ,
  review_note    TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_pvr_status ON payment_verification_requests(branch_id, status, created_at DESC);
CREATE UNIQUE INDEX ux_pvr_one_waiting ON payment_verification_requests(payment_id) WHERE status = 'WAITING';

CREATE TABLE refunds (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  refund_no    TEXT NOT NULL UNIQUE,
  order_id     UUID REFERENCES orders(id),
  payment_id   UUID REFERENCES payments(id),
  wallet_id    UUID,
  type         TEXT NOT NULL CHECK (type IN ('FULL','PARTIAL')),
  scope        TEXT NOT NULL CHECK (scope IN ('ORDER','TICKET','WALLET','POS')),
  amount       BIGINT NOT NULL CHECK (amount > 0),
  method       TEXT NOT NULL CHECK (method IN ('CASH','ORIGINAL','WALLET','BANK_TRANSFER')),
  reason       TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'COMPLETED' CHECK (status IN ('PENDING','COMPLETED','REJECTED','FAILED')),
  items        JSONB NOT NULL DEFAULT '[]'::jsonb,
  staff_id     UUID REFERENCES staff(id),
  shift_id     UUID REFERENCES shifts(id),
  approval_id  UUID REFERENCES manager_approvals(id),
  idempotency_key TEXT UNIQUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_refunds_order ON refunds(order_id);

-- ---------------------------------------------------------------------
-- Ledger based wallet
-- ---------------------------------------------------------------------
CREATE TABLE wallet_accounts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  UUID NOT NULL UNIQUE REFERENCES customer_accounts(id),
  currency    TEXT NOT NULL DEFAULT 'THB',
  balance     BIGINT NOT NULL DEFAULT 0 CHECK (balance >= 0),
  status      TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','FROZEN','CLOSED')),
  version     BIGINT NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_wallet_updated BEFORE UPDATE ON wallet_accounts FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE wallet_ledger (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  txn_no          TEXT NOT NULL UNIQUE,
  wallet_id       UUID NOT NULL REFERENCES wallet_accounts(id),
  type            TEXT NOT NULL CHECK (type IN ('TOPUP','PAYMENT','REFUND','ADJUSTMENT','TRANSFER_IN','TRANSFER_OUT','CASH_OUT','BONUS','EXPIRE','REVERSAL')),
  debit           BIGINT NOT NULL DEFAULT 0 CHECK (debit >= 0),
  credit          BIGINT NOT NULL DEFAULT 0 CHECK (credit >= 0),
  balance_before  BIGINT NOT NULL,
  balance_after   BIGINT NOT NULL CHECK (balance_after >= 0),
  reference_type  TEXT,
  reference_id    TEXT,
  order_id        UUID REFERENCES orders(id),
  payment_id      UUID REFERENCES payments(id),
  credential_id   UUID REFERENCES credentials(id),
  member_id       UUID REFERENCES members(id),
  store_id        UUID REFERENCES stores(id),
  device_id       UUID REFERENCES devices(id),
  staff_id        UUID REFERENCES staff(id),
  branch_id       UUID REFERENCES branches(id),
  note            TEXT,
  idempotency_key TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((debit = 0) <> (credit = 0)),
  CHECK (balance_after = balance_before + credit - debit)
);
CREATE INDEX ix_wallet_ledger_wallet ON wallet_ledger(wallet_id, created_at DESC);
CREATE UNIQUE INDEX ux_wallet_ledger_idem ON wallet_ledger(wallet_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

CREATE OR REPLACE FUNCTION wallet_ledger_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'wallet_ledger is append-only; post a REVERSAL entry instead';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER trg_wallet_ledger_immutable BEFORE UPDATE OR DELETE ON wallet_ledger FOR EACH ROW EXECUTE FUNCTION wallet_ledger_immutable();

-- Spec-compatible names
CREATE VIEW wallets AS SELECT * FROM wallet_accounts;
CREATE VIEW wallet_transactions AS SELECT * FROM wallet_ledger;
CREATE VIEW booking_payments AS
  SELECT b.id AS booking_id, b.booking_no, p.* FROM bookings b JOIN payments p ON p.order_id = b.order_id;

-- Unified financial journal for the Transaction Center / reports / shift cash
CREATE TABLE transactions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  txn_no          TEXT NOT NULL UNIQUE,
  branch_id       UUID NOT NULL REFERENCES branches(id),
  type            TEXT NOT NULL,     -- SALE, TOPUP, WALLET_PAYMENT, REFUND, VOID, WALLET_ADJUST, CASH_IN, CASH_OUT, WALLET_CASH_OUT
  category        TEXT NOT NULL,     -- TICKET, FOOD, RETAIL, WALLET, LOCKER, MEMBERSHIP, RIDE, OTHER
  method          TEXT,
  direction       TEXT NOT NULL CHECK (direction IN ('IN','OUT','NONE')),
  amount          BIGINT NOT NULL CHECK (amount >= 0),
  order_id        UUID REFERENCES orders(id),
  payment_id      UUID REFERENCES payments(id),
  refund_id       UUID REFERENCES refunds(id),
  wallet_ledger_id UUID REFERENCES wallet_ledger(id),
  account_id      UUID REFERENCES customer_accounts(id),
  member_id       UUID REFERENCES members(id),
  credential_id   UUID REFERENCES credentials(id),
  staff_id        UUID REFERENCES staff(id),
  store_id        UUID REFERENCES stores(id),
  device_id       UUID REFERENCES devices(id),
  shift_id        UUID REFERENCES shifts(id),
  reference       TEXT,
  metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_txn_branch_created ON transactions(branch_id, created_at DESC);
CREATE INDEX ix_txn_shift ON transactions(shift_id);
CREATE INDEX ix_txn_member ON transactions(member_id);
CREATE INDEX ix_txn_credential ON transactions(credential_id);
CREATE INDEX ix_txn_order ON transactions(order_id);
CREATE INDEX ix_txn_staff ON transactions(staff_id, created_at DESC);
