-- Order fulfillment tracking (payment captured but entitlement creation failed → reconciliation job retries)
ALTER TABLE orders ADD COLUMN fulfilled_at TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN fulfillment_error TEXT;
ALTER TABLE orders ADD COLUMN fulfillment_attempts INTEGER NOT NULL DEFAULT 0;
CREATE INDEX ix_orders_unfulfilled ON orders(paid_at) WHERE status = 'PAID' AND fulfilled_at IS NULL;
