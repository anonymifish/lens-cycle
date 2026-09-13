CREATE TABLE stock_lots_v2 (
  id TEXT PRIMARY KEY,
  sequence INTEGER NOT NULL,
  product_id TEXT NOT NULL REFERENCES products(id),
  location_id TEXT NOT NULL REFERENCES locations(id),
  internal_lot_code TEXT NOT NULL COLLATE NOCASE CHECK (length(trim(internal_lot_code)) > 0),
  lot_number TEXT,
  received_date TEXT NOT NULL,
  manufactured_date TEXT,
  expiry_date TEXT,
  expected_usage_days INTEGER CHECK (expected_usage_days > 0 OR expected_usage_days IS NULL),
  initial_unit_quantity INTEGER NOT NULL CHECK (initial_unit_quantity >= 0),
  initial_package_quantity INTEGER CHECK (initial_package_quantity >= 0 OR initial_package_quantity IS NULL),
  initial_loose_unit_quantity INTEGER CHECK (initial_loose_unit_quantity >= 0 OR initial_loose_unit_quantity IS NULL),
  units_per_package_at_receipt INTEGER CHECK (units_per_package_at_receipt > 0 OR units_per_package_at_receipt IS NULL),
  unit_price_minor INTEGER NOT NULL CHECK (
    typeof(unit_price_minor) = 'integer' AND unit_price_minor >= 0
  ),
  currency TEXT NOT NULL CHECK (currency = 'CNY'),
  voided_at TEXT,
  voided_by_transaction_id TEXT UNIQUE REFERENCES inventory_transactions(id) DEFERRABLE INITIALLY DEFERRED,
  UNIQUE(product_id, internal_lot_code),
  CHECK ((voided_at IS NULL) = (voided_by_transaction_id IS NULL)),
  CHECK (expiry_date IS NULL OR manufactured_date IS NULL OR expiry_date >= manufactured_date),
  CHECK (
    (initial_package_quantity IS NULL AND initial_loose_unit_quantity IS NULL AND units_per_package_at_receipt IS NULL)
    OR
    (initial_package_quantity IS NOT NULL AND initial_loose_unit_quantity IS NOT NULL AND units_per_package_at_receipt IS NOT NULL
      AND initial_package_quantity * units_per_package_at_receipt + initial_loose_unit_quantity = initial_unit_quantity)
  )
);

INSERT INTO stock_lots_v2 (
  id, sequence, product_id, location_id, internal_lot_code, lot_number, received_date,
  manufactured_date, expiry_date, expected_usage_days, initial_unit_quantity,
  initial_package_quantity, initial_loose_unit_quantity, units_per_package_at_receipt,
  unit_price_minor, currency, voided_at, voided_by_transaction_id
)
SELECT
  id, sequence, product_id, location_id, internal_lot_code, lot_number, received_date,
  manufactured_date, expiry_date, expected_usage_days, initial_unit_quantity,
  initial_package_quantity, initial_loose_unit_quantity, units_per_package_at_receipt,
  CASE
    WHEN unit_price_minor >= 0
      AND unit_price_minor = CAST(unit_price_minor AS INTEGER)
      -- Keep migrated values within JavaScript's exactly representable integer range.
      AND unit_price_minor <= 90071992547409
    THEN CAST(unit_price_minor AS INTEGER) * 100
    ELSE NULL
  END,
  currency, voided_at, voided_by_transaction_id
FROM stock_lots;

DROP TABLE stock_lots;
ALTER TABLE stock_lots_v2 RENAME TO stock_lots;

CREATE INDEX stock_lots_by_product_expiry
  ON stock_lots(product_id, expiry_date);

UPDATE app_metadata
SET value = 'current-2'
WHERE key = 'schema_generation';
