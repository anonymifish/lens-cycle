PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS app_metadata (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS item_profiles (
  id TEXT PRIMARY KEY,
  sequence INTEGER NOT NULL,
  group_id TEXT NOT NULL CHECK (group_id IN ('lenses', 'periodic', 'consumables')),
  management_template TEXT NOT NULL,
  standard_type TEXT NOT NULL,
  standard_type_name TEXT,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  base_unit TEXT NOT NULL CHECK (length(trim(base_unit)) > 0),
  side TEXT CHECK (side IN ('L', 'R') OR side IS NULL),
  default_duration_days INTEGER CHECK (default_duration_days > 0 OR default_duration_days IS NULL),
  is_active INTEGER NOT NULL CHECK (is_active IN (0, 1)),
  sort_order INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  sequence INTEGER NOT NULL,
  item_profile_id TEXT NOT NULL REFERENCES item_profiles(id),
  standard_type TEXT NOT NULL,
  brand TEXT NOT NULL CHECK (length(trim(brand)) > 0),
  model TEXT,
  specification TEXT,
  base_unit TEXT NOT NULL CHECK (length(trim(base_unit)) > 0),
  units_per_package INTEGER NOT NULL CHECK (units_per_package > 0),
  capacity_ml REAL CHECK (capacity_ml > 0 OR capacity_ml IS NULL),
  default_duration_days INTEGER CHECK (default_duration_days > 0 OR default_duration_days IS NULL),
  sort_order INTEGER CHECK (sort_order >= 0 OR sort_order IS NULL),
  is_active INTEGER NOT NULL CHECK (is_active IN (0, 1))
);

CREATE TABLE IF NOT EXISTS locations (
  id TEXT PRIMARY KEY,
  sequence INTEGER NOT NULL,
  name TEXT NOT NULL COLLATE NOCASE UNIQUE CHECK (length(trim(name)) > 0),
  note TEXT,
  is_active INTEGER NOT NULL CHECK (is_active IN (0, 1)),
  sort_order INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS stock_lots (
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
  unit_price_minor REAL NOT NULL CHECK (unit_price_minor >= 0),
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

CREATE TABLE IF NOT EXISTS usage_instances (
  id TEXT PRIMARY KEY,
  sequence INTEGER NOT NULL,
  profile_id TEXT NOT NULL REFERENCES item_profiles(id),
  product_id TEXT NOT NULL REFERENCES products(id),
  source_stock_lot_id TEXT NOT NULL REFERENCES stock_lots(id),
  location_id TEXT NOT NULL REFERENCES locations(id),
  group_id TEXT NOT NULL CHECK (group_id IN ('lenses', 'periodic', 'consumables')),
  category_name TEXT NOT NULL CHECK (length(trim(category_name)) > 0),
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  detail TEXT NOT NULL DEFAULT '',
  location_name TEXT NOT NULL CHECK (length(trim(location_name)) > 0),
  start_date TEXT NOT NULL,
  end_date_exclusive TEXT,
  prediction_date TEXT,
  opened_expiry_date TEXT,
  depletion_prediction_date TEXT,
  initial_unit_quantity INTEGER CHECK (initial_unit_quantity > 0 OR initial_unit_quantity IS NULL),
  capacity_ml REAL CHECK (capacity_ml > 0 OR capacity_ml IS NULL),
  inventory_source_kind TEXT CHECK (inventory_source_kind IN ('package', 'loose') OR inventory_source_kind IS NULL),
  usage_rate_per_day REAL CHECK (usage_rate_per_day > 0 OR usage_rate_per_day IS NULL),
  eye_sides_json TEXT CHECK (eye_sides_json IS NULL OR json_valid(eye_sides_json)),
  end_reason TEXT,
  completion_usage_fact_id TEXT REFERENCES usage_facts(id) DEFERRABLE INITIALLY DEFERRED,
  status TEXT NOT NULL CHECK (status IN ('active', 'paused', 'planned', 'completed')),
  CHECK (end_date_exclusive IS NULL OR end_date_exclusive > start_date),
  CHECK ((status = 'completed') = (end_date_exclusive IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS inventory_transactions (
  id TEXT PRIMARY KEY,
  sequence INTEGER NOT NULL,
  stock_lot_id TEXT NOT NULL REFERENCES stock_lots(id),
  occurred_date TEXT NOT NULL,
  transaction_type TEXT NOT NULL CHECK (
    transaction_type IN (
      'stock_in', 'activate', 'package_open', 'loose_allocate', 'consume',
      'loss', 'discard', 'transfer', 'correction', 'reverse'
    )
  ),
  quantity_delta INTEGER NOT NULL,
  related_instance_id TEXT,
  related_cycle_id TEXT,
  reversed_transaction_id TEXT REFERENCES inventory_transactions(id) DEFERRABLE INITIALLY DEFERRED,
  allocated_unit_quantity INTEGER CHECK (allocated_unit_quantity > 0 OR allocated_unit_quantity IS NULL),
  location_id TEXT REFERENCES locations(id),
  from_location_id TEXT REFERENCES locations(id),
  to_location_id TEXT REFERENCES locations(id),
  transfer_quantity INTEGER,
  reversible_with_instance INTEGER CHECK (reversible_with_instance IN (0, 1) OR reversible_with_instance IS NULL),
  reason TEXT,
  CHECK (transaction_type != 'transfer' OR (
    quantity_delta = 0 AND from_location_id IS NOT NULL AND to_location_id IS NOT NULL
    AND from_location_id != to_location_id AND transfer_quantity > 0
  )),
  CHECK (transaction_type != 'stock_in' OR quantity_delta > 0),
  CHECK (transaction_type != 'activate' OR quantity_delta = -1),
  CHECK (transaction_type NOT IN ('consume', 'loss', 'discard') OR quantity_delta < 0),
  CHECK (transaction_type NOT IN ('package_open', 'loose_allocate') OR quantity_delta = 0),
  CHECK ((transaction_type = 'reverse') = (reversed_transaction_id IS NOT NULL))
);

CREATE TRIGGER IF NOT EXISTS inventory_transactions_are_append_only_on_update
BEFORE UPDATE ON inventory_transactions
WHEN COALESCE((SELECT value FROM app_metadata WHERE key = 'allow_inventory_rewrite'), '0') != '1'
BEGIN
  SELECT RAISE(ABORT, '库存流水不可修改；请追加反向流水');
END;

CREATE TRIGGER IF NOT EXISTS inventory_transactions_are_append_only_on_delete
BEFORE DELETE ON inventory_transactions
WHEN COALESCE((SELECT value FROM app_metadata WHERE key = 'allow_inventory_rewrite'), '0') != '1'
BEGIN
  SELECT RAISE(ABORT, '库存流水不可删除；请追加反向流水');
END;

CREATE TABLE IF NOT EXISTS usage_facts (
  id TEXT PRIMARY KEY,
  sequence INTEGER NOT NULL,
  item_id TEXT NOT NULL REFERENCES usage_instances(id) ON DELETE CASCADE,
  stock_lot_id TEXT NOT NULL REFERENCES stock_lots(id),
  transaction_id TEXT NOT NULL UNIQUE REFERENCES inventory_transactions(id),
  occurred_date TEXT NOT NULL,
  fact_kind TEXT NOT NULL CHECK (fact_kind IN ('wear', 'extra_loss', 'dose')),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  reason TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS one_daily_wear_per_instance_day
  ON usage_facts(item_id, occurred_date)
  WHERE fact_kind = 'wear';

CREATE TABLE IF NOT EXISTS care_events (
  id TEXT PRIMARY KEY,
  sequence INTEGER NOT NULL,
  item_id TEXT NOT NULL REFERENCES usage_instances(id) ON DELETE CASCADE,
  event_kind TEXT NOT NULL CHECK (event_kind IN ('review', 'protein')),
  planned_date TEXT,
  completed_date TEXT,
  CHECK (planned_date IS NOT NULL OR completed_date IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS instance_state_intervals (
  instance_id TEXT NOT NULL REFERENCES usage_instances(id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL,
  start_date TEXT NOT NULL,
  end_date_exclusive TEXT,
  state TEXT NOT NULL CHECK (state IN ('active', 'paused')),
  PRIMARY KEY(instance_id, sequence),
  CHECK (end_date_exclusive IS NULL OR end_date_exclusive > start_date)
);

CREATE TABLE IF NOT EXISTS instance_location_intervals (
  instance_id TEXT NOT NULL REFERENCES usage_instances(id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL,
  location_id TEXT NOT NULL REFERENCES locations(id),
  start_date TEXT NOT NULL,
  end_date_exclusive TEXT,
  PRIMARY KEY(instance_id, sequence),
  CHECK (end_date_exclusive IS NULL OR end_date_exclusive > start_date)
);

CREATE TABLE IF NOT EXISTS reusable_lens_cycles (
  id TEXT PRIMARY KEY,
  instance_id TEXT NOT NULL REFERENCES usage_instances(id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL,
  start_date TEXT NOT NULL,
  end_date_exclusive TEXT,
  prediction_date TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'completed')),
  label TEXT NOT NULL CHECK (length(trim(label)) > 0),
  end_reason TEXT,
  CHECK (end_date_exclusive IS NULL OR end_date_exclusive > start_date),
  CHECK ((status = 'completed') = (end_date_exclusive IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS instance_eye_assignment_intervals (
  instance_id TEXT NOT NULL REFERENCES usage_instances(id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL,
  start_date TEXT NOT NULL,
  end_date_exclusive TEXT,
  eye_sides_json TEXT NOT NULL CHECK (json_valid(eye_sides_json)),
  PRIMARY KEY(instance_id, sequence),
  CHECK (end_date_exclusive IS NULL OR end_date_exclusive > start_date)
);

CREATE TABLE IF NOT EXISTS app_preferences (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  timeline_active_color TEXT NOT NULL,
  timeline_paused_color TEXT NOT NULL,
  timeline_completed_color TEXT NOT NULL,
  timeline_review_color TEXT NOT NULL,
  timeline_protein_color TEXT NOT NULL,
  timeline_forecast_color TEXT NOT NULL,
  timeline_historical_paused_color TEXT NOT NULL,
  timeline_danger_color TEXT NOT NULL,
  consumption_history_range TEXT NOT NULL CHECK (
    consumption_history_range IN ('all', 'recent_year', 'recent_products')
  ),
  recent_product_count INTEGER NOT NULL CHECK (recent_product_count > 0),
  consumption_history_scope TEXT NOT NULL CHECK (
    consumption_history_scope IN ('same_product', 'same_profile', 'same_standard_type')
  ),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS stock_lots_by_product_expiry
  ON stock_lots(product_id, expiry_date);
CREATE INDEX IF NOT EXISTS transactions_by_lot_date
  ON inventory_transactions(stock_lot_id, occurred_date);
CREATE UNIQUE INDEX IF NOT EXISTS one_reversal_per_inventory_transaction
  ON inventory_transactions(reversed_transaction_id)
  WHERE reversed_transaction_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS instances_by_profile_date
  ON usage_instances(profile_id, start_date, end_date_exclusive);
CREATE INDEX IF NOT EXISTS care_events_by_item_date
  ON care_events(item_id, planned_date, completed_date);

INSERT INTO item_profiles
  (id, sequence, group_id, management_template, standard_type, name, base_unit,
   side, default_duration_days, is_active, sort_order)
VALUES
  ('scleral-l', 0, 'lenses', 'rigid_long_term', 'scleral', '巩膜镜（L）', '片', 'L', NULL, 1, 0),
  ('soft-r-daily', 1, 'lenses', 'soft_daily', 'soft_daily', '日抛软性隐形眼镜（R）', '片', 'R', NULL, 1, 1),
  ('soft-r-biweekly', 2, 'lenses', 'soft_reusable', 'soft_reusable', '双周抛软性隐形眼镜（R）', '片', 'R', 14, 1, 2),
  ('case-scleral-l', 3, 'periodic', 'lens_case', 'lens_case', '镜盒', '个', NULL, 90, 1, 0),
  ('plunger-l', 4, 'periodic', 'lens_accessory', 'lens_applicator', '摘戴吸棒', '个', NULL, 120, 1, 1),
  ('solution-scleral-1', 5, 'consumables', 'opened_container', 'care_solution', '巩膜镜护理液 · 清洁', '瓶', NULL, NULL, 1, 0),
  ('solution-scleral-2', 6, 'consumables', 'opened_container', 'care_solution', '巩膜镜护理液 · 润滑', '瓶', NULL, NULL, 1, 1),
  ('saline', 7, 'consumables', 'batch_consumable', 'saline', '生理盐水', '瓶', NULL, NULL, 1, 2),
  ('eye-drops', 8, 'consumables', 'opened_container', 'eye_drops', '滴眼液', '瓶', NULL, NULL, 1, 3),
  ('protein-removal-solution', 9, 'consumables', 'discrete_dose', 'protein_removal_solution', '除蛋白液', '对', NULL, NULL, 1, 4);

INSERT INTO locations (id, sequence, name, note, is_active, sort_order) VALUES
  ('home', 0, '家', NULL, 1, 0),
  ('office', 1, '办公室', NULL, 1, 1),
  ('carry', 2, '随身', NULL, 1, 2);

INSERT INTO app_preferences (
  id, timeline_active_color, timeline_paused_color, timeline_completed_color,
  timeline_review_color, timeline_protein_color, timeline_forecast_color,
  timeline_historical_paused_color, timeline_danger_color,
  consumption_history_range, recent_product_count, consumption_history_scope
) VALUES (
  1, '#5b9f87', '#d6a85f', '#6f8fb8', '#6c9fc1', '#a17fa3', '#c18a6a',
  '#a8afb8', '#c96b6b', 'all', 3, 'same_profile'
);

INSERT INTO app_metadata(key, value) VALUES
  ('schema_generation', 'current-1'),
  ('snapshot_present', '1'),
  ('snapshot_schema_version', '1');

INSERT INTO schema_migrations(version) VALUES (1);
