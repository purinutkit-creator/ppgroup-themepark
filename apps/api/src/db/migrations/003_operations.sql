-- =====================================================================
-- Gates, ride access, entitlements, queues, lockers, inventory,
-- promotions, rewards, printing
-- =====================================================================

-- ---------------------------------------------------------------------
-- Gates
-- ---------------------------------------------------------------------
CREATE TABLE gates (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id         UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  zone_id           UUID REFERENCES zones(id) ON DELETE SET NULL,
  code              TEXT NOT NULL,          -- G01
  name              TEXT NOT NULL,          -- Gate 01
  number            INTEGER NOT NULL,
  direction         TEXT NOT NULL DEFAULT 'ENTRY' CHECK (direction IN ('ENTRY','EXIT','BOTH')),
  mode              TEXT NOT NULL DEFAULT 'MANUAL' CHECK (mode IN ('AUTO','MANUAL')),
  state             TEXT NOT NULL DEFAULT 'IDLE' CHECK (state IN ('IDLE','SCANNING','VALIDATING','WAITING_APPROVAL','APPROVED',
                       'OPENING','OPEN','CLOSING','DENIED','ERROR','OFFLINE','EMERGENCY')),
  state_changed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  controller_type   TEXT NOT NULL DEFAULT 'SIMULATOR' CHECK (controller_type IN ('SIMULATOR','TURNSTILE','FLAP_BARRIER','SWING_GATE','RELAY','GPIO','NETWORK')),
  controller_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  open_duration_ms  INTEGER NOT NULL DEFAULT 5000,
  is_enabled        BOOLEAN NOT NULL DEFAULT true,
  block_new_entry   BOOLEAN NOT NULL DEFAULT false,
  emergency         BOOLEAN NOT NULL DEFAULT false,
  operator_staff_id UUID REFERENCES staff(id) ON DELETE SET NULL,
  current_scan_id   UUID,
  last_heartbeat_at TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (branch_id, code),
  UNIQUE (branch_id, number)
);
CREATE TRIGGER trg_gates_updated BEFORE UPDATE ON gates FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE gate_devices (
  gate_id    UUID NOT NULL REFERENCES gates(id) ON DELETE CASCADE,
  device_id  UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  role       TEXT NOT NULL CHECK (role IN ('SCANNER','CONTROLLER','DISPLAY','CAMERA')),
  PRIMARY KEY (gate_id, device_id)
);

CREATE TABLE gate_scans (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gate_id           UUID NOT NULL REFERENCES gates(id) ON DELETE CASCADE,
  branch_id         UUID NOT NULL REFERENCES branches(id),
  direction         TEXT NOT NULL CHECK (direction IN ('IN','OUT')),
  raw_hash          TEXT NOT NULL,           -- sha256 of scanned payload (payload itself is not stored)
  credential_id     UUID REFERENCES credentials(id),
  ticket_id         UUID REFERENCES tickets(id),
  member_id         UUID REFERENCES members(id),
  account_id        UUID REFERENCES customer_accounts(id),
  result            TEXT NOT NULL CHECK (result IN ('PENDING','APPROVED','AUTO_APPROVED','DENIED','EXPIRED','ERROR')),
  decision_mode     TEXT CHECK (decision_mode IN ('AUTO','MANUAL','OVERRIDE')),
  reason_code       TEXT,
  reason            TEXT,
  checks            JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_duplicate      BOOLEAN NOT NULL DEFAULT false,
  operator_staff_id UUID REFERENCES staff(id),
  approval_id       UUID REFERENCES manager_approvals(id),
  device_id         UUID REFERENCES devices(id),
  scanned_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at        TIMESTAMPTZ,
  passed_at         TIMESTAMPTZ
);
CREATE INDEX ix_gate_scans_gate ON gate_scans(gate_id, scanned_at DESC);
CREATE INDEX ix_gate_scans_branch ON gate_scans(branch_id, scanned_at DESC);
CREATE INDEX ix_gate_scans_ticket ON gate_scans(ticket_id, scanned_at DESC);
-- at most one pending decision per ticket across all gates (prevents simultaneous-scan races)
CREATE UNIQUE INDEX ux_gate_scans_ticket_pending ON gate_scans(ticket_id) WHERE result = 'PENDING' AND ticket_id IS NOT NULL;

