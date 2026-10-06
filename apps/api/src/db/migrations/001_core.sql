-- =====================================================================
-- ONE QR — ONE EXPERIENCE : core schema
-- All monetary amounts are BIGINT in minor units (satang, 1 THB = 100).
-- All primary keys are UUID; human readable codes are separate UNIQUE columns.
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Atomic per-period counters used to build human readable codes
-- (TK-20261006-001928, ORD-..., queue numbers, etc.)
CREATE TABLE code_counters (
  prefix      TEXT NOT NULL,
  period      TEXT NOT NULL DEFAULT '',
  value       BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (prefix, period)
);

-- ---------------------------------------------------------------------
-- Branches / zones / settings
-- ---------------------------------------------------------------------
CREATE TABLE branches (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  name_en     TEXT,
  timezone    TEXT NOT NULL DEFAULT 'Asia/Bangkok',
  address     TEXT,
  phone       TEXT,
  capacity    INTEGER NOT NULL DEFAULT 2000 CHECK (capacity > 0),
  open_time   TIME NOT NULL DEFAULT '10:00',
  close_time  TIME NOT NULL DEFAULT '20:00',
  status      TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_branches_updated BEFORE UPDATE ON branches FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE zones (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id   UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  code        TEXT NOT NULL,
  name        TEXT NOT NULL,
  capacity    INTEGER NOT NULL DEFAULT 300 CHECK (capacity > 0),
  color       TEXT DEFAULT '#6366f1',
  map_x       NUMERIC(6,2) DEFAULT 0,
  map_y       NUMERIC(6,2) DEFAULT 0,
  map_w       NUMERIC(6,2) DEFAULT 20,
  map_h       NUMERIC(6,2) DEFAULT 20,
  status      TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','CLOSED')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (branch_id, code)
);
CREATE TRIGGER trg_zones_updated BEFORE UPDATE ON zones FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Dynamic configuration. branch_id NULL = global default; branch row overrides.
CREATE TABLE settings (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id   UUID REFERENCES branches(id) ON DELETE CASCADE,
  key         TEXT NOT NULL,
  value       JSONB NOT NULL,
  updated_by  UUID,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ux_settings_scope_key ON settings (COALESCE(branch_id, '00000000-0000-0000-0000-000000000000'::uuid), key);

CREATE TABLE font_assets (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family      TEXT NOT NULL UNIQUE,
  file_path   TEXT NOT NULL,
  mime        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- RBAC / staff / sessions
-- ---------------------------------------------------------------------
CREATE TABLE permissions (
  key         TEXT PRIMARY KEY,           -- e.g. gate.open, wallet.adjust
  module      TEXT NOT NULL,
  action      TEXT NOT NULL,
  description TEXT
);

CREATE TABLE roles (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  description TEXT,
  is_system   BOOLEAN NOT NULL DEFAULT false,
  approval_level INTEGER NOT NULL DEFAULT 0,  -- >= 50 may act as approving manager
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_roles_updated BEFORE UPDATE ON roles FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE role_permissions (
  role_id        UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_key TEXT NOT NULL REFERENCES permissions(key) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_key)
);

CREATE TABLE staff (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_code   TEXT NOT NULL UNIQUE,
  first_name      TEXT NOT NULL,
  last_name       TEXT NOT NULL DEFAULT '',
  nickname        TEXT,
  role_id         UUID NOT NULL REFERENCES roles(id),
  branch_id       UUID REFERENCES branches(id),   -- NULL = all branches (owner / HQ)
  phone           TEXT,
  email           TEXT,
  pin_hash        TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE','LOCKED')),
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until    TIMESTAMPTZ,
  last_login_at   TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_staff_branch ON staff(branch_id);
CREATE UNIQUE INDEX ux_staff_email ON staff(lower(email)) WHERE email IS NOT NULL;
CREATE TRIGGER trg_staff_updated BEFORE UPDATE ON staff FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE devices (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id       UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  code            TEXT NOT NULL UNIQUE,
  name            TEXT NOT NULL,
  type            TEXT NOT NULL CHECK (type IN ('GATE_SCANNER','GATE_CONTROLLER','GATE_DISPLAY','POS','KIOSK','RIDE_SCANNER',
                     'KITCHEN_DISPLAY','QUEUE_DISPLAY','LOCKER_CONTROLLER','PRINTER','PAYMENT_TERMINAL','CUSTOMER_DISPLAY','WRISTBAND_PRINTER')),
  location        TEXT,
  zone_id         UUID REFERENCES zones(id) ON DELETE SET NULL,
  ip              TEXT,
  mac             TEXT,
  api_key_hash    TEXT,
  api_key_prefix  TEXT,
  status          TEXT NOT NULL DEFAULT 'OFFLINE' CHECK (status IN ('ONLINE','OFFLINE','ERROR','DISABLED')),
  last_seen_at    TIMESTAMPTZ,
  firmware        TEXT,
  config          JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_devices_branch_type ON devices(branch_id, type);
CREATE UNIQUE INDEX ux_devices_key_prefix ON devices(api_key_prefix) WHERE api_key_prefix IS NOT NULL;
CREATE TRIGGER trg_devices_updated BEFORE UPDATE ON devices FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE sessions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  principal_type  TEXT NOT NULL CHECK (principal_type IN ('STAFF','MEMBER')),
  principal_id    UUID NOT NULL,
  device_id       UUID REFERENCES devices(id) ON DELETE SET NULL,
  ip              TEXT,
  user_agent      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at      TIMESTAMPTZ NOT NULL,
  revoked_at      TIMESTAMPTZ
);
CREATE INDEX ix_sessions_principal ON sessions(principal_type, principal_id) WHERE revoked_at IS NULL;

CREATE TABLE auth_events (
  id              BIGSERIAL PRIMARY KEY,
  principal_type  TEXT NOT NULL,
  identifier      TEXT NOT NULL,
  principal_id    UUID,
  success         BOOLEAN NOT NULL,
  reason          TEXT,
  ip              TEXT,
  user_agent      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_auth_events_ident ON auth_events(principal_type, identifier, created_at DESC);

CREATE TABLE otp_codes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  purpose         TEXT NOT NULL CHECK (purpose IN ('PASSWORD_RESET','VERIFY_PHONE','VERIFY_EMAIL','LOGIN')),
  identifier      TEXT NOT NULL,
  code_hash       TEXT NOT NULL,
  attempts        INTEGER NOT NULL DEFAULT 0,
  expires_at      TIMESTAMPTZ NOT NULL,
  consumed_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_otp_ident ON otp_codes(identifier, purpose, created_at DESC);

CREATE TABLE manager_approvals (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action          TEXT NOT NULL,
  reason          TEXT NOT NULL,
  requested_by    UUID NOT NULL REFERENCES staff(id),
  approved_by     UUID NOT NULL REFERENCES staff(id),
  reference_type  TEXT,
  reference_id    TEXT,
  device_id       UUID REFERENCES devices(id) ON DELETE SET NULL,
  branch_id       UUID REFERENCES branches(id),
  expires_at      TIMESTAMPTZ NOT NULL,
  consumed_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- Members / accounts / memberships / points
-- ---------------------------------------------------------------------
CREATE TABLE member_tiers (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code             TEXT NOT NULL UNIQUE,
  name             TEXT NOT NULL,
  rank             INTEGER NOT NULL DEFAULT 0,
  color            TEXT NOT NULL DEFAULT '#64748b',
  point_multiplier NUMERIC(5,2) NOT NULL DEFAULT 1.00 CHECK (point_multiplier >= 0),
  ticket_discount_pct NUMERIC(5,2) NOT NULL DEFAULT 0,
  food_discount_pct   NUMERIC(5,2) NOT NULL DEFAULT 0,
  retail_discount_pct NUMERIC(5,2) NOT NULL DEFAULT 0,
  is_active        BOOLEAN NOT NULL DEFAULT true,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_member_tiers_updated BEFORE UPDATE ON member_tiers FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE members (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_code       TEXT NOT NULL UNIQUE,
  first_name        TEXT NOT NULL,
  last_name         TEXT NOT NULL DEFAULT '',
  phone             TEXT NOT NULL,
  email             TEXT,
  password_hash     TEXT,
  birthday          DATE,
  gender            TEXT CHECK (gender IN ('MALE','FEMALE','OTHER','UNSPECIFIED')),
  address           TEXT,
  emergency_contact TEXT,
  tier_id           UUID REFERENCES member_tiers(id),
  points            INTEGER NOT NULL DEFAULT 0 CHECK (points >= 0),
  total_spend       BIGINT NOT NULL DEFAULT 0,
  visit_count       INTEGER NOT NULL DEFAULT 0,
  join_date         DATE NOT NULL DEFAULT CURRENT_DATE,
  home_branch_id    UUID REFERENCES branches(id),
  status            TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','SUSPENDED','CLOSED')),
  registered_via    TEXT NOT NULL DEFAULT 'ONLINE' CHECK (registered_via IN ('ONLINE','COUNTER','KIOSK')),
  phone_verified_at TIMESTAMPTZ,
  email_verified_at TIMESTAMPTZ,
  failed_logins     INTEGER NOT NULL DEFAULT 0,
  locked_until      TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ux_members_phone ON members(phone);
CREATE UNIQUE INDEX ux_members_email ON members(lower(email)) WHERE email IS NOT NULL;
CREATE INDEX ix_members_name ON members(lower(first_name), lower(last_name));
CREATE TRIGGER trg_members_updated BEFORE UPDATE ON members FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- A customer account owns wallet, tickets and entitlements. Every member has
-- exactly one; guests get an anonymous one per temporary wristband / visit.
CREATE TABLE customer_accounts (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind           TEXT NOT NULL CHECK (kind IN ('MEMBER','GUEST')),
  member_id      UUID UNIQUE REFERENCES members(id),
  display_name   TEXT,
  phone          TEXT,
  email          TEXT,
  branch_id      UUID REFERENCES branches(id),
  merged_into_id UUID REFERENCES customer_accounts(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((kind = 'MEMBER') = (member_id IS NOT NULL))
);
CREATE INDEX ix_accounts_phone ON customer_accounts(phone);

CREATE TABLE membership_products (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id             UUID REFERENCES branches(id),
  tier_id               UUID NOT NULL REFERENCES member_tiers(id),
  code                  TEXT NOT NULL UNIQUE,
  name                  TEXT NOT NULL,
  description           TEXT,
  image_url             TEXT,
  card_design           JSONB NOT NULL DEFAULT '{}'::jsonb,
  registration_fee      BIGINT NOT NULL DEFAULT 0 CHECK (registration_fee >= 0),
  annual_fee            BIGINT NOT NULL DEFAULT 0 CHECK (annual_fee >= 0),
  renewal_price         BIGINT CHECK (renewal_price >= 0),
  upgrade_price         BIGINT CHECK (upgrade_price >= 0),
  upgrade_mode          TEXT NOT NULL DEFAULT 'DIFFERENCE' CHECK (upgrade_mode IN ('FULL','DIFFERENCE','PRORATED')),
  validity_unit         TEXT NOT NULL DEFAULT 'YEAR' CHECK (validity_unit IN ('DAY','MONTH','YEAR','LIFETIME')),
  validity_value        INTEGER NOT NULL DEFAULT 1 CHECK (validity_value > 0),
  early_renewal_days    INTEGER NOT NULL DEFAULT 30,
  early_renewal_discount_pct NUMERIC(5,2) NOT NULL DEFAULT 0,
  grace_period_days     INTEGER NOT NULL DEFAULT 15,
  point_multiplier      NUMERIC(5,2),
  visit_limit           INTEGER,
  guest_benefits        JSONB NOT NULL DEFAULT '{}'::jsonb,
  free_items            JSONB NOT NULL DEFAULT '[]'::jsonb,
  ride_rights           JSONB NOT NULL DEFAULT '[]'::jsonb,
  physical_card_fee     BIGINT NOT NULL DEFAULT 0,
  is_active             BOOLEAN NOT NULL DEFAULT true,
  sort                  INTEGER NOT NULL DEFAULT 0,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_mprod_updated BEFORE UPDATE ON membership_products FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE membership_benefits (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id  UUID NOT NULL REFERENCES membership_products(id) ON DELETE CASCADE,
  type        TEXT NOT NULL CHECK (type IN ('TICKET_DISCOUNT','FOOD_DISCOUNT','RETAIL_DISCOUNT','FREE_RIDE','FREE_LOCKER',
                'BIRTHDAY_REWARD','PRIORITY_QUEUE','FAST_PASS','FREE_ADMISSION','GUEST_DISCOUNT','POINT_MULTIPLIER',
                'PARKING','SPECIAL_EVENT','MEMBER_LOUNGE','CUSTOM')),
  value       NUMERIC(12,2) NOT NULL DEFAULT 0,
  label       TEXT,
  config      JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX ix_mbenefits_product ON membership_benefits(product_id);

CREATE TABLE memberships (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id       UUID NOT NULL REFERENCES members(id),
  product_id      UUID NOT NULL REFERENCES membership_products(id),
  status          TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','ACTIVE','EXPIRED','CANCELLED','SUPERSEDED')),
  start_date      DATE NOT NULL,
  end_date        DATE,                         -- NULL = lifetime
  order_id        UUID,
  previous_id     UUID REFERENCES memberships(id),
  change_type     TEXT NOT NULL DEFAULT 'NEW' CHECK (change_type IN ('NEW','RENEWAL','UPGRADE')),
  expiry_notified_at TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_memberships_member ON memberships(member_id, status);
CREATE UNIQUE INDEX ux_memberships_one_active ON memberships(member_id) WHERE status = 'ACTIVE';

CREATE TABLE points_ledger (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id       UUID NOT NULL REFERENCES members(id),
  type            TEXT NOT NULL CHECK (type IN ('EARN','REDEEM','ADJUST','EXPIRE','REVERSAL')),
  points          INTEGER NOT NULL,           -- signed
  balance_before  INTEGER NOT NULL,
  balance_after   INTEGER NOT NULL CHECK (balance_after >= 0),
  reference_type  TEXT,
  reference_id    TEXT,
  staff_id        UUID REFERENCES staff(id),
  note            TEXT,
  idempotency_key TEXT UNIQUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (balance_after = balance_before + points)
);
CREATE INDEX ix_points_member ON points_ledger(member_id, created_at DESC);

-- ---------------------------------------------------------------------
-- Audit (append only)
-- ---------------------------------------------------------------------
CREATE TABLE audit_logs (
  id          BIGSERIAL PRIMARY KEY,
  at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  branch_id   UUID,
  staff_id    UUID,
  member_id   UUID,
  role        TEXT,
  device_id   UUID,
  ip          TEXT,
  user_agent  TEXT,
  action      TEXT NOT NULL,
  entity_type TEXT,
  entity_id   TEXT,
  before      JSONB,
  after       JSONB,
  reason      TEXT,
  metadata    JSONB
);
CREATE INDEX ix_audit_at ON audit_logs(at DESC);
CREATE INDEX ix_audit_action ON audit_logs(action, at DESC);
CREATE INDEX ix_audit_entity ON audit_logs(entity_type, entity_id);
CREATE INDEX ix_audit_staff ON audit_logs(staff_id, at DESC);

CREATE OR REPLACE FUNCTION audit_logs_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER trg_audit_no_update BEFORE UPDATE OR DELETE ON audit_logs FOR EACH ROW EXECUTE FUNCTION audit_logs_immutable();

CREATE TABLE idempotency_keys (
  scope           TEXT NOT NULL,
  key             TEXT NOT NULL,
  request_hash    TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'PROCESSING' CHECK (status IN ('PROCESSING','COMPLETED')),
  response_status INTEGER,
  response_body   JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at    TIMESTAMPTZ,
  PRIMARY KEY (scope, key)
);
CREATE INDEX ix_idem_created ON idempotency_keys(created_at);

CREATE TABLE notifications (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id     UUID REFERENCES branches(id) ON DELETE CASCADE,
  audience      TEXT NOT NULL DEFAULT 'STAFF' CHECK (audience IN ('STAFF','MEMBER','ACCOUNT')),
  type          TEXT NOT NULL,
  severity      TEXT NOT NULL DEFAULT 'INFO' CHECK (severity IN ('INFO','WARNING','CRITICAL')),
  title         TEXT NOT NULL,
  message       TEXT NOT NULL,
  data          JSONB NOT NULL DEFAULT '{}'::jsonb,
  target_permission TEXT,
  member_id     UUID REFERENCES members(id) ON DELETE CASCADE,
  account_id    UUID REFERENCES customer_accounts(id) ON DELETE CASCADE,
  dedupe_key    TEXT,
  acknowledged_by UUID REFERENCES staff(id),
  acknowledged_at TIMESTAMPTZ,
  read_at       TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_notifications_branch ON notifications(branch_id, created_at DESC);
CREATE INDEX ix_notifications_member ON notifications(member_id, created_at DESC);
CREATE INDEX ix_notifications_account ON notifications(account_id, created_at DESC);
CREATE INDEX ix_notifications_dedupe ON notifications(dedupe_key, created_at DESC) WHERE dedupe_key IS NOT NULL;