CREATE TABLE entry_logs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gate_id           UUID NOT NULL REFERENCES gates(id),
  branch_id         UUID NOT NULL REFERENCES branches(id),
  scan_id           UUID REFERENCES gate_scans(id),
  direction         TEXT NOT NULL CHECK (direction IN ('IN','OUT')),
  credential_id     UUID REFERENCES credentials(id),
  ticket_id         UUID REFERENCES tickets(id),
  member_id         UUID REFERENCES members(id),
  account_id        UUID REFERENCES customer_accounts(id),
  zone_id           UUID REFERENCES zones(id),
  operator_staff_id UUID REFERENCES staff(id),
  device_id         UUID REFERENCES devices(id),
  override          BOOLEAN NOT NULL DEFAULT false,
  approval_time     TIMESTAMPTZ,
  entry_time        TIMESTAMPTZ NOT NULL DEFAULT now(),
  passage_confirmed BOOLEAN NOT NULL DEFAULT false
);
CREATE INDEX ix_entry_logs_branch_time ON entry_logs(branch_id, entry_time DESC);
CREATE INDEX ix_entry_logs_ticket ON entry_logs(ticket_id, entry_time DESC);

CREATE TABLE security_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id       UUID REFERENCES branches(id),
  type            TEXT NOT NULL CHECK (type IN ('DUPLICATE_ENTRY','REPLAY','FORGED_QR','BLACKLISTED','LOST_CARD_USED','SUSPICIOUS_LOGIN','MANUAL_OVERRIDE','EMERGENCY')),
  gate_id         UUID REFERENCES gates(id),
  ride_id         UUID REFERENCES rides(id),
  credential_id   UUID REFERENCES credentials(id),
  ticket_id       UUID REFERENCES tickets(id),
  details         JSONB NOT NULL DEFAULT '{}'::jsonb,
  acknowledged_by UUID REFERENCES staff(id),
  acknowledged_at TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_security_events_branch ON security_events(branch_id, created_at DESC);

-- ---------------------------------------------------------------------
-- Ride entitlements, access, queues
-- ---------------------------------------------------------------------
CREATE TABLE ride_entitlements (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      UUID NOT NULL REFERENCES customer_accounts(id),
  ticket_id       UUID REFERENCES tickets(id),
  ride_id         UUID REFERENCES rides(id),     -- NULL = all rides in branch
  branch_id       UUID NOT NULL REFERENCES branches(id),
  source          TEXT NOT NULL CHECK (source IN ('PACKAGE','ADDON','REWARD','MEMBERSHIP','COMP')),
  type            TEXT NOT NULL CHECK (type IN ('ONE_TIME','MULTI_USE','UNLIMITED','TIME_BASED','DATE_BASED')),
  uses_total      INTEGER CHECK (uses_total > 0),
  uses_remaining  INTEGER CHECK (uses_remaining >= 0),
  valid_from      TIMESTAMPTZ NOT NULL,
  valid_until     TIMESTAMPTZ NOT NULL,
  status          TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','EXHAUSTED','EXPIRED','REVOKED')),
  order_id        UUID REFERENCES orders(id),
  package_id      UUID REFERENCES packages(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (valid_until > valid_from),
  CHECK ((type IN ('ONE_TIME','MULTI_USE')) = (uses_remaining IS NOT NULL))
);
CREATE INDEX ix_entitlements_ticket ON ride_entitlements(ticket_id) WHERE status = 'ACTIVE';
CREATE INDEX ix_entitlements_account ON ride_entitlements(account_id) WHERE status = 'ACTIVE';

CREATE TABLE ride_access_logs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id           UUID NOT NULL REFERENCES rides(id),
  branch_id         UUID NOT NULL REFERENCES branches(id),
  scan_point_id     UUID REFERENCES ride_scan_points(id),
  credential_id     UUID REFERENCES credentials(id),
  ticket_id         UUID REFERENCES tickets(id),
  account_id        UUID REFERENCES customer_accounts(id),
  member_id         UUID REFERENCES members(id),
  entitlement_id    UUID REFERENCES ride_entitlements(id),
  result            TEXT NOT NULL CHECK (result IN ('GRANTED','DENIED','NOT_INCLUDED')),
  reason_code       TEXT,
  reason            TEXT,
  checks            JSONB NOT NULL DEFAULT '[]'::jsonb,
  manual            BOOLEAN NOT NULL DEFAULT false,
  operator_staff_id UUID REFERENCES staff(id),
  device_id         UUID REFERENCES devices(id),
  scanned_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  entered_at        TIMESTAMPTZ
);
CREATE INDEX ix_ride_access_ride ON ride_access_logs(ride_id, scanned_at DESC);
CREATE INDEX ix_ride_access_account ON ride_access_logs(account_id, scanned_at DESC);
CREATE INDEX ix_ride_access_branch ON ride_access_logs(branch_id, scanned_at DESC);

CREATE TABLE ride_entitlement_usage (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entitlement_id  UUID NOT NULL REFERENCES ride_entitlements(id),
  ride_id         UUID NOT NULL REFERENCES rides(id),
  credential_id   UUID REFERENCES credentials(id),
  access_log_id   UUID REFERENCES ride_access_logs(id),
  uses_before     INTEGER,
  uses_after      INTEGER,
  staff_id        UUID REFERENCES staff(id),
  used_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_ent_usage_ent ON ride_entitlement_usage(entitlement_id);

-- Purchase-at-scanner requests (cash / promptpay waiting confirmation)
CREATE TABLE ride_purchase_requests (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id        UUID NOT NULL REFERENCES rides(id),
  scan_point_id  UUID REFERENCES ride_scan_points(id),
  credential_id  UUID NOT NULL REFERENCES credentials(id),
  order_id       UUID NOT NULL REFERENCES orders(id),
  payment_id     UUID REFERENCES payments(id),
  method         TEXT NOT NULL,
  amount         BIGINT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','PAID','CANCELLED','EXPIRED','FAILED')),
  confirmed_by   UUID REFERENCES staff(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at   TIMESTAMPTZ
);
CREATE INDEX ix_rpr_ride_status ON ride_purchase_requests(ride_id, status);

CREATE TABLE ride_queues (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id         UUID NOT NULL REFERENCES rides(id) ON DELETE CASCADE,
  queue_date      DATE NOT NULL,
  seq             INTEGER NOT NULL,
  queue_no        TEXT NOT NULL,           -- A124
  account_id      UUID REFERENCES customer_accounts(id),
  credential_id   UUID REFERENCES credentials(id),
  member_id       UUID REFERENCES members(id),
  party_size      INTEGER NOT NULL DEFAULT 1 CHECK (party_size BETWEEN 1 AND 10),
  priority        BOOLEAN NOT NULL DEFAULT false,
  status          TEXT NOT NULL DEFAULT 'WAITING' CHECK (status IN ('WAITING','CALLED','BOARDED','EXPIRED','CANCELLED','NO_SHOW')),
  joined_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  called_at       TIMESTAMPTZ,
  call_expires_at TIMESTAMPTZ,
  boarded_at      TIMESTAMPTZ,
  UNIQUE (ride_id, queue_date, seq)
);
CREATE INDEX ix_ride_queues_active ON ride_queues(ride_id, status, seq) WHERE status IN ('WAITING','CALLED');
CREATE UNIQUE INDEX ux_ride_queue_one_active ON ride_queues(ride_id, account_id) WHERE status IN ('WAITING','CALLED') AND account_id IS NOT NULL;

-- ---------------------------------------------------------------------
-- Lockers
-- ---------------------------------------------------------------------
CREATE TABLE lockers (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id         UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  zone_id           UUID REFERENCES zones(id) ON DELETE SET NULL,
  code              TEXT NOT NULL,     -- L-102
  bank              TEXT,
  size              TEXT NOT NULL DEFAULT 'M' CHECK (size IN ('S','M','L','XL')),
  status            TEXT NOT NULL DEFAULT 'AVAILABLE' CHECK (status IN ('AVAILABLE','OCCUPIED','OUT_OF_SERVICE','RESERVED')),
  controller_type   TEXT NOT NULL DEFAULT 'SIMULATOR',
  controller_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  device_id         UUID REFERENCES devices(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (branch_id, code)
);

CREATE TABLE locker_rates (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id        UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  size             TEXT NOT NULL CHECK (size IN ('S','M','L','XL')),
  name             TEXT NOT NULL,
  duration_minutes INTEGER,             -- NULL = all day (until closing)
  price            BIGINT NOT NULL CHECK (price >= 0),
  is_active        BOOLEAN NOT NULL DEFAULT true,
  sort             INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE locker_sessions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  locker_id      UUID NOT NULL REFERENCES lockers(id),
  account_id     UUID NOT NULL REFERENCES customer_accounts(id),
  credential_id  UUID NOT NULL REFERENCES credentials(id),
  member_id      UUID REFERENCES members(id),
  rate_id        UUID REFERENCES locker_rates(id),
  order_id       UUID REFERENCES orders(id),
  amount         BIGINT NOT NULL DEFAULT 0,
  status         TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','ENDED','EXPIRED')),
  start_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  expire_at      TIMESTAMPTZ NOT NULL,
  ended_at       TIMESTAMPTZ,
  open_count     INTEGER NOT NULL DEFAULT 0,
  staff_id       UUID REFERENCES staff(id)
);
CREATE UNIQUE INDEX ux_locker_one_active ON locker_sessions(locker_id) WHERE status = 'ACTIVE';
CREATE INDEX ix_locker_sessions_account ON locker_sessions(account_id, status);

-- ---------------------------------------------------------------------
-- Inventory
-- ---------------------------------------------------------------------
CREATE TABLE inventory (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id  UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  store_id    UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  qty         INTEGER NOT NULL DEFAULT 0,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (product_id, store_id)
);

CREATE TABLE stock_movements (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id      UUID NOT NULL REFERENCES products(id),
  store_id        UUID NOT NULL REFERENCES stores(id),
  type            TEXT NOT NULL CHECK (type IN ('IN','OUT','TRANSFER_IN','TRANSFER_OUT','ADJUSTMENT','WASTE','SALE','RETURN')),
  qty             INTEGER NOT NULL,          -- signed delta
  qty_before      INTEGER NOT NULL,
  qty_after       INTEGER NOT NULL,
  order_id        UUID REFERENCES orders(id),
  transfer_ref    TEXT,
  reason          TEXT,
  staff_id        UUID REFERENCES staff(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (qty_after = qty_before + qty)
);
CREATE INDEX ix_stock_movements_product ON stock_movements(product_id, created_at DESC);
CREATE INDEX ix_stock_movements_store ON stock_movements(store_id, created_at DESC);

-- ---------------------------------------------------------------------
-- Promotions / coupons / rewards
-- ---------------------------------------------------------------------
CREATE TABLE promotions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id        UUID REFERENCES branches(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  description      TEXT,
  type             TEXT NOT NULL CHECK (type IN ('PERCENT','AMOUNT','BUY_X_PAY_Y','FIXED_PRICE')),
  value            NUMERIC(12,2) NOT NULL DEFAULT 0,
  buy_qty          INTEGER,
  pay_qty          INTEGER,
  max_discount     BIGINT,
  applies_to       TEXT NOT NULL DEFAULT 'ORDER' CHECK (applies_to IN ('ORDER','TICKET','FOOD','RETAIL','PACKAGE','PRODUCT')),
  conditions       JSONB NOT NULL DEFAULT '{}'::jsonb,
  stackable        BOOLEAN NOT NULL DEFAULT false,
  priority         INTEGER NOT NULL DEFAULT 100,
  start_at         TIMESTAMPTZ,
  end_at           TIMESTAMPTZ,
  usage_limit      INTEGER,
  usage_per_member INTEGER,
  used_count       INTEGER NOT NULL DEFAULT 0,
  requires_coupon  BOOLEAN NOT NULL DEFAULT false,
  is_active        BOOLEAN NOT NULL DEFAULT true,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_promotions_updated BEFORE UPDATE ON promotions FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE coupons (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  promotion_id  UUID NOT NULL REFERENCES promotions(id) ON DELETE CASCADE,
  code          TEXT NOT NULL,
  usage_limit   INTEGER NOT NULL DEFAULT 1,
  used_count    INTEGER NOT NULL DEFAULT 0,
  member_id     UUID REFERENCES members(id),
  expires_at    TIMESTAMPTZ,
  status        TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','USED','EXPIRED','DISABLED')),
  source        TEXT NOT NULL DEFAULT 'MANUAL' CHECK (source IN ('MANUAL','REWARD','BIRTHDAY','CAMPAIGN')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (used_count <= usage_limit)
);
CREATE UNIQUE INDEX ux_coupons_code ON coupons(upper(code));

CREATE TABLE promotion_usages (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  promotion_id UUID NOT NULL REFERENCES promotions(id),
  coupon_id    UUID REFERENCES coupons(id),
  order_id     UUID NOT NULL REFERENCES orders(id),
  member_id    UUID REFERENCES members(id),
  discount     BIGINT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_promo_usage_member ON promotion_usages(promotion_id, member_id);

CREATE TABLE rewards (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id        UUID REFERENCES branches(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  description      TEXT,
  image_url        TEXT,
  type             TEXT NOT NULL CHECK (type IN ('DISCOUNT','FREE_TICKET','FOOD','DRINK','SOUVENIR','RIDE_PASS','LOCKER','UPGRADE','COUPON','WALLET_CREDIT')),
  points_required  INTEGER NOT NULL CHECK (points_required > 0),
  stock            INTEGER CHECK (stock >= 0),
  min_tier_rank    INTEGER NOT NULL DEFAULT 0,
  start_at         TIMESTAMPTZ,
  end_at           TIMESTAMPTZ,
  config           JSONB NOT NULL DEFAULT '{}'::jsonb,  -- {promotion_id|package_id|product_id|ride_id|amount}
  voucher_valid_days INTEGER NOT NULL DEFAULT 30,
  is_active        BOOLEAN NOT NULL DEFAULT true,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE reward_redemptions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reward_id     UUID NOT NULL REFERENCES rewards(id),
  member_id     UUID NOT NULL REFERENCES members(id),
  points        INTEGER NOT NULL,
  voucher_code  TEXT NOT NULL UNIQUE,
  status        TEXT NOT NULL DEFAULT 'ISSUED' CHECK (status IN ('ISSUED','USED','EXPIRED','CANCELLED')),
  expires_at    TIMESTAMPTZ NOT NULL,
  used_at       TIMESTAMPTZ,
  used_order_id UUID REFERENCES orders(id),
  coupon_id     UUID REFERENCES coupons(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_redemptions_member ON reward_redemptions(member_id, created_at DESC);

-- ---------------------------------------------------------------------
-- Print templates
-- ---------------------------------------------------------------------
CREATE TABLE print_templates (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id   UUID REFERENCES branches(id) ON DELETE CASCADE,
  type        TEXT NOT NULL CHECK (type IN ('RECEIPT','TICKET','WRISTBAND','MEMBER_CARD','KITCHEN')),
  paper       TEXT NOT NULL CHECK (paper IN ('58MM','80MM','A4','WRISTBAND','CR80')),
  name        TEXT NOT NULL,
  layout      JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_default  BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
