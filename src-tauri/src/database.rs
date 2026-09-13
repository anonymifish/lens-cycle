use rusqlite::{params, Connection, OptionalExtension, Transaction};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::Value;
use std::{collections::HashSet, path::Path, sync::Mutex};

const MIGRATION_001: &str = include_str!("../migrations/001_initial.sql");
const MIGRATION_002: &str = include_str!("../migrations/002_unit_price_precision.sql");
const MIGRATIONS: &[(i64, &str)] = &[(1, MIGRATION_001), (2, MIGRATION_002)];
const CURRENT_SCHEMA_GENERATION: &str = "current-2";

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TimelinePalette {
    pub active: String,
    pub paused: String,
    pub completed: String,
    pub review: String,
    pub protein: String,
    pub forecast: String,
    pub historical_paused: String,
    pub danger: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppPreferences {
    pub timeline_palette: TimelinePalette,
    pub consumption_history_range: String,
    pub recent_product_count: i64,
    pub consumption_history_scope: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InventoryLocation {
    pub id: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
    pub active: bool,
    pub order: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemProfile {
    pub id: String,
    pub group_id: String,
    pub management_template: String,
    pub standard_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub standard_type_name: Option<String>,
    pub name: String,
    pub base_unit: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub side: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default_duration_days: Option<i64>,
    pub active: bool,
    pub order: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Product {
    pub id: String,
    pub item_profile_id: String,
    pub standard_type: String,
    pub brand: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub specification: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub capacity_ml: Option<f64>,
    pub base_unit: String,
    pub units_per_package: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default_duration_days: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sort_order: Option<i64>,
    pub active: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileOrder {
    pub id: String,
    pub order: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProductOrder {
    pub id: String,
    pub sort_order: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StockLot {
    pub id: String,
    pub product_id: String,
    pub internal_lot_code: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lot_number: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub manufactured_date: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expiry_date: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expected_usage_days: Option<i64>,
    pub received_date: String,
    pub location_id: String,
    pub initial_unit_quantity: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub initial_package_quantity: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub initial_loose_unit_quantity: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub units_per_package_at_receipt: Option<i64>,
    /// Integer ten-thousandths of one yuan (1 CNY = 10,000).
    pub unit_price_minor: i64,
    pub currency: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub voided_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub voided_by_transaction_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InventoryTransaction {
    pub id: String,
    pub stock_lot_id: String,
    pub occurred_date: String,
    #[serde(rename = "type")]
    pub transaction_type: String,
    pub quantity_delta: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub related_instance_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub related_cycle_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reversed_transaction_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub allocated_unit_quantity: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub location_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub from_location_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub to_location_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub transfer_quantity: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reversible_with_instance: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TimelineStateInterval {
    pub start_date: String,
    pub end_date: Option<String>,
    pub status: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TimelineLocationInterval {
    pub location_id: String,
    pub start_date: String,
    pub end_date: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReusableLensCycle {
    pub id: String,
    pub label: String,
    pub start_date: String,
    pub end_date: Option<String>,
    pub prediction_date: String,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub end_reason: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EyeAssignmentInterval {
    pub start_date: String,
    pub end_date: Option<String>,
    pub eye_sides: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TimelineItem {
    pub id: String,
    pub category_id: String,
    pub group_id: String,
    pub category_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub product_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_stock_lot_id: Option<String>,
    pub label: String,
    pub detail: String,
    pub location: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub location_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub location_intervals: Option<Vec<TimelineLocationInterval>>,
    pub start_date: String,
    pub end_date: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub prediction_date: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub opened_expiry_date: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub depletion_prediction_date: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub initial_unit_quantity: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub capacity_ml: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub inventory_source_kind: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reusable_lens_cycles: Option<Vec<ReusableLensCycle>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub usage_rate_per_day: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub eye_sides: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub eye_assignment_intervals: Option<Vec<EyeAssignmentInterval>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub end_reason: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub completion_usage_fact_id: Option<String>,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub state_intervals: Option<Vec<TimelineStateInterval>>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageFact {
    pub id: String,
    pub item_id: String,
    pub stock_lot_id: String,
    pub transaction_id: String,
    pub date: String,
    pub kind: String,
    pub quantity: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LensCareEvent {
    pub id: String,
    pub item_id: String,
    pub kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub planned_date: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub completed_date: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppDataMutation {
    #[serde(default)]
    pub upsert_items: Vec<TimelineItem>,
    #[serde(default)]
    pub delete_item_ids: Vec<String>,
    #[serde(default)]
    pub append_transactions: Vec<InventoryTransaction>,
    #[serde(default)]
    pub upsert_usage_facts: Vec<UsageFact>,
    #[serde(default)]
    pub delete_usage_fact_ids: Vec<String>,
    #[serde(default)]
    pub upsert_care_events: Vec<LensCareEvent>,
    #[serde(default)]
    pub delete_care_event_ids: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppDataSnapshot {
    pub schema_version: u32,
    pub profiles: Vec<Value>,
    pub products: Vec<Value>,
    pub locations: Vec<Value>,
    pub lots: Vec<Value>,
    pub transactions: Vec<Value>,
    pub items: Vec<Value>,
    pub usage_facts: Vec<Value>,
    pub care_events: Vec<Value>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CurrentAppDataSnapshot {
    pub schema_version: u32,
    pub profiles: Vec<ItemProfile>,
    pub products: Vec<Product>,
    pub locations: Vec<InventoryLocation>,
    pub lots: Vec<StockLot>,
    pub transactions: Vec<InventoryTransaction>,
    pub items: Vec<TimelineItem>,
    pub usage_facts: Vec<UsageFact>,
    pub care_events: Vec<LensCareEvent>,
}

fn deserialize_values<T: DeserializeOwned>(values: Vec<Value>) -> Result<Vec<T>, String> {
    values
        .into_iter()
        .map(|value| serde_json::from_value(value).map_err(error_string))
        .collect()
}

fn serialize_values<T: Serialize>(values: Vec<T>) -> Vec<Value> {
    values
        .into_iter()
        .map(|value| serde_json::to_value(value).expect("typed snapshot serialization cannot fail"))
        .collect()
}

impl TryFrom<AppDataSnapshot> for CurrentAppDataSnapshot {
    type Error = String;

    fn try_from(snapshot: AppDataSnapshot) -> Result<Self, Self::Error> {
        if snapshot.schema_version != 1 {
            return Err(format!(
                "快照 schema 版本不受支持：需要 1，实际为 {}",
                snapshot.schema_version
            ));
        }
        Ok(Self {
            schema_version: snapshot.schema_version,
            profiles: deserialize_values(snapshot.profiles)?,
            products: deserialize_values(snapshot.products)?,
            locations: deserialize_values(snapshot.locations)?,
            lots: deserialize_values(snapshot.lots)?,
            transactions: deserialize_values(snapshot.transactions)?,
            items: deserialize_values(snapshot.items)?,
            usage_facts: deserialize_values(snapshot.usage_facts)?,
            care_events: deserialize_values(snapshot.care_events)?,
        })
    }
}

impl From<CurrentAppDataSnapshot> for AppDataSnapshot {
    fn from(snapshot: CurrentAppDataSnapshot) -> Self {
        Self {
            schema_version: snapshot.schema_version,
            profiles: serialize_values(snapshot.profiles),
            products: serialize_values(snapshot.products),
            locations: serialize_values(snapshot.locations),
            lots: serialize_values(snapshot.lots),
            transactions: serialize_values(snapshot.transactions),
            items: serialize_values(snapshot.items),
            usage_facts: serialize_values(snapshot.usage_facts),
            care_events: serialize_values(snapshot.care_events),
        }
    }
}

pub struct Database {
    connection: Mutex<Connection>,
}

impl Database {
    pub fn open(path: &Path) -> Result<Self, String> {
        let connection = Connection::open(path).map_err(error_string)?;
        Self::from_connection(connection)
    }

    #[cfg(test)]
    fn in_memory() -> Result<Self, String> {
        Self::from_connection(Connection::open_in_memory().map_err(error_string)?)
    }

    fn from_connection(mut connection: Connection) -> Result<Self, String> {
        connection
            .execute_batch(
                "PRAGMA foreign_keys = ON;
                 PRAGMA journal_mode = WAL;
                 PRAGMA synchronous = FULL;
                 PRAGMA busy_timeout = 5000;",
            )
            .map_err(error_string)?;
        let integrity = connection
            .query_row("PRAGMA quick_check", [], |row| row.get::<_, String>(0))
            .map_err(error_string)?;
        if integrity != "ok" {
            return Err(format!("database integrity check failed: {integrity}"));
        }
        apply_migrations(&mut connection)?;
        Ok(Self {
            connection: Mutex::new(connection),
        })
    }

    pub fn load(&self) -> Result<Option<AppDataSnapshot>, String> {
        let connection = self.connection.lock().map_err(error_string)?;
        let present = connection
            .query_row(
                "SELECT value FROM app_metadata WHERE key = 'snapshot_present'",
                [],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(error_string)?;
        if present.as_deref() != Some("1") {
            let has_domain_rows = connection
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM item_profiles)
                      OR EXISTS(SELECT 1 FROM products)
                      OR EXISTS(SELECT 1 FROM locations)
                      OR EXISTS(SELECT 1 FROM stock_lots)
                      OR EXISTS(SELECT 1 FROM inventory_transactions)
                      OR EXISTS(SELECT 1 FROM usage_instances)
                      OR EXISTS(SELECT 1 FROM usage_facts)
                      OR EXISTS(SELECT 1 FROM care_events)",
                    [],
                    |row| row.get::<_, bool>(0),
                )
                .map_err(error_string)?;
            if !has_domain_rows {
                return Ok(None);
            }
        }
        let schema_version = connection
            .query_row(
                "SELECT value FROM app_metadata WHERE key = 'snapshot_schema_version'",
                [],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(error_string)?
            .ok_or_else(|| "数据库缺少 snapshot_schema_version".to_string())?
            .parse::<u32>()
            .map_err(|_| "数据库 snapshot_schema_version 无效".to_string())?;
        if schema_version != 1 {
            return Err(format!(
                "数据库快照版本不受支持：需要 1，实际为 {schema_version}"
            ));
        }
        Ok(Some(AppDataSnapshot {
            schema_version,
            profiles: load_profiles(&connection)?,
            products: load_products(&connection)?,
            locations: load_locations(&connection)?,
            lots: load_lots(&connection)?,
            transactions: load_transactions(&connection)?,
            items: load_items(&connection)?,
            usage_facts: load_usage_facts(&connection)?,
            care_events: load_care_events(&connection)?,
        }))
    }

    pub fn load_preferences(&self) -> Result<Option<AppPreferences>, String> {
        let connection = self.connection.lock().map_err(error_string)?;
        connection
            .query_row(
                "SELECT timeline_active_color, timeline_paused_color,
                        timeline_completed_color, timeline_review_color,
                        timeline_protein_color, timeline_forecast_color,
                        timeline_historical_paused_color, timeline_danger_color,
                        consumption_history_range, recent_product_count,
                        consumption_history_scope
                   FROM app_preferences WHERE id = 1",
                [],
                |row| {
                    Ok(AppPreferences {
                        timeline_palette: TimelinePalette {
                            active: row.get(0)?,
                            paused: row.get(1)?,
                            completed: row.get(2)?,
                            review: row.get(3)?,
                            protein: row.get(4)?,
                            forecast: row.get(5)?,
                            historical_paused: row.get(6)?,
                            danger: row.get(7)?,
                        },
                        consumption_history_range: row.get(8)?,
                        recent_product_count: row.get(9)?,
                        consumption_history_scope: row.get(10)?,
                    })
                },
            )
            .optional()
            .map_err(error_string)
    }

    pub fn save_preferences(&self, preferences: &AppPreferences) -> Result<(), String> {
        let mut connection = self.connection.lock().map_err(error_string)?;
        let transaction = connection.transaction().map_err(error_string)?;
        write_preferences(&transaction, preferences)?;
        transaction.commit().map_err(error_string)
    }

    pub fn create_location(&self, location: &InventoryLocation) -> Result<(), String> {
        let connection = self.connection.lock().map_err(error_string)?;
        let sequence = connection
            .query_row(
                "SELECT COALESCE(MAX(sequence), -1) + 1 FROM locations",
                [],
                |row| row.get::<_, i64>(0),
            )
            .map_err(error_string)?;
        connection
            .execute(
                "INSERT INTO locations
                 (id, sequence, name, note, is_active, sort_order)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![
                    location.id,
                    sequence,
                    location.name.trim(),
                    location
                        .note
                        .as_deref()
                        .map(str::trim)
                        .filter(|note| !note.is_empty()),
                    i64::from(location.active),
                    location.order,
                ],
            )
            .map_err(error_string)?;
        Ok(())
    }

    pub fn update_location(&self, location: &InventoryLocation) -> Result<(), String> {
        let mut connection = self.connection.lock().map_err(error_string)?;
        let transaction = connection.transaction().map_err(error_string)?;
        let changed = transaction
            .execute(
                "UPDATE locations
                    SET name = ?2, note = ?3, is_active = ?4, sort_order = ?5
                  WHERE id = ?1",
                params![
                    location.id,
                    location.name.trim(),
                    location
                        .note
                        .as_deref()
                        .map(str::trim)
                        .filter(|note| !note.is_empty()),
                    i64::from(location.active),
                    location.order,
                ],
            )
            .map_err(error_string)?;
        if changed == 0 {
            return Err("存储地点不存在".into());
        }
        transaction
            .execute(
                "UPDATE usage_instances SET location_name = ?2 WHERE location_id = ?1",
                params![location.id, location.name.trim()],
            )
            .map_err(error_string)?;
        transaction.commit().map_err(error_string)
    }

    pub fn delete_location(&self, id: &str) -> Result<(), String> {
        let mut connection = self.connection.lock().map_err(error_string)?;
        let transaction = connection.transaction().map_err(error_string)?;
        let active = transaction
            .query_row("SELECT is_active FROM locations WHERE id=?1", [id], |row| {
                row.get::<_, bool>(0)
            })
            .optional()
            .map_err(error_string)?
            .ok_or_else(|| "存储地点不存在".to_string())?;
        let total = transaction
            .query_row("SELECT COUNT(*) FROM locations", [], |row| {
                row.get::<_, i64>(0)
            })
            .map_err(error_string)?;
        if total <= 1 {
            return Err("至少需要保留一个地点".into());
        }
        if active {
            let active_count = transaction
                .query_row(
                    "SELECT COUNT(*) FROM locations WHERE is_active=1",
                    [],
                    |row| row.get::<_, i64>(0),
                )
                .map_err(error_string)?;
            if active_count <= 1 {
                return Err("至少需要保留一个启用地点".into());
            }
        }
        transaction
            .execute("DELETE FROM locations WHERE id=?1", [id])
            .map_err(error_string)?;
        let mut statement = transaction
            .prepare("SELECT id FROM locations ORDER BY sort_order, sequence")
            .map_err(error_string)?;
        let ids = statement
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(error_string)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(error_string)?;
        drop(statement);
        for (order, location_id) in ids.iter().enumerate() {
            transaction
                .execute(
                    "UPDATE locations SET sort_order=?2 WHERE id=?1",
                    params![location_id, order as i64],
                )
                .map_err(error_string)?;
        }
        transaction.commit().map_err(error_string)
    }

    pub fn create_profile(&self, profile: &ItemProfile) -> Result<(), String> {
        let connection = self.connection.lock().map_err(error_string)?;
        let sequence = next_sequence(&connection, "item_profiles")?;
        connection
            .execute(
                "INSERT INTO item_profiles
             (id, sequence, group_id, management_template, standard_type,
              standard_type_name, name, base_unit, side, default_duration_days,
              is_active, sort_order)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
                params![
                    profile.id,
                    sequence,
                    profile.group_id,
                    profile.management_template,
                    profile.standard_type,
                    profile.standard_type_name,
                    profile.name,
                    profile.base_unit,
                    profile.side,
                    profile.default_duration_days,
                    i64::from(profile.active),
                    profile.order,
                ],
            )
            .map_err(error_string)?;
        Ok(())
    }

    pub fn update_profile(&self, profile: &ItemProfile) -> Result<(), String> {
        let mut connection = self.connection.lock().map_err(error_string)?;
        let transaction = connection.transaction().map_err(error_string)?;
        let changed = transaction
            .execute(
                "UPDATE item_profiles SET group_id=?2, management_template=?3,
                    standard_type=?4, standard_type_name=?5, name=?6, base_unit=?7,
                    side=?8, default_duration_days=?9, is_active=?10,
                    sort_order=?11 WHERE id=?1",
                params![
                    profile.id,
                    profile.group_id,
                    profile.management_template,
                    profile.standard_type,
                    profile.standard_type_name,
                    profile.name,
                    profile.base_unit,
                    profile.side,
                    profile.default_duration_days,
                    i64::from(profile.active),
                    profile.order,
                ],
            )
            .map_err(error_string)?;
        if changed == 0 {
            return Err("用品配置不存在".into());
        }
        transaction
            .execute(
                "UPDATE products SET standard_type=?2, base_unit=?3
                 WHERE item_profile_id=?1",
                params![profile.id, profile.standard_type, profile.base_unit],
            )
            .map_err(error_string)?;
        transaction.commit().map_err(error_string)
    }

    pub fn delete_profile(&self, id: &str) -> Result<(), String> {
        let mut connection = self.connection.lock().map_err(error_string)?;
        let transaction = connection.transaction().map_err(error_string)?;
        let group = transaction
            .query_row(
                "SELECT group_id FROM item_profiles WHERE id=?1",
                [id],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(error_string)?
            .ok_or_else(|| "用品配置不存在".to_string())?;
        transaction
            .execute("DELETE FROM item_profiles WHERE id=?1", [id])
            .map_err(error_string)?;
        let mut statement = transaction
            .prepare("SELECT id FROM item_profiles WHERE group_id=?1 ORDER BY sort_order, sequence")
            .map_err(error_string)?;
        let ids = statement
            .query_map([group], |row| row.get::<_, String>(0))
            .map_err(error_string)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(error_string)?;
        drop(statement);
        for (order, profile_id) in ids.iter().enumerate() {
            transaction
                .execute(
                    "UPDATE item_profiles SET sort_order=?2 WHERE id=?1",
                    params![profile_id, order as i64],
                )
                .map_err(error_string)?;
        }
        transaction.commit().map_err(error_string)
    }

    pub fn reorder_profiles(&self, order: &[ProfileOrder]) -> Result<(), String> {
        let mut connection = self.connection.lock().map_err(error_string)?;
        let transaction = connection.transaction().map_err(error_string)?;
        for entry in order {
            let changed = transaction
                .execute(
                    "UPDATE item_profiles SET sort_order=?2 WHERE id=?1",
                    params![entry.id, entry.order],
                )
                .map_err(error_string)?;
            if changed == 0 {
                return Err("用品配置不存在".into());
            }
        }
        transaction.commit().map_err(error_string)
    }

    pub fn create_product(&self, product: &Product) -> Result<(), String> {
        let connection = self.connection.lock().map_err(error_string)?;
        let sequence = next_sequence(&connection, "products")?;
        write_product(&connection, product, Some(sequence), true)
    }

    pub fn update_product(&self, product: &Product) -> Result<(), String> {
        let connection = self.connection.lock().map_err(error_string)?;
        write_product(&connection, product, None, false)
    }

    pub fn delete_product(&self, id: &str) -> Result<(), String> {
        delete_one(&self.connection, "products", id, "产品不存在")
    }

    pub fn reorder_products(&self, order: &[ProductOrder]) -> Result<(), String> {
        let mut connection = self.connection.lock().map_err(error_string)?;
        let transaction = connection.transaction().map_err(error_string)?;
        for entry in order {
            let changed = transaction
                .execute(
                    "UPDATE products SET sort_order=?2 WHERE id=?1",
                    params![entry.id, entry.sort_order],
                )
                .map_err(error_string)?;
            if changed == 0 {
                return Err("产品不存在".into());
            }
        }
        transaction.commit().map_err(error_string)
    }

    pub fn receive_stock(
        &self,
        lot: &StockLot,
        entry: &InventoryTransaction,
        product: Option<&Product>,
    ) -> Result<(), String> {
        let mut connection = self.connection.lock().map_err(error_string)?;
        receive_stock_transaction(&mut connection, lot, entry, product)
    }

    pub fn transfer_stock(&self, entry: &InventoryTransaction) -> Result<(), String> {
        let mut connection = self.connection.lock().map_err(error_string)?;
        transfer_stock_transaction(&mut connection, entry)
    }

    pub fn update_stock_lot(
        &self,
        lot: &StockLot,
        reverse_id: &str,
        replacement_id: &str,
    ) -> Result<Vec<InventoryTransaction>, String> {
        let mut connection = self.connection.lock().map_err(error_string)?;
        update_stock_lot_transaction(&mut connection, lot, reverse_id, replacement_id)
    }

    pub fn void_unused_stock_lot(
        &self,
        id: &str,
        voided_at: &str,
        reversal_id: &str,
    ) -> Result<(StockLot, Vec<InventoryTransaction>), String> {
        let mut connection = self.connection.lock().map_err(error_string)?;
        void_unused_stock_lot_transaction(&mut connection, id, voided_at, reversal_id)
    }

    pub fn commit_mutation(&self, mutation: &AppDataMutation) -> Result<(), String> {
        let mut connection = self.connection.lock().map_err(error_string)?;
        commit_app_data_mutation(&mut connection, mutation)
    }

    pub fn save(&self, snapshot: &AppDataSnapshot) -> Result<(), String> {
        let mut connection = self.connection.lock().map_err(error_string)?;
        let transaction = connection.transaction().map_err(error_string)?;
        replace_snapshot(&transaction, snapshot)?;
        transaction.commit().map_err(error_string)
    }

    pub fn restore(
        &self,
        snapshot: &AppDataSnapshot,
        preferences: &AppPreferences,
    ) -> Result<(), String> {
        let mut connection = self.connection.lock().map_err(error_string)?;
        let transaction = connection.transaction().map_err(error_string)?;
        replace_snapshot(&transaction, snapshot)?;
        write_preferences(&transaction, preferences)?;
        transaction.commit().map_err(error_string)
    }

    pub fn checkpoint(&self) -> Result<(), String> {
        let connection = self.connection.lock().map_err(error_string)?;
        let (busy, _, _) = connection
            .query_row("PRAGMA wal_checkpoint(TRUNCATE)", [], |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, i64>(2)?,
                ))
            })
            .map_err(error_string)?;
        if busy != 0 {
            return Err("SQLite WAL checkpoint 未能取得独占写入机会".into());
        }
        Ok(())
    }

    pub fn close(self) -> Result<(), Box<(Self, String)>> {
        let connection = match self.connection.into_inner() {
            Ok(connection) => connection,
            Err(poisoned) => {
                return Err(Box::new((
                    Self {
                        connection: Mutex::new(poisoned.into_inner()),
                    },
                    "SQLite 连接锁已损坏，无法确认数据库关闭".into(),
                )));
            }
        };
        match connection.close() {
            Ok(()) => Ok(()),
            Err((connection, error)) => Err(Box::new((
                Self {
                    connection: Mutex::new(connection),
                },
                error_string(error),
            ))),
        }
    }

    pub fn finalize_for_file_move(self) -> Result<(), String> {
        self.checkpoint()?;
        {
            let connection = self.connection.lock().map_err(error_string)?;
            let mode = connection
                .query_row("PRAGMA journal_mode = DELETE", [], |row| {
                    row.get::<_, String>(0)
                })
                .map_err(error_string)?;
            if !mode.eq_ignore_ascii_case("delete") {
                return Err(format!("SQLite 未能结束 staging WAL 模式：{mode}"));
            }
        }
        self.close().map_err(|failure| {
            let (_, error) = *failure;
            error
        })
    }
}

fn replace_snapshot(
    transaction: &Transaction<'_>,
    snapshot: &AppDataSnapshot,
) -> Result<(), String> {
    if snapshot.schema_version != 1 {
        return Err(format!(
            "快照 schema 版本不受支持：需要 1，实际为 {}",
            snapshot.schema_version
        ));
    }
    transaction
        .execute(
            "INSERT INTO app_metadata(key, value) VALUES ('allow_inventory_rewrite', '1')
                 ON CONFLICT(key) DO UPDATE SET value = '1'",
            [],
        )
        .map_err(error_string)?;
    transaction
        .execute_batch(
            "PRAGMA defer_foreign_keys = ON;
                 DELETE FROM instance_state_intervals;
                 DELETE FROM instance_location_intervals;
                 DELETE FROM instance_eye_assignment_intervals;
                 DELETE FROM reusable_lens_cycles;
                 DELETE FROM usage_facts;
                 DELETE FROM care_events;
                 DELETE FROM inventory_transactions;
                 DELETE FROM usage_instances;
                 DELETE FROM stock_lots;
                 DELETE FROM products;
                 DELETE FROM item_profiles;
                 DELETE FROM locations;",
        )
        .map_err(error_string)?;

    insert_profiles(transaction, &snapshot.profiles)?;
    insert_locations(transaction, &snapshot.locations)?;
    insert_products(transaction, &snapshot.products)?;
    insert_lots(transaction, &snapshot.lots)?;
    insert_items(transaction, &snapshot.items)?;
    insert_transactions(transaction, &snapshot.transactions)?;
    insert_usage_facts(transaction, &snapshot.usage_facts)?;
    insert_care_events(transaction, &snapshot.care_events)?;
    validate_inventory_ledger(transaction)?;
    transaction
        .execute(
            "INSERT INTO app_metadata(key, value) VALUES ('snapshot_schema_version', ?1)
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            [snapshot.schema_version.to_string()],
        )
        .map_err(error_string)?;
    transaction
        .execute(
            "INSERT INTO app_metadata(key, value) VALUES ('snapshot_present', '1')
                 ON CONFLICT(key) DO UPDATE SET value = '1'",
            [],
        )
        .map_err(error_string)?;
    transaction
        .execute(
            "DELETE FROM app_metadata WHERE key = 'allow_inventory_rewrite'",
            [],
        )
        .map_err(error_string)?;
    Ok(())
}

fn write_preferences(
    transaction: &Transaction<'_>,
    preferences: &AppPreferences,
) -> Result<(), String> {
    transaction
        .execute(
            "INSERT INTO app_preferences (
                id, timeline_active_color, timeline_paused_color,
                timeline_completed_color, timeline_review_color,
                timeline_protein_color, timeline_forecast_color,
                timeline_historical_paused_color, timeline_danger_color,
                consumption_history_range, recent_product_count,
                consumption_history_scope, updated_at
             ) VALUES (1, ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11,
                       CURRENT_TIMESTAMP)
             ON CONFLICT(id) DO UPDATE SET
                timeline_active_color = excluded.timeline_active_color,
                timeline_paused_color = excluded.timeline_paused_color,
                timeline_completed_color = excluded.timeline_completed_color,
                timeline_review_color = excluded.timeline_review_color,
                timeline_protein_color = excluded.timeline_protein_color,
                timeline_forecast_color = excluded.timeline_forecast_color,
                timeline_historical_paused_color = excluded.timeline_historical_paused_color,
                timeline_danger_color = excluded.timeline_danger_color,
                consumption_history_range = excluded.consumption_history_range,
                recent_product_count = excluded.recent_product_count,
                consumption_history_scope = excluded.consumption_history_scope,
                updated_at = CURRENT_TIMESTAMP",
            params![
                preferences.timeline_palette.active,
                preferences.timeline_palette.paused,
                preferences.timeline_palette.completed,
                preferences.timeline_palette.review,
                preferences.timeline_palette.protein,
                preferences.timeline_palette.forecast,
                preferences.timeline_palette.historical_paused,
                preferences.timeline_palette.danger,
                preferences.consumption_history_range,
                preferences.recent_product_count,
                preferences.consumption_history_scope,
            ],
        )
        .map_err(error_string)?;
    Ok(())
}

fn write_stock_lot(transaction: &Transaction<'_>, lot: &StockLot) -> Result<(), String> {
    let sequence = transaction
        .query_row(
            "SELECT COALESCE(MAX(sequence), -1) + 1 FROM stock_lots",
            [],
            |row| row.get::<_, i64>(0),
        )
        .map_err(error_string)?;
    transaction
        .execute(
            "INSERT INTO stock_lots
         (id, sequence, product_id, location_id, internal_lot_code, lot_number,
          received_date, manufactured_date, expiry_date, expected_usage_days,
          initial_unit_quantity, initial_package_quantity, initial_loose_unit_quantity,
          units_per_package_at_receipt, unit_price_minor, currency, voided_at,
          voided_by_transaction_id)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18)",
            params![
                lot.id,
                sequence,
                lot.product_id,
                lot.location_id,
                lot.internal_lot_code,
                lot.lot_number,
                lot.received_date,
                lot.manufactured_date,
                lot.expiry_date,
                lot.expected_usage_days,
                lot.initial_unit_quantity,
                lot.initial_package_quantity,
                lot.initial_loose_unit_quantity,
                lot.units_per_package_at_receipt,
                lot.unit_price_minor,
                lot.currency,
                lot.voided_at,
                lot.voided_by_transaction_id,
            ],
        )
        .map_err(error_string)?;
    Ok(())
}

fn update_stock_lot_row(transaction: &Transaction<'_>, lot: &StockLot) -> Result<(), String> {
    let changed = transaction
        .execute(
            "UPDATE stock_lots SET product_id=?2, location_id=?3, internal_lot_code=?4,
                lot_number=?5, received_date=?6, manufactured_date=?7, expiry_date=?8,
                expected_usage_days=?9, initial_unit_quantity=?10,
                initial_package_quantity=?11, initial_loose_unit_quantity=?12,
                units_per_package_at_receipt=?13, unit_price_minor=?14, currency=?15
             WHERE id=?1",
            params![
                lot.id,
                lot.product_id,
                lot.location_id,
                lot.internal_lot_code,
                lot.lot_number,
                lot.received_date,
                lot.manufactured_date,
                lot.expiry_date,
                lot.expected_usage_days,
                lot.initial_unit_quantity,
                lot.initial_package_quantity,
                lot.initial_loose_unit_quantity,
                lot.units_per_package_at_receipt,
                lot.unit_price_minor,
                lot.currency,
            ],
        )
        .map_err(error_string)?;
    if changed == 0 {
        return Err("库存批次不存在".into());
    }
    Ok(())
}

fn write_inventory_transaction(
    transaction: &Transaction<'_>,
    entry: &InventoryTransaction,
) -> Result<(), String> {
    let sequence = transaction
        .query_row(
            "SELECT COALESCE(MAX(sequence), -1) + 1 FROM inventory_transactions",
            [],
            |row| row.get::<_, i64>(0),
        )
        .map_err(error_string)?;
    transaction.execute(
        "INSERT INTO inventory_transactions
         (id, sequence, stock_lot_id, occurred_date, transaction_type, quantity_delta,
          related_instance_id, related_cycle_id, reversed_transaction_id, allocated_unit_quantity, location_id,
          from_location_id, to_location_id, transfer_quantity, reversible_with_instance,
          reason)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)",
        params![entry.id, sequence, entry.stock_lot_id, entry.occurred_date,
            entry.transaction_type, entry.quantity_delta, entry.related_instance_id,
            entry.related_cycle_id, entry.reversed_transaction_id, entry.allocated_unit_quantity, entry.location_id,
            entry.from_location_id, entry.to_location_id, entry.transfer_quantity,
            entry.reversible_with_instance.map(i64::from), entry.reason],
    ).map_err(error_string)?;
    Ok(())
}

fn receive_stock_transaction(
    connection: &mut Connection,
    lot: &StockLot,
    entry: &InventoryTransaction,
    product: Option<&Product>,
) -> Result<(), String> {
    if lot.voided_at.is_some()
        || lot.voided_by_transaction_id.is_some()
        || entry.transaction_type != "stock_in"
        || entry.stock_lot_id != lot.id
        || entry.occurred_date != lot.received_date
        || entry.quantity_delta != lot.initial_unit_quantity
        || entry.location_id.as_deref() != Some(lot.location_id.as_str())
    {
        return Err("入库批次与库存流水不一致".into());
    }
    let transaction = connection.transaction().map_err(error_string)?;
    let active = transaction
        .query_row(
            "SELECT is_active FROM locations WHERE id=?1",
            [&lot.location_id],
            |row| row.get::<_, bool>(0),
        )
        .optional()
        .map_err(error_string)?
        .ok_or_else(|| "入库地点不存在".to_string())?;
    if !active {
        return Err("入库地点不可用".into());
    }
    if let Some(product) = product {
        if product.id != lot.product_id {
            return Err("入库产品资料与批次不一致".into());
        }
        write_product(&transaction, product, None, false)?;
    }
    write_stock_lot(&transaction, lot)?;
    write_inventory_transaction(&transaction, entry)?;
    transaction.commit().map_err(error_string)
}

fn available_at_location(
    transaction: &Transaction<'_>,
    lot_id: &str,
    location_id: &str,
) -> Result<i64, String> {
    transaction.query_row(
        "SELECT COALESCE(SUM(CASE
            WHEN t.transaction_type='transfer' AND t.from_location_id=?2 THEN -t.transfer_quantity
            WHEN t.transaction_type='transfer' AND t.to_location_id=?2 THEN t.transfer_quantity
            WHEN t.transaction_type!='transfer' AND COALESCE(t.location_id, l.location_id)=?2 THEN t.quantity_delta
            ELSE 0 END), 0)
         FROM stock_lots l JOIN inventory_transactions t ON t.stock_lot_id=l.id
         WHERE l.id=?1 AND t.transaction_type!='reverse'
           AND t.id NOT IN (SELECT reversed_transaction_id FROM inventory_transactions
                            WHERE transaction_type='reverse' AND reversed_transaction_id IS NOT NULL)",
        params![lot_id, location_id], |row| row.get(0),
    ).map_err(error_string)
}

fn transfer_stock_transaction(
    connection: &mut Connection,
    entry: &InventoryTransaction,
) -> Result<(), String> {
    let (Some(from), Some(to), Some(quantity)) = (
        entry.from_location_id.as_deref(),
        entry.to_location_id.as_deref(),
        entry.transfer_quantity,
    ) else {
        return Err("库存转移字段不完整".into());
    };
    if entry.transaction_type != "transfer"
        || entry.quantity_delta != 0
        || quantity <= 0
        || from == to
    {
        return Err("库存转移字段无效".into());
    }
    let transaction = connection.transaction().map_err(error_string)?;
    validate_transfer_locations(&transaction, from, to)?;
    if available_at_location(&transaction, &entry.stock_lot_id, from)? < quantity {
        return Err("来源地点可转移库存不足".into());
    }
    write_inventory_transaction(&transaction, entry)?;
    transaction.commit().map_err(error_string)
}

fn validate_transfer_locations(
    transaction: &Transaction<'_>,
    from: &str,
    to: &str,
) -> Result<(), String> {
    transaction
        .query_row("SELECT 1 FROM locations WHERE id=?1", [from], |_| Ok(()))
        .optional()
        .map_err(error_string)?
        .ok_or_else(|| "来源地点不存在".to_string())?;
    let active = transaction
        .query_row("SELECT is_active FROM locations WHERE id=?1", [to], |row| {
            row.get::<_, bool>(0)
        })
        .optional()
        .map_err(error_string)?
        .ok_or_else(|| "目标地点不存在".to_string())?;
    if !active {
        return Err("目标地点不可用".into());
    }
    Ok(())
}

fn update_stock_lot_transaction(
    connection: &mut Connection,
    lot: &StockLot,
    reverse_id: &str,
    replacement_id: &str,
) -> Result<Vec<InventoryTransaction>, String> {
    let transaction = connection.transaction().map_err(error_string)?;
    let active = transaction
        .query_row(
            "SELECT is_active FROM locations WHERE id=?1",
            [&lot.location_id],
            |row| row.get::<_, bool>(0),
        )
        .optional()
        .map_err(error_string)?
        .ok_or_else(|| "批次地点不存在".to_string())?;
    if !active {
        return Err("批次地点不可用".into());
    }
    let stock_in = effective_stock_in(&transaction, &lot.id)?
        .ok_or_else(|| "批次缺少有效入库流水".to_string())?;
    let other_quantity = effective_other_quantity(&transaction, &lot.id, &stock_in.0)?;
    if lot.initial_unit_quantity + other_quantity < 0 {
        return Err("入库数量不能低于已使用或损耗数量".into());
    }
    update_stock_lot_row(&transaction, lot)?;
    let mut created = Vec::new();
    if stock_in.1 != lot.received_date
        || stock_in.2 != lot.initial_unit_quantity
        || stock_in.3 != lot.location_id
    {
        if reverse_id.trim().is_empty() || replacement_id.trim().is_empty() {
            return Err("更正入库流水标识不能为空".into());
        }
        created.push(stock_in_reversal(reverse_id, &lot.id, &stock_in));
        created.push(replacement_stock_in(replacement_id, lot));
        for entry in &created {
            write_inventory_transaction(&transaction, entry)?;
        }
    }
    ensure_nonnegative_location_balances(&transaction, &lot.id)?;
    transaction.commit().map_err(error_string)?;
    Ok(created)
}

fn void_unused_stock_lot_transaction(
    connection: &mut Connection,
    id: &str,
    voided_at: &str,
    reversal_id: &str,
) -> Result<(StockLot, Vec<InventoryTransaction>), String> {
    let transaction = connection.transaction().map_err(error_string)?;
    transaction
        .execute_batch("PRAGMA defer_foreign_keys = ON;")
        .map_err(error_string)?;
    let mut lot = transaction
        .query_row(
            "SELECT id, product_id, internal_lot_code, lot_number, manufactured_date,
                    expiry_date, expected_usage_days, received_date, location_id,
                    initial_unit_quantity, initial_package_quantity, initial_loose_unit_quantity,
                    units_per_package_at_receipt, unit_price_minor, currency, voided_at,
                    voided_by_transaction_id
               FROM stock_lots WHERE id=?1",
            [id],
            |row| {
                Ok(StockLot {
                    id: row.get(0)?,
                    product_id: row.get(1)?,
                    internal_lot_code: row.get(2)?,
                    lot_number: row.get(3)?,
                    manufactured_date: row.get(4)?,
                    expiry_date: row.get(5)?,
                    expected_usage_days: row.get(6)?,
                    received_date: row.get(7)?,
                    location_id: row.get(8)?,
                    initial_unit_quantity: row.get(9)?,
                    initial_package_quantity: row.get(10)?,
                    initial_loose_unit_quantity: row.get(11)?,
                    units_per_package_at_receipt: row.get(12)?,
                    unit_price_minor: row.get(13)?,
                    currency: row.get(14)?,
                    voided_at: row.get(15)?,
                    voided_by_transaction_id: row.get(16)?,
                })
            },
        )
        .optional()
        .map_err(error_string)?
        .ok_or_else(|| "库存批次不存在".to_string())?;
    if lot.voided_at.is_some() {
        return Err("库存批次已经作废".into());
    }
    let instance_count = transaction
        .query_row(
            "SELECT COUNT(*) FROM usage_instances WHERE source_stock_lot_id=?1",
            [id],
            |row| row.get::<_, i64>(0),
        )
        .map_err(error_string)?;
    if instance_count > 0 {
        return Err("批次仍有关联的使用实例，不能作废".into());
    }
    let usage_count = transaction
        .query_row(
            "SELECT COUNT(*)
               FROM inventory_transactions AS entry
              WHERE entry.stock_lot_id=?1
                AND entry.transaction_type IN
                    ('activate', 'package_open', 'loose_allocate', 'consume', 'loss', 'discard')
                ",
            [id],
            |row| row.get::<_, i64>(0),
        )
        .map_err(error_string)?;
    let usage_fact_count = transaction
        .query_row(
            "SELECT COUNT(*) FROM usage_facts WHERE stock_lot_id=?1",
            [id],
            |row| row.get::<_, i64>(0),
        )
        .map_err(error_string)?;
    if usage_count > 0 || usage_fact_count > 0 {
        return Err("批次已有启用、消耗或损耗记录，不能作废".into());
    }

    let originals = load_effective_lot_transactions(&transaction, id)?;
    if !originals
        .iter()
        .any(|entry| entry.transaction_type == "stock_in")
    {
        return Err("批次缺少有效入库流水".into());
    }
    let mut reversals = Vec::with_capacity(originals.len());
    for (index, original) in originals.iter().enumerate() {
        let id = if index == 0 {
            reversal_id.to_string()
        } else {
            format!("{reversal_id}-{index}")
        };
        reversals.push(InventoryTransaction {
            id,
            stock_lot_id: original.stock_lot_id.clone(),
            occurred_date: voided_at.to_string(),
            transaction_type: "reverse".into(),
            quantity_delta: -original.quantity_delta,
            related_instance_id: None,
            related_cycle_id: None,
            reversed_transaction_id: Some(original.id.clone()),
            allocated_unit_quantity: None,
            location_id: None,
            from_location_id: None,
            to_location_id: None,
            transfer_quantity: None,
            reversible_with_instance: None,
            reason: Some("作废误录批次".into()),
        });
    }
    for reversal in &reversals {
        write_inventory_transaction(&transaction, reversal)?;
    }
    let stock_in_reversal_id = reversals
        .iter()
        .zip(originals.iter())
        .find(|(_, original)| original.transaction_type == "stock_in")
        .map(|(reversal, _)| reversal.id.clone())
        .ok_or_else(|| "批次缺少有效入库流水".to_string())?;
    transaction
        .execute(
            "UPDATE stock_lots SET voided_at=?2, voided_by_transaction_id=?3 WHERE id=?1",
            params![id, voided_at, stock_in_reversal_id],
        )
        .map_err(error_string)?;
    ensure_nonnegative_location_balances(&transaction, id)?;
    validate_inventory_ledger(&transaction)?;
    lot.voided_at = Some(voided_at.to_string());
    lot.voided_by_transaction_id = Some(stock_in_reversal_id);
    transaction.commit().map_err(error_string)?;
    Ok((lot, reversals))
}

fn load_effective_lot_transactions(
    transaction: &Transaction<'_>,
    lot_id: &str,
) -> Result<Vec<InventoryTransaction>, String> {
    let mut statement = transaction
        .prepare(
            "SELECT id, stock_lot_id, occurred_date, transaction_type, quantity_delta,
                    related_instance_id, related_cycle_id, reversed_transaction_id,
                    allocated_unit_quantity, location_id, from_location_id, to_location_id,
                    transfer_quantity, reversible_with_instance, reason
               FROM inventory_transactions AS entry
              WHERE stock_lot_id=?1 AND transaction_type!='reverse'
                AND NOT EXISTS (
                    SELECT 1 FROM inventory_transactions AS reversal
                     WHERE reversal.transaction_type='reverse'
                       AND reversal.reversed_transaction_id=entry.id
                )
              ORDER BY CASE WHEN transaction_type='stock_in' THEN 0 ELSE 1 END, sequence",
        )
        .map_err(error_string)?;
    let rows = statement
        .query_map([lot_id], |row| {
            Ok(InventoryTransaction {
                id: row.get(0)?,
                stock_lot_id: row.get(1)?,
                occurred_date: row.get(2)?,
                transaction_type: row.get(3)?,
                quantity_delta: row.get(4)?,
                related_instance_id: row.get(5)?,
                related_cycle_id: row.get(6)?,
                reversed_transaction_id: row.get(7)?,
                allocated_unit_quantity: row.get(8)?,
                location_id: row.get(9)?,
                from_location_id: row.get(10)?,
                to_location_id: row.get(11)?,
                transfer_quantity: row.get(12)?,
                reversible_with_instance: row.get::<_, Option<i64>>(13)?.map(|value| value != 0),
                reason: row.get(14)?,
            })
        })
        .map_err(error_string)?;
    rows.collect::<Result<Vec<_>, _>>().map_err(error_string)
}

fn commit_app_data_mutation(
    connection: &mut Connection,
    mutation: &AppDataMutation,
) -> Result<(), String> {
    let transaction = connection.transaction().map_err(error_string)?;
    transaction
        .execute_batch("PRAGMA defer_foreign_keys = ON;")
        .map_err(error_string)?;

    let affected_lot_ids: HashSet<String> = mutation
        .append_transactions
        .iter()
        .map(|entry| entry.stock_lot_id.clone())
        .collect();

    delete_rows_by_id(&transaction, "care_events", &mutation.delete_care_event_ids)?;
    delete_rows_by_id(&transaction, "usage_facts", &mutation.delete_usage_fact_ids)?;
    delete_rows_by_id(&transaction, "usage_instances", &mutation.delete_item_ids)?;

    for item in &mutation.upsert_items {
        write_timeline_item(&transaction, item)?;
    }
    for entry in &mutation.append_transactions {
        write_inventory_transaction(&transaction, entry)?;
    }
    for fact in &mutation.upsert_usage_facts {
        write_usage_fact(&transaction, fact)?;
    }
    for event in &mutation.upsert_care_events {
        write_care_event(&transaction, event)?;
    }
    for lot_id in affected_lot_ids {
        ensure_nonnegative_location_balances(&transaction, &lot_id)?;
    }
    validate_inventory_ledger(&transaction)?;
    transaction
        .execute(
            "INSERT INTO app_metadata(key, value) VALUES ('snapshot_present', '1')
             ON CONFLICT(key) DO UPDATE SET value = '1'",
            [],
        )
        .map_err(error_string)?;
    transaction.commit().map_err(error_string)
}

fn delete_rows_by_id(
    transaction: &Transaction<'_>,
    table: &str,
    ids: &[String],
) -> Result<(), String> {
    if ids.is_empty() {
        return Ok(());
    }
    if !matches!(table, "care_events" | "usage_facts" | "usage_instances") {
        return Err("不支持的删除表".into());
    }
    let sql = format!("DELETE FROM {table} WHERE id=?1");
    for id in ids {
        transaction.execute(&sql, [id]).map_err(error_string)?;
    }
    Ok(())
}

fn validate_inventory_ledger(transaction: &Transaction<'_>) -> Result<(), String> {
    let invalid_reversal = transaction
        .query_row(
            "SELECT EXISTS(
                SELECT 1
                  FROM inventory_transactions AS reversal
                  LEFT JOIN inventory_transactions AS original
                    ON original.id=reversal.reversed_transaction_id
                 WHERE reversal.transaction_type='reverse'
                   AND (original.id IS NULL
                     OR original.transaction_type='reverse'
                     OR original.stock_lot_id!=reversal.stock_lot_id
                     OR original.quantity_delta!=-reversal.quantity_delta)
             )",
            [],
            |row| row.get::<_, bool>(0),
        )
        .map_err(error_string)?;
    if invalid_reversal {
        return Err("反向库存流水与原流水不一致".into());
    }

    let orphan_effective_relation = transaction
        .query_row(
            "SELECT EXISTS(
                SELECT 1
                  FROM inventory_transactions AS entry
                  LEFT JOIN usage_instances AS instance
                    ON instance.id=entry.related_instance_id
                 WHERE entry.related_instance_id IS NOT NULL
                   AND instance.id IS NULL
                   AND NOT EXISTS(
                     SELECT 1 FROM inventory_transactions AS reversal
                      WHERE reversal.transaction_type='reverse'
                        AND reversal.reversed_transaction_id=entry.id
                   )
             )",
            [],
            |row| row.get::<_, bool>(0),
        )
        .map_err(error_string)?;
    if orphan_effective_relation {
        return Err("有效库存流水关联的使用实例不存在".into());
    }

    let invalid_lot = transaction
        .query_row(
            "SELECT EXISTS(
                SELECT 1 FROM stock_lots AS lot
                 WHERE (
                   lot.voided_at IS NULL AND (
                     SELECT COUNT(*) FROM inventory_transactions AS stock_in
                      WHERE stock_in.stock_lot_id=lot.id
                        AND stock_in.transaction_type='stock_in'
                        AND NOT EXISTS(
                          SELECT 1 FROM inventory_transactions AS reversal
                           WHERE reversal.transaction_type='reverse'
                             AND reversal.reversed_transaction_id=stock_in.id
                        )
                   )!=1
                 ) OR (
                   lot.voided_at IS NOT NULL AND (
                     EXISTS(
                       SELECT 1 FROM inventory_transactions AS stock_in
                        WHERE stock_in.stock_lot_id=lot.id
                          AND stock_in.transaction_type='stock_in'
                          AND NOT EXISTS(
                            SELECT 1 FROM inventory_transactions AS reversal
                             WHERE reversal.transaction_type='reverse'
                               AND reversal.reversed_transaction_id=stock_in.id
                          )
                     ) OR NOT EXISTS(
                       SELECT 1
                         FROM inventory_transactions AS reversal
                         JOIN inventory_transactions AS original
                           ON original.id=reversal.reversed_transaction_id
                        WHERE reversal.id=lot.voided_by_transaction_id
                          AND reversal.transaction_type='reverse'
                          AND reversal.stock_lot_id=lot.id
                          AND reversal.occurred_date=lot.voided_at
                          AND original.transaction_type='stock_in'
                          AND original.stock_lot_id=lot.id
                     )
                   )
                 )
             )",
            [],
            |row| row.get::<_, bool>(0),
        )
        .map_err(error_string)?;
    if invalid_lot {
        return Err("库存批次与有效入库或作废流水不一致".into());
    }
    Ok(())
}

fn existing_or_next_sequence(
    transaction: &Transaction<'_>,
    table: &str,
    id: &str,
) -> Result<i64, String> {
    if !matches!(table, "usage_instances" | "usage_facts" | "care_events") {
        return Err("不支持的顺序表".into());
    }
    if let Some(sequence) = transaction
        .query_row(
            &format!("SELECT sequence FROM {table} WHERE id=?1"),
            [id],
            |row| row.get::<_, i64>(0),
        )
        .optional()
        .map_err(error_string)?
    {
        return Ok(sequence);
    }
    transaction
        .query_row(
            &format!("SELECT COALESCE(MAX(sequence), -1) + 1 FROM {table}"),
            [],
            |row| row.get(0),
        )
        .map_err(error_string)
}

fn write_timeline_item(transaction: &Transaction<'_>, item: &TimelineItem) -> Result<(), String> {
    validate_timeline_item(transaction, item)?;
    let product_id = item
        .product_id
        .as_deref()
        .ok_or_else(|| "使用实例缺少产品标识".to_string())?;
    let source_stock_lot_id = item
        .source_stock_lot_id
        .as_deref()
        .ok_or_else(|| "使用实例缺少来源批次".to_string())?;
    let location_id = item
        .location_id
        .as_deref()
        .ok_or_else(|| "使用实例缺少地点标识".to_string())?;
    let sequence = existing_or_next_sequence(transaction, "usage_instances", &item.id)?;
    let eye_sides_json = item
        .eye_sides
        .as_ref()
        .map(serde_json::to_string)
        .transpose()
        .map_err(error_string)?;
    transaction
        .execute(
            "INSERT INTO usage_instances
             (id, sequence, profile_id, product_id, source_stock_lot_id, location_id,
              group_id, category_name, name, detail, location_name, start_date,
              end_date_exclusive, prediction_date, opened_expiry_date,
              depletion_prediction_date, initial_unit_quantity, capacity_ml,
              inventory_source_kind, usage_rate_per_day, eye_sides_json,
               end_reason, completion_usage_fact_id, status)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13,
                     ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24)
             ON CONFLICT(id) DO UPDATE SET
               sequence=excluded.sequence, profile_id=excluded.profile_id,
               product_id=excluded.product_id, source_stock_lot_id=excluded.source_stock_lot_id,
               location_id=excluded.location_id, group_id=excluded.group_id,
               category_name=excluded.category_name, name=excluded.name,
               detail=excluded.detail, location_name=excluded.location_name,
               start_date=excluded.start_date,
               end_date_exclusive=excluded.end_date_exclusive,
               prediction_date=excluded.prediction_date,
               opened_expiry_date=excluded.opened_expiry_date,
               depletion_prediction_date=excluded.depletion_prediction_date,
               initial_unit_quantity=excluded.initial_unit_quantity,
               capacity_ml=excluded.capacity_ml,
               inventory_source_kind=excluded.inventory_source_kind,
               usage_rate_per_day=excluded.usage_rate_per_day,
               eye_sides_json=excluded.eye_sides_json,
               end_reason=excluded.end_reason,
               completion_usage_fact_id=excluded.completion_usage_fact_id,
               status=excluded.status",
            params![
                item.id,
                sequence,
                item.category_id,
                product_id,
                source_stock_lot_id,
                location_id,
                item.group_id,
                item.category_name,
                item.label,
                item.detail,
                item.location,
                item.start_date,
                item.end_date,
                item.prediction_date,
                item.opened_expiry_date,
                item.depletion_prediction_date,
                item.initial_unit_quantity,
                item.capacity_ml,
                item.inventory_source_kind,
                item.usage_rate_per_day,
                eye_sides_json.as_deref(),
                item.end_reason,
                item.completion_usage_fact_id,
                item.status,
            ],
        )
        .map_err(error_string)?;
    replace_timeline_item_children(transaction, item)
}

fn validate_timeline_item(
    transaction: &Transaction<'_>,
    item: &TimelineItem,
) -> Result<(), String> {
    if item.state_intervals.as_ref().is_none_or(Vec::is_empty) {
        return Err("使用实例缺少状态区间".into());
    }
    if item.location_intervals.as_ref().is_none_or(Vec::is_empty) {
        return Err("使用实例缺少地点区间".into());
    }
    let standard_type = transaction
        .query_row(
            "SELECT standard_type FROM item_profiles WHERE id=?1",
            [&item.category_id],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(error_string)?
        .ok_or_else(|| "使用实例引用的用品配置不存在".to_string())?;
    if standard_type == "lens_case"
        && item
            .eye_assignment_intervals
            .as_ref()
            .is_none_or(Vec::is_empty)
    {
        return Err("隐形眼镜盒实例缺少眼别区间".into());
    }
    Ok(())
}

fn replace_timeline_item_children(
    transaction: &Transaction<'_>,
    item: &TimelineItem,
) -> Result<(), String> {
    transaction
        .execute(
            "DELETE FROM instance_state_intervals WHERE instance_id=?1",
            [&item.id],
        )
        .map_err(error_string)?;
    transaction
        .execute(
            "DELETE FROM instance_location_intervals WHERE instance_id=?1",
            [&item.id],
        )
        .map_err(error_string)?;
    transaction
        .execute(
            "DELETE FROM instance_eye_assignment_intervals WHERE instance_id=?1",
            [&item.id],
        )
        .map_err(error_string)?;
    transaction
        .execute(
            "DELETE FROM reusable_lens_cycles WHERE instance_id=?1",
            [&item.id],
        )
        .map_err(error_string)?;

    for (sequence, interval) in item.state_intervals.iter().flatten().enumerate() {
        transaction
            .execute(
                "INSERT INTO instance_state_intervals
                 (instance_id, sequence, start_date, end_date_exclusive, state)
                 VALUES (?1, ?2, ?3, ?4, ?5)",
                params![
                    item.id,
                    sequence as i64,
                    interval.start_date,
                    interval.end_date,
                    interval.status
                ],
            )
            .map_err(error_string)?;
    }
    for (sequence, interval) in item.location_intervals.iter().flatten().enumerate() {
        transaction
            .execute(
                "INSERT INTO instance_location_intervals
                 (instance_id, sequence, location_id, start_date, end_date_exclusive)
                 VALUES (?1, ?2, ?3, ?4, ?5)",
                params![
                    item.id,
                    sequence as i64,
                    interval.location_id,
                    interval.start_date,
                    interval.end_date
                ],
            )
            .map_err(error_string)?;
    }
    for (sequence, interval) in item.eye_assignment_intervals.iter().flatten().enumerate() {
        let eye_sides_json = serde_json::to_string(&interval.eye_sides).map_err(error_string)?;
        transaction
            .execute(
                "INSERT INTO instance_eye_assignment_intervals
                 (instance_id, sequence, start_date, end_date_exclusive, eye_sides_json)
                 VALUES (?1, ?2, ?3, ?4, ?5)",
                params![
                    item.id,
                    sequence as i64,
                    interval.start_date,
                    interval.end_date,
                    eye_sides_json
                ],
            )
            .map_err(error_string)?;
    }
    for (sequence, cycle) in item.reusable_lens_cycles.iter().flatten().enumerate() {
        transaction
            .execute(
                "INSERT INTO reusable_lens_cycles
                 (id, instance_id, sequence, start_date, end_date_exclusive,
                  prediction_date, status, label, end_reason)
                  VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                params![
                    cycle.id,
                    item.id,
                    sequence as i64,
                    cycle.start_date,
                    cycle.end_date,
                    cycle.prediction_date,
                    cycle.status,
                    cycle.label,
                    cycle.end_reason,
                ],
            )
            .map_err(error_string)?;
    }
    Ok(())
}

fn write_usage_fact(transaction: &Transaction<'_>, fact: &UsageFact) -> Result<(), String> {
    let sequence = existing_or_next_sequence(transaction, "usage_facts", &fact.id)?;
    transaction
        .execute(
            "INSERT INTO usage_facts
             (id, sequence, item_id, stock_lot_id, transaction_id, occurred_date,
               fact_kind, quantity, reason)
              VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
             ON CONFLICT(id) DO UPDATE SET
               sequence=excluded.sequence, item_id=excluded.item_id,
               stock_lot_id=excluded.stock_lot_id,
               transaction_id=excluded.transaction_id,
               occurred_date=excluded.occurred_date, fact_kind=excluded.fact_kind,
               quantity=excluded.quantity, reason=excluded.reason",
            params![
                fact.id,
                sequence,
                fact.item_id,
                fact.stock_lot_id,
                fact.transaction_id,
                fact.date,
                fact.kind,
                fact.quantity,
                fact.reason,
            ],
        )
        .map_err(error_string)?;
    Ok(())
}

fn write_care_event(transaction: &Transaction<'_>, event: &LensCareEvent) -> Result<(), String> {
    let sequence = existing_or_next_sequence(transaction, "care_events", &event.id)?;
    transaction
        .execute(
            "INSERT INTO care_events
             (id, sequence, item_id, event_kind, planned_date, completed_date)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT(id) DO UPDATE SET
               sequence=excluded.sequence, item_id=excluded.item_id,
               event_kind=excluded.event_kind, planned_date=excluded.planned_date,
               completed_date=excluded.completed_date",
            params![
                event.id,
                sequence,
                event.item_id,
                event.kind,
                event.planned_date,
                event.completed_date,
            ],
        )
        .map_err(error_string)?;
    Ok(())
}

fn effective_stock_in(
    transaction: &Transaction<'_>,
    lot_id: &str,
) -> Result<Option<(String, String, i64, String)>, String> {
    transaction
        .query_row(
            "SELECT t.id, t.occurred_date, t.quantity_delta, COALESCE(t.location_id, l.location_id)
         FROM inventory_transactions t JOIN stock_lots l ON l.id=t.stock_lot_id
         WHERE t.stock_lot_id=?1 AND t.transaction_type='stock_in'
           AND NOT EXISTS(SELECT 1 FROM inventory_transactions r
                          WHERE r.transaction_type='reverse' AND r.reversed_transaction_id=t.id)
         ORDER BY t.sequence LIMIT 1",
            [lot_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .optional()
        .map_err(error_string)
}

fn effective_other_quantity(
    transaction: &Transaction<'_>,
    lot_id: &str,
    stock_in_id: &str,
) -> Result<i64, String> {
    transaction
        .query_row(
            "SELECT COALESCE(SUM(quantity_delta), 0) FROM inventory_transactions t
         WHERE stock_lot_id=?1 AND id!=?2 AND transaction_type!='reverse'
           AND NOT EXISTS(SELECT 1 FROM inventory_transactions r
                          WHERE r.transaction_type='reverse' AND r.reversed_transaction_id=t.id)",
            params![lot_id, stock_in_id],
            |row| row.get(0),
        )
        .map_err(error_string)
}

fn stock_in_reversal(
    id: &str,
    lot_id: &str,
    stock_in: &(String, String, i64, String),
) -> InventoryTransaction {
    InventoryTransaction {
        id: id.into(),
        stock_lot_id: lot_id.into(),
        occurred_date: stock_in.1.clone(),
        transaction_type: "reverse".into(),
        quantity_delta: -stock_in.2,
        related_instance_id: None,
        related_cycle_id: None,
        reversed_transaction_id: Some(stock_in.0.clone()),
        allocated_unit_quantity: None,
        location_id: None,
        from_location_id: None,
        to_location_id: None,
        transfer_quantity: None,
        reversible_with_instance: None,
        reason: Some("更正批次入库信息".into()),
    }
}

fn replacement_stock_in(id: &str, lot: &StockLot) -> InventoryTransaction {
    InventoryTransaction {
        id: id.into(),
        stock_lot_id: lot.id.clone(),
        occurred_date: lot.received_date.clone(),
        transaction_type: "stock_in".into(),
        quantity_delta: lot.initial_unit_quantity,
        related_instance_id: None,
        related_cycle_id: None,
        reversed_transaction_id: None,
        allocated_unit_quantity: None,
        location_id: Some(lot.location_id.clone()),
        from_location_id: None,
        to_location_id: None,
        transfer_quantity: None,
        reversible_with_instance: None,
        reason: None,
    }
}

fn ensure_nonnegative_location_balances(
    transaction: &Transaction<'_>,
    lot_id: &str,
) -> Result<(), String> {
    let mut statement = transaction
        .prepare("SELECT id FROM locations")
        .map_err(error_string)?;
    let ids = statement
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(error_string)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(error_string)?;
    drop(statement);
    for id in ids {
        if available_at_location(transaction, lot_id, &id)? < 0 {
            return Err("更正入库地点后会使后续库存流水出现负数".into());
        }
    }
    Ok(())
}

fn next_sequence(connection: &Connection, table: &str) -> Result<i64, String> {
    if !matches!(table, "item_profiles" | "products" | "locations") {
        return Err("不支持的排序表".into());
    }
    connection
        .query_row(
            &format!("SELECT COALESCE(MAX(sequence), -1) + 1 FROM {table}"),
            [],
            |row| row.get(0),
        )
        .map_err(error_string)
}

fn delete_one(
    connection: &Mutex<Connection>,
    table: &str,
    id: &str,
    missing_message: &str,
) -> Result<(), String> {
    if !matches!(table, "item_profiles" | "products") {
        return Err("不支持的删除表".into());
    }
    let connection = connection.lock().map_err(error_string)?;
    let changed = connection
        .execute(&format!("DELETE FROM {table} WHERE id = ?1"), [id])
        .map_err(error_string)?;
    if changed == 0 {
        return Err(missing_message.into());
    }
    Ok(())
}

fn write_product(
    connection: &Connection,
    product: &Product,
    sequence: Option<i64>,
    create: bool,
) -> Result<(), String> {
    let changed = if create {
        connection.execute(
            "INSERT INTO products
             (id, sequence, item_profile_id, standard_type, brand, model,
              specification, base_unit, units_per_package, capacity_ml,
               default_duration_days, sort_order, is_active)
              VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
            params![
                product.id,
                sequence.unwrap_or_default(),
                product.item_profile_id,
                product.standard_type,
                product.brand,
                product.model,
                product.specification,
                product.base_unit,
                product.units_per_package,
                product.capacity_ml,
                product.default_duration_days,
                product.sort_order,
                i64::from(product.active),
            ],
        )
    } else {
        connection.execute(
            "UPDATE products SET item_profile_id=?2, standard_type=?3, brand=?4,
                    model=?5, specification=?6, base_unit=?7, units_per_package=?8,
                    capacity_ml=?9, default_duration_days=?10, sort_order=?11,
                    is_active=?12 WHERE id=?1",
            params![
                product.id,
                product.item_profile_id,
                product.standard_type,
                product.brand,
                product.model,
                product.specification,
                product.base_unit,
                product.units_per_package,
                product.capacity_ml,
                product.default_duration_days,
                product.sort_order,
                i64::from(product.active),
            ],
        )
    }
    .map_err(error_string)?;
    if changed == 0 {
        return Err("产品不存在".into());
    }
    Ok(())
}

fn apply_migrations(connection: &mut Connection) -> Result<(), String> {
    let existing_user_tables = connection
        .query_row(
            "SELECT count(*) FROM sqlite_master
              WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
            [],
            |row| row.get::<_, i64>(0),
        )
        .map_err(error_string)?;
    if existing_user_tables > 0 {
        let generation = connection
            .query_row(
                "SELECT value FROM app_metadata WHERE key = 'schema_generation'",
                [],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(|_| {
                "数据库格式不受支持：仅支持当前未发布的干净基线，请使用当前格式备份恢复".to_string()
            })?;
        let versions = connection
            .prepare("SELECT version FROM schema_migrations ORDER BY version")
            .and_then(|mut statement| {
                statement
                    .query_map([], |row| row.get::<_, i64>(0))?
                    .collect::<rusqlite::Result<Vec<_>>>()
            })
            .map_err(|_| "数据库缺少有效的 schema_migrations 版本表".to_string())?;
        let supported = matches!(
            (generation.as_deref(), versions.as_slice()),
            (Some("current-1"), [1]) | (Some(CURRENT_SCHEMA_GENERATION), [1, 2])
        );
        if !supported {
            return Err(format!(
                "数据库格式不受支持：需要可升级的 current-1/[1] 或 {CURRENT_SCHEMA_GENERATION}/[1, 2]，实际为 {:?}、版本 {:?}",
                generation, versions
            ));
        }
        if generation.as_deref() == Some(CURRENT_SCHEMA_GENERATION) {
            return Ok(());
        }
    }
    connection
        .execute_batch(
            "CREATE TABLE IF NOT EXISTS schema_migrations (
               version INTEGER PRIMARY KEY,
               applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
             );",
        )
        .map_err(error_string)?;
    for (version, sql) in MIGRATIONS {
        let applied = connection
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE version = ?1)",
                [version],
                |row| row.get::<_, bool>(0),
            )
            .map_err(error_string)?;
        if applied {
            continue;
        }
        if *version == 2 {
            connection
                .execute_batch("PRAGMA foreign_keys = OFF;")
                .map_err(error_string)?;
        }
        let transaction = connection.transaction().map_err(error_string)?;
        transaction.execute_batch(sql).map_err(error_string)?;
        let recorded = transaction
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE version = ?1)",
                [version],
                |row| row.get::<_, bool>(0),
            )
            .map_err(error_string)?;
        if !recorded {
            transaction
                .execute(
                    "INSERT INTO schema_migrations(version) VALUES (?1)",
                    [version],
                )
                .map_err(error_string)?;
        }
        transaction.commit().map_err(error_string)?;
        if *version == 2 {
            connection
                .execute_batch("PRAGMA foreign_keys = ON;")
                .map_err(error_string)?;
            let foreign_key_errors = connection
                .query_row("SELECT COUNT(*) FROM pragma_foreign_key_check", [], |row| {
                    row.get::<_, i64>(0)
                })
                .map_err(error_string)?;
            if foreign_key_errors != 0 {
                return Err("价格精度迁移后外键检查失败".into());
            }
        }
    }
    Ok(())
}

fn error_string(error: impl std::fmt::Display) -> String {
    error.to_string()
}

fn required_str<'a>(value: &'a Value, key: &str) -> Result<&'a str, String> {
    value
        .get(key)
        .and_then(Value::as_str)
        .ok_or_else(|| format!("missing string field: {key}"))
}

fn optional_str<'a>(value: &'a Value, key: &str) -> Option<&'a str> {
    value.get(key).and_then(Value::as_str)
}

fn required_i64(value: &Value, key: &str) -> Result<i64, String> {
    value
        .get(key)
        .and_then(Value::as_i64)
        .ok_or_else(|| format!("missing integer field: {key}"))
}

fn optional_i64(value: &Value, key: &str) -> Option<i64> {
    value.get(key).and_then(Value::as_i64)
}

fn optional_f64(value: &Value, key: &str) -> Option<f64> {
    value.get(key).and_then(Value::as_f64)
}

fn optional_bool(value: &Value, key: &str) -> Option<bool> {
    value.get(key).and_then(Value::as_bool)
}

fn required_bool(value: &Value, key: &str) -> Result<i64, String> {
    value
        .get(key)
        .and_then(Value::as_bool)
        .map(|value| if value { 1 } else { 0 })
        .ok_or_else(|| format!("missing boolean field: {key}"))
}

fn json_text(value: &Value) -> String {
    serde_json::to_string(value).expect("serializing serde_json::Value cannot fail")
}

fn insert_profiles(transaction: &Transaction<'_>, values: &[Value]) -> Result<(), String> {
    let mut statement = transaction
        .prepare(
            "INSERT INTO item_profiles
             (id, sequence, group_id, management_template, standard_type,
              standard_type_name, name, base_unit, side, default_duration_days,
               is_active, sort_order)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
             ON CONFLICT(id) DO UPDATE SET
               sequence=excluded.sequence, group_id=excluded.group_id,
               management_template=excluded.management_template,
               standard_type=excluded.standard_type,
               standard_type_name=excluded.standard_type_name,
               name=excluded.name, base_unit=excluded.base_unit, side=excluded.side,
               default_duration_days=excluded.default_duration_days,
               is_active=excluded.is_active, sort_order=excluded.sort_order",
        )
        .map_err(error_string)?;
    for (sequence, value) in values.iter().enumerate() {
        statement
            .execute(params![
                required_str(value, "id")?,
                sequence as i64,
                required_str(value, "groupId")?,
                required_str(value, "managementTemplate")?,
                required_str(value, "standardType")?,
                optional_str(value, "standardTypeName"),
                required_str(value, "name")?,
                required_str(value, "baseUnit")?,
                optional_str(value, "side"),
                optional_i64(value, "defaultDurationDays"),
                required_bool(value, "active")?,
                required_i64(value, "order")?,
            ])
            .map_err(error_string)?;
    }
    Ok(())
}

fn insert_locations(transaction: &Transaction<'_>, values: &[Value]) -> Result<(), String> {
    let mut statement = transaction
        .prepare(
            "INSERT INTO locations(id, sequence, name, note, is_active, sort_order)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT(id) DO UPDATE SET
               sequence=excluded.sequence, name=excluded.name, note=excluded.note,
               is_active=excluded.is_active, sort_order=excluded.sort_order",
        )
        .map_err(error_string)?;
    for (sequence, value) in values.iter().enumerate() {
        statement
            .execute(params![
                required_str(value, "id")?,
                sequence as i64,
                required_str(value, "name")?,
                optional_str(value, "note"),
                required_bool(value, "active")?,
                required_i64(value, "order")?,
            ])
            .map_err(error_string)?;
    }
    Ok(())
}

fn insert_products(transaction: &Transaction<'_>, values: &[Value]) -> Result<(), String> {
    let mut statement = transaction
        .prepare(
            "INSERT INTO products
             (id, sequence, item_profile_id, standard_type, brand, model,
              specification, base_unit, units_per_package, capacity_ml,
               default_duration_days, sort_order, is_active)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)
             ON CONFLICT(id) DO UPDATE SET
               sequence=excluded.sequence, item_profile_id=excluded.item_profile_id,
               standard_type=excluded.standard_type, brand=excluded.brand,
               model=excluded.model, specification=excluded.specification,
               base_unit=excluded.base_unit, units_per_package=excluded.units_per_package,
               capacity_ml=excluded.capacity_ml,
               default_duration_days=excluded.default_duration_days,
               sort_order=excluded.sort_order,
               is_active=excluded.is_active",
        )
        .map_err(error_string)?;
    for (sequence, value) in values.iter().enumerate() {
        statement
            .execute(params![
                required_str(value, "id")?,
                sequence as i64,
                required_str(value, "itemProfileId")?,
                required_str(value, "standardType")?,
                required_str(value, "brand")?,
                optional_str(value, "model"),
                optional_str(value, "specification"),
                required_str(value, "baseUnit")?,
                required_i64(value, "unitsPerPackage")?,
                optional_f64(value, "capacityMl"),
                optional_i64(value, "defaultDurationDays"),
                optional_i64(value, "sortOrder"),
                required_bool(value, "active")?,
            ])
            .map_err(error_string)?;
    }
    Ok(())
}

fn insert_lots(transaction: &Transaction<'_>, values: &[Value]) -> Result<(), String> {
    let mut statement = transaction
        .prepare(
            "INSERT INTO stock_lots
             (id, sequence, product_id, location_id, internal_lot_code, lot_number, received_date,
              manufactured_date, expiry_date, expected_usage_days, initial_unit_quantity,
              initial_package_quantity, initial_loose_unit_quantity,
               units_per_package_at_receipt, unit_price_minor, currency, voided_at,
               voided_by_transaction_id)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18)
             ON CONFLICT(id) DO UPDATE SET
               sequence=excluded.sequence, product_id=excluded.product_id,
               location_id=excluded.location_id, internal_lot_code=excluded.internal_lot_code,
               lot_number=excluded.lot_number, received_date=excluded.received_date,
               manufactured_date=excluded.manufactured_date, expiry_date=excluded.expiry_date,
               expected_usage_days=excluded.expected_usage_days,
               initial_unit_quantity=excluded.initial_unit_quantity,
               initial_package_quantity=excluded.initial_package_quantity,
               initial_loose_unit_quantity=excluded.initial_loose_unit_quantity,
               units_per_package_at_receipt=excluded.units_per_package_at_receipt,
               unit_price_minor=excluded.unit_price_minor, currency=excluded.currency,
               voided_at=excluded.voided_at,
               voided_by_transaction_id=excluded.voided_by_transaction_id",
        )
        .map_err(error_string)?;
    for (sequence, value) in values.iter().enumerate() {
        statement
            .execute(params![
                required_str(value, "id")?,
                sequence as i64,
                required_str(value, "productId")?,
                required_str(value, "locationId")?,
                required_str(value, "internalLotCode")?,
                optional_str(value, "lotNumber"),
                required_str(value, "receivedDate")?,
                optional_str(value, "manufacturedDate"),
                optional_str(value, "expiryDate"),
                optional_i64(value, "expectedUsageDays"),
                required_i64(value, "initialUnitQuantity")?,
                optional_i64(value, "initialPackageQuantity"),
                optional_i64(value, "initialLooseUnitQuantity"),
                optional_i64(value, "unitsPerPackageAtReceipt"),
                required_i64(value, "unitPriceMinor")?,
                required_str(value, "currency")?,
                optional_str(value, "voidedAt"),
                optional_str(value, "voidedByTransactionId"),
            ])
            .map_err(error_string)?;
    }
    Ok(())
}

fn insert_items(transaction: &Transaction<'_>, values: &[Value]) -> Result<(), String> {
    let mut statement = transaction
        .prepare(
            "INSERT INTO usage_instances
             (id, sequence, profile_id, product_id, source_stock_lot_id, location_id,
              group_id, category_name, name, detail, location_name, start_date,
              end_date_exclusive, prediction_date, opened_expiry_date,
              depletion_prediction_date, initial_unit_quantity, capacity_ml,
              inventory_source_kind, usage_rate_per_day, eye_sides_json,
               end_reason, completion_usage_fact_id, status)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13,
                     ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24)
             ON CONFLICT(id) DO UPDATE SET
               sequence=excluded.sequence, profile_id=excluded.profile_id,
               product_id=excluded.product_id, source_stock_lot_id=excluded.source_stock_lot_id,
               location_id=excluded.location_id, group_id=excluded.group_id,
               category_name=excluded.category_name, name=excluded.name,
               detail=excluded.detail, location_name=excluded.location_name,
               start_date=excluded.start_date,
               end_date_exclusive=excluded.end_date_exclusive,
               prediction_date=excluded.prediction_date,
               opened_expiry_date=excluded.opened_expiry_date,
               depletion_prediction_date=excluded.depletion_prediction_date,
               initial_unit_quantity=excluded.initial_unit_quantity,
               capacity_ml=excluded.capacity_ml,
               inventory_source_kind=excluded.inventory_source_kind,
               usage_rate_per_day=excluded.usage_rate_per_day,
               eye_sides_json=excluded.eye_sides_json,
               end_reason=excluded.end_reason,
               completion_usage_fact_id=excluded.completion_usage_fact_id,
               status=excluded.status",
        )
        .map_err(error_string)?;
    for (sequence, value) in values.iter().enumerate() {
        let instance_id = required_str(value, "id")?;
        validate_snapshot_item(transaction, value)?;
        let eye_sides_json = value.get("eyeSides").map(json_text);
        statement
            .execute(params![
                instance_id,
                sequence as i64,
                required_str(value, "categoryId")?,
                required_str(value, "productId")?,
                required_str(value, "sourceStockLotId")?,
                required_str(value, "locationId")?,
                required_str(value, "groupId")?,
                required_str(value, "categoryName")?,
                required_str(value, "label")?,
                required_str(value, "detail")?,
                required_str(value, "location")?,
                required_str(value, "startDate")?,
                optional_str(value, "endDate"),
                optional_str(value, "predictionDate"),
                optional_str(value, "openedExpiryDate"),
                optional_str(value, "depletionPredictionDate"),
                optional_i64(value, "initialUnitQuantity"),
                optional_f64(value, "capacityMl"),
                optional_str(value, "inventorySourceKind"),
                optional_f64(value, "usageRatePerDay"),
                eye_sides_json.as_deref(),
                optional_str(value, "endReason"),
                optional_str(value, "completionUsageFactId"),
                required_str(value, "status")?,
            ])
            .map_err(error_string)?;
        insert_state_intervals(transaction, instance_id, value)?;
        insert_location_intervals(transaction, instance_id, value)?;
        insert_eye_assignment_intervals(transaction, instance_id, value)?;
        insert_reusable_cycles(transaction, instance_id, value)?;
    }
    Ok(())
}

fn required_non_empty_array<'a>(value: &'a Value, field: &str) -> Result<&'a Vec<Value>, String> {
    value
        .get(field)
        .and_then(Value::as_array)
        .filter(|values| !values.is_empty())
        .ok_or_else(|| format!("字段 {field} 必须是非空数组"))
}

fn validate_snapshot_item(transaction: &Transaction<'_>, item: &Value) -> Result<(), String> {
    required_non_empty_array(item, "stateIntervals")?;
    required_non_empty_array(item, "locationIntervals")?;
    let profile_id = required_str(item, "categoryId")?;
    let standard_type = transaction
        .query_row(
            "SELECT standard_type FROM item_profiles WHERE id=?1",
            [profile_id],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(error_string)?
        .ok_or_else(|| "使用实例引用的用品配置不存在".to_string())?;
    if standard_type == "lens_case" {
        required_non_empty_array(item, "eyeAssignmentIntervals")?;
    }
    Ok(())
}

fn insert_state_intervals(
    transaction: &Transaction<'_>,
    instance_id: &str,
    item: &Value,
) -> Result<(), String> {
    let intervals = required_non_empty_array(item, "stateIntervals")?;
    let mut statement = transaction
        .prepare(
            "INSERT INTO instance_state_intervals
             (instance_id, sequence, start_date, end_date_exclusive, state)
             VALUES (?1, ?2, ?3, ?4, ?5)",
        )
        .map_err(error_string)?;
    for (sequence, interval) in intervals.iter().enumerate() {
        statement
            .execute(params![
                instance_id,
                sequence as i64,
                required_str(interval, "startDate")?,
                optional_str(interval, "endDate"),
                required_str(interval, "status")?
            ])
            .map_err(error_string)?;
    }
    Ok(())
}

fn insert_location_intervals(
    transaction: &Transaction<'_>,
    instance_id: &str,
    item: &Value,
) -> Result<(), String> {
    let intervals = required_non_empty_array(item, "locationIntervals")?;
    let mut statement = transaction
        .prepare(
            "INSERT INTO instance_location_intervals
             (instance_id, sequence, location_id, start_date, end_date_exclusive)
             VALUES (?1, ?2, ?3, ?4, ?5)",
        )
        .map_err(error_string)?;
    for (sequence, interval) in intervals.iter().enumerate() {
        statement
            .execute(params![
                instance_id,
                sequence as i64,
                required_str(interval, "locationId")?,
                required_str(interval, "startDate")?,
                optional_str(interval, "endDate")
            ])
            .map_err(error_string)?;
    }
    Ok(())
}

fn insert_eye_assignment_intervals(
    transaction: &Transaction<'_>,
    instance_id: &str,
    item: &Value,
) -> Result<(), String> {
    let Some(intervals) = item.get("eyeAssignmentIntervals").and_then(Value::as_array) else {
        return Ok(());
    };
    let mut statement = transaction
        .prepare(
            "INSERT INTO instance_eye_assignment_intervals
             (instance_id, sequence, start_date, end_date_exclusive, eye_sides_json)
             VALUES (?1, ?2, ?3, ?4, ?5)",
        )
        .map_err(error_string)?;
    for (sequence, interval) in intervals.iter().enumerate() {
        statement
            .execute(params![
                instance_id,
                sequence as i64,
                required_str(interval, "startDate")?,
                optional_str(interval, "endDate"),
                interval
                    .get("eyeSides")
                    .map(json_text)
                    .ok_or_else(|| "missing array field: eyeSides".to_string())?
            ])
            .map_err(error_string)?;
    }
    Ok(())
}

fn insert_reusable_cycles(
    transaction: &Transaction<'_>,
    instance_id: &str,
    item: &Value,
) -> Result<(), String> {
    let Some(cycles) = item.get("reusableLensCycles").and_then(Value::as_array) else {
        return Ok(());
    };
    let mut statement = transaction
        .prepare(
            "INSERT INTO reusable_lens_cycles
             (id, instance_id, sequence, start_date, end_date_exclusive,
               prediction_date, status, label, end_reason)
              VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        )
        .map_err(error_string)?;
    for (sequence, cycle) in cycles.iter().enumerate() {
        statement
            .execute(params![
                required_str(cycle, "id")?,
                instance_id,
                sequence as i64,
                required_str(cycle, "startDate")?,
                optional_str(cycle, "endDate"),
                required_str(cycle, "predictionDate")?,
                required_str(cycle, "status")?,
                required_str(cycle, "label")?,
                optional_str(cycle, "endReason"),
            ])
            .map_err(error_string)?;
    }
    Ok(())
}

fn insert_transactions(transaction: &Transaction<'_>, values: &[Value]) -> Result<(), String> {
    let mut statement = transaction
        .prepare(
            "INSERT INTO inventory_transactions
             (id, sequence, stock_lot_id, occurred_date, transaction_type,
              quantity_delta, related_instance_id, related_cycle_id, reversed_transaction_id,
              allocated_unit_quantity, location_id, from_location_id, to_location_id,
               transfer_quantity, reversible_with_instance, reason)
              VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)",
        )
        .map_err(error_string)?;
    for (sequence, value) in values.iter().enumerate() {
        statement
            .execute(params![
                required_str(value, "id")?,
                sequence as i64,
                required_str(value, "stockLotId")?,
                required_str(value, "occurredDate")?,
                required_str(value, "type")?,
                required_i64(value, "quantityDelta")?,
                optional_str(value, "relatedInstanceId"),
                optional_str(value, "relatedCycleId"),
                optional_str(value, "reversedTransactionId"),
                optional_i64(value, "allocatedUnitQuantity"),
                optional_str(value, "locationId"),
                optional_str(value, "fromLocationId"),
                optional_str(value, "toLocationId"),
                optional_i64(value, "transferQuantity"),
                optional_bool(value, "reversibleWithInstance").map(i64::from),
                optional_str(value, "reason"),
            ])
            .map_err(error_string)?;
    }
    Ok(())
}

fn insert_usage_facts(transaction: &Transaction<'_>, values: &[Value]) -> Result<(), String> {
    let mut statement = transaction
        .prepare(
            "INSERT INTO usage_facts
             (id, sequence, item_id, stock_lot_id, transaction_id, occurred_date,
               fact_kind, quantity, reason)
              VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
             ON CONFLICT(id) DO UPDATE SET
               sequence=excluded.sequence, item_id=excluded.item_id,
               stock_lot_id=excluded.stock_lot_id,
               transaction_id=excluded.transaction_id,
               occurred_date=excluded.occurred_date, fact_kind=excluded.fact_kind,
               quantity=excluded.quantity, reason=excluded.reason",
        )
        .map_err(error_string)?;
    for (sequence, value) in values.iter().enumerate() {
        statement
            .execute(params![
                required_str(value, "id")?,
                sequence as i64,
                required_str(value, "itemId")?,
                required_str(value, "stockLotId")?,
                required_str(value, "transactionId")?,
                required_str(value, "date")?,
                required_str(value, "kind")?,
                required_i64(value, "quantity")?,
                optional_str(value, "reason"),
            ])
            .map_err(error_string)?;
    }
    Ok(())
}

fn insert_care_events(transaction: &Transaction<'_>, values: &[Value]) -> Result<(), String> {
    let mut statement = transaction
        .prepare(
            "INSERT INTO care_events
             (id, sequence, item_id, event_kind, planned_date, completed_date)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT(id) DO UPDATE SET
               sequence=excluded.sequence, item_id=excluded.item_id,
               event_kind=excluded.event_kind, planned_date=excluded.planned_date,
               completed_date=excluded.completed_date",
        )
        .map_err(error_string)?;
    for (sequence, value) in values.iter().enumerate() {
        statement
            .execute(params![
                required_str(value, "id")?,
                sequence as i64,
                required_str(value, "itemId")?,
                required_str(value, "kind")?,
                optional_str(value, "plannedDate"),
                optional_str(value, "completedDate"),
            ])
            .map_err(error_string)?;
    }
    Ok(())
}

fn insert_optional<T: Serialize>(
    object: &mut serde_json::Map<String, Value>,
    key: &str,
    value: Option<T>,
) {
    if let Some(value) = value {
        object.insert(key.to_string(), serde_json::to_value(value).unwrap());
    }
}

fn load_profiles(connection: &Connection) -> Result<Vec<Value>, String> {
    let mut statement = connection
        .prepare(
            "SELECT id, group_id, management_template, standard_type,
                standard_type_name, name, base_unit, side,
                default_duration_days, is_active, sort_order
         FROM item_profiles ORDER BY sequence",
        )
        .map_err(error_string)?;
    let rows = statement
        .query_map([], |row| {
            let mut value = serde_json::Map::new();
            value.insert("id".into(), Value::String(row.get(0)?));
            value.insert("groupId".into(), Value::String(row.get(1)?));
            value.insert("managementTemplate".into(), Value::String(row.get(2)?));
            value.insert("standardType".into(), Value::String(row.get(3)?));
            insert_optional(
                &mut value,
                "standardTypeName",
                row.get::<_, Option<String>>(4)?,
            );
            value.insert("name".into(), Value::String(row.get(5)?));
            value.insert("baseUnit".into(), Value::String(row.get(6)?));
            insert_optional(&mut value, "side", row.get::<_, Option<String>>(7)?);
            insert_optional(
                &mut value,
                "defaultDurationDays",
                row.get::<_, Option<i64>>(8)?,
            );
            value.insert("active".into(), Value::Bool(row.get::<_, i64>(9)? != 0));
            value.insert("order".into(), Value::from(row.get::<_, i64>(10)?));
            Ok(Value::Object(value))
        })
        .map_err(error_string)?;
    rows.map(|row| row.map_err(error_string)).collect()
}

fn load_products(connection: &Connection) -> Result<Vec<Value>, String> {
    let mut statement = connection
        .prepare(
            "SELECT id, item_profile_id, standard_type, brand, model,
                specification, capacity_ml, base_unit, units_per_package,
                default_duration_days, sort_order, is_active
         FROM products ORDER BY sequence",
        )
        .map_err(error_string)?;
    let rows = statement
        .query_map([], |row| {
            let mut value = serde_json::Map::new();
            value.insert("id".into(), Value::String(row.get(0)?));
            value.insert("itemProfileId".into(), Value::String(row.get(1)?));
            value.insert("standardType".into(), Value::String(row.get(2)?));
            value.insert("brand".into(), Value::String(row.get(3)?));
            insert_optional(&mut value, "model", row.get::<_, Option<String>>(4)?);
            insert_optional(
                &mut value,
                "specification",
                row.get::<_, Option<String>>(5)?,
            );
            insert_optional(&mut value, "capacityMl", row.get::<_, Option<f64>>(6)?);
            value.insert("baseUnit".into(), Value::String(row.get(7)?));
            value.insert("unitsPerPackage".into(), Value::from(row.get::<_, i64>(8)?));
            insert_optional(
                &mut value,
                "defaultDurationDays",
                row.get::<_, Option<i64>>(9)?,
            );
            insert_optional(&mut value, "sortOrder", row.get::<_, Option<i64>>(10)?);
            value.insert("active".into(), Value::Bool(row.get::<_, i64>(11)? != 0));
            Ok(Value::Object(value))
        })
        .map_err(error_string)?;
    rows.map(|row| row.map_err(error_string)).collect()
}

fn load_locations(connection: &Connection) -> Result<Vec<Value>, String> {
    let mut statement = connection
        .prepare("SELECT id, name, note, is_active, sort_order FROM locations ORDER BY sequence")
        .map_err(error_string)?;
    let rows = statement
        .query_map([], |row| {
            let mut value = serde_json::Map::new();
            value.insert("id".into(), Value::String(row.get(0)?));
            value.insert("name".into(), Value::String(row.get(1)?));
            insert_optional(&mut value, "note", row.get::<_, Option<String>>(2)?);
            value.insert("active".into(), Value::Bool(row.get::<_, i64>(3)? != 0));
            value.insert("order".into(), Value::from(row.get::<_, i64>(4)?));
            Ok(Value::Object(value))
        })
        .map_err(error_string)?;
    rows.map(|row| row.map_err(error_string)).collect()
}

fn load_lots(connection: &Connection) -> Result<Vec<Value>, String> {
    let mut statement = connection
        .prepare(
            "SELECT id, product_id, internal_lot_code, lot_number, manufactured_date,
                expiry_date, expected_usage_days, received_date, location_id,
                initial_unit_quantity, initial_package_quantity, initial_loose_unit_quantity,
                units_per_package_at_receipt, unit_price_minor, currency, voided_at,
                voided_by_transaction_id
         FROM stock_lots ORDER BY sequence",
        )
        .map_err(error_string)?;
    let rows = statement
        .query_map([], |row| {
            Ok(StockLot {
                id: row.get(0)?,
                product_id: row.get(1)?,
                internal_lot_code: row.get(2)?,
                lot_number: row.get(3)?,
                manufactured_date: row.get(4)?,
                expiry_date: row.get(5)?,
                expected_usage_days: row.get(6)?,
                received_date: row.get(7)?,
                location_id: row.get(8)?,
                initial_unit_quantity: row.get(9)?,
                initial_package_quantity: row.get(10)?,
                initial_loose_unit_quantity: row.get(11)?,
                units_per_package_at_receipt: row.get(12)?,
                unit_price_minor: row.get(13)?,
                currency: row.get(14)?,
                voided_at: row.get(15)?,
                voided_by_transaction_id: row.get(16)?,
            })
        })
        .map_err(error_string)?;
    rows.map(|row| serde_json::to_value(row.map_err(error_string)?).map_err(error_string))
        .collect()
}

fn load_transactions(connection: &Connection) -> Result<Vec<Value>, String> {
    let mut statement = connection
        .prepare(
            "SELECT id, stock_lot_id, occurred_date, transaction_type, quantity_delta,
                related_instance_id, related_cycle_id, reversed_transaction_id,
                allocated_unit_quantity, location_id, from_location_id, to_location_id,
                transfer_quantity, reversible_with_instance, reason
         FROM inventory_transactions ORDER BY sequence",
        )
        .map_err(error_string)?;
    let rows = statement
        .query_map([], |row| {
            Ok(InventoryTransaction {
                id: row.get(0)?,
                stock_lot_id: row.get(1)?,
                occurred_date: row.get(2)?,
                transaction_type: row.get(3)?,
                quantity_delta: row.get(4)?,
                related_instance_id: row.get(5)?,
                related_cycle_id: row.get(6)?,
                reversed_transaction_id: row.get(7)?,
                allocated_unit_quantity: row.get(8)?,
                location_id: row.get(9)?,
                from_location_id: row.get(10)?,
                to_location_id: row.get(11)?,
                transfer_quantity: row.get(12)?,
                reversible_with_instance: row.get::<_, Option<i64>>(13)?.map(|value| value != 0),
                reason: row.get(14)?,
            })
        })
        .map_err(error_string)?;
    rows.map(|row| serde_json::to_value(row.map_err(error_string)?).map_err(error_string))
        .collect()
}

fn load_items(connection: &Connection) -> Result<Vec<Value>, String> {
    struct TimelineItemRow {
        id: String,
        category_id: String,
        product_id: String,
        source_stock_lot_id: String,
        location_id: String,
        group_id: String,
        category_name: String,
        label: String,
        detail: String,
        location: String,
        start_date: String,
        end_date: Option<String>,
        prediction_date: Option<String>,
        opened_expiry_date: Option<String>,
        depletion_prediction_date: Option<String>,
        initial_unit_quantity: Option<i64>,
        capacity_ml: Option<f64>,
        inventory_source_kind: Option<String>,
        usage_rate_per_day: Option<f64>,
        eye_sides_json: Option<String>,
        end_reason: Option<String>,
        completion_usage_fact_id: Option<String>,
        status: String,
    }

    let mut statement = connection
        .prepare(
            "SELECT id, profile_id, product_id, source_stock_lot_id, location_id,
                group_id, category_name, name, detail, location_name, start_date,
                end_date_exclusive, prediction_date, opened_expiry_date,
                depletion_prediction_date, initial_unit_quantity, capacity_ml,
                inventory_source_kind, usage_rate_per_day, eye_sides_json,
                end_reason, completion_usage_fact_id, status
         FROM usage_instances ORDER BY sequence",
        )
        .map_err(error_string)?;
    let rows = statement
        .query_map([], |row| {
            Ok(TimelineItemRow {
                id: row.get(0)?,
                category_id: row.get(1)?,
                product_id: row.get(2)?,
                source_stock_lot_id: row.get(3)?,
                location_id: row.get(4)?,
                group_id: row.get(5)?,
                category_name: row.get(6)?,
                label: row.get(7)?,
                detail: row.get(8)?,
                location: row.get(9)?,
                start_date: row.get(10)?,
                end_date: row.get(11)?,
                prediction_date: row.get(12)?,
                opened_expiry_date: row.get(13)?,
                depletion_prediction_date: row.get(14)?,
                initial_unit_quantity: row.get(15)?,
                capacity_ml: row.get(16)?,
                inventory_source_kind: row.get(17)?,
                usage_rate_per_day: row.get(18)?,
                eye_sides_json: row.get(19)?,
                end_reason: row.get(20)?,
                completion_usage_fact_id: row.get(21)?,
                status: row.get(22)?,
            })
        })
        .map_err(error_string)?;
    let rows = rows
        .map(|row| row.map_err(error_string))
        .collect::<Result<Vec<_>, _>>()?;
    drop(statement);

    rows.into_iter()
        .map(|row| {
            let eye_assignment_intervals = load_eye_assignment_intervals(connection, &row.id)?;
            let eye_sides = parse_optional_string_vec(row.eye_sides_json)?;
            let item = TimelineItem {
                id: row.id.clone(),
                category_id: row.category_id.clone(),
                group_id: row.group_id,
                category_name: row.category_name,
                product_id: Some(row.product_id),
                source_stock_lot_id: Some(row.source_stock_lot_id),
                label: row.label,
                detail: row.detail,
                location: row.location,
                location_id: Some(row.location_id),
                location_intervals: non_empty(load_location_intervals(connection, &row.id)?),
                start_date: row.start_date,
                end_date: row.end_date,
                prediction_date: row.prediction_date,
                opened_expiry_date: row.opened_expiry_date,
                depletion_prediction_date: row.depletion_prediction_date,
                initial_unit_quantity: row.initial_unit_quantity,
                capacity_ml: row.capacity_ml,
                inventory_source_kind: row.inventory_source_kind,
                reusable_lens_cycles: non_empty(load_reusable_lens_cycles(connection, &row.id)?),
                usage_rate_per_day: row.usage_rate_per_day,
                eye_sides,
                eye_assignment_intervals: non_empty(eye_assignment_intervals),
                end_reason: row.end_reason,
                completion_usage_fact_id: row.completion_usage_fact_id,
                status: row.status,
                state_intervals: non_empty(load_state_intervals(connection, &row.id)?),
            };
            serde_json::to_value(item).map_err(error_string)
        })
        .collect()
}

fn load_state_intervals(
    connection: &Connection,
    instance_id: &str,
) -> Result<Vec<TimelineStateInterval>, String> {
    let mut statement = connection
        .prepare(
            "SELECT start_date, end_date_exclusive, state
         FROM instance_state_intervals
         WHERE instance_id=?1 ORDER BY sequence",
        )
        .map_err(error_string)?;
    let rows = statement
        .query_map([instance_id], |row| {
            Ok(TimelineStateInterval {
                start_date: row.get(0)?,
                end_date: row.get(1)?,
                status: row.get(2)?,
            })
        })
        .map_err(error_string)?;
    rows.map(|row| row.map_err(error_string)).collect()
}

fn load_location_intervals(
    connection: &Connection,
    instance_id: &str,
) -> Result<Vec<TimelineLocationInterval>, String> {
    let mut statement = connection
        .prepare(
            "SELECT location_id, start_date, end_date_exclusive
         FROM instance_location_intervals
         WHERE instance_id=?1 ORDER BY sequence",
        )
        .map_err(error_string)?;
    let rows = statement
        .query_map([instance_id], |row| {
            Ok(TimelineLocationInterval {
                location_id: row.get(0)?,
                start_date: row.get(1)?,
                end_date: row.get(2)?,
            })
        })
        .map_err(error_string)?;
    rows.map(|row| row.map_err(error_string)).collect()
}

fn load_reusable_lens_cycles(
    connection: &Connection,
    instance_id: &str,
) -> Result<Vec<ReusableLensCycle>, String> {
    let mut statement = connection
        .prepare(
            "SELECT id, label, start_date, end_date_exclusive, prediction_date,
                status, end_reason
         FROM reusable_lens_cycles
         WHERE instance_id=?1 ORDER BY sequence",
        )
        .map_err(error_string)?;
    let rows = statement
        .query_map([instance_id], |row| {
            let id: String = row.get(0)?;
            Ok(ReusableLensCycle {
                label: row
                    .get::<_, Option<String>>(1)?
                    .unwrap_or_else(|| id.clone()),
                id,
                start_date: row.get(2)?,
                end_date: row.get(3)?,
                prediction_date: row.get(4)?,
                status: row.get(5)?,
                end_reason: row.get(6)?,
            })
        })
        .map_err(error_string)?;
    rows.map(|row| row.map_err(error_string)).collect()
}

fn load_eye_assignment_intervals(
    connection: &Connection,
    instance_id: &str,
) -> Result<Vec<EyeAssignmentInterval>, String> {
    let mut statement = connection
        .prepare(
            "SELECT start_date, end_date_exclusive, eye_sides_json
         FROM instance_eye_assignment_intervals
         WHERE instance_id=?1 ORDER BY sequence",
        )
        .map_err(error_string)?;
    let rows = statement
        .query_map([instance_id], |row| {
            let eye_sides_json: String = row.get(2)?;
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, Option<String>>(1)?,
                eye_sides_json,
            ))
        })
        .map_err(error_string)?;
    rows.map(|row| {
        let (start_date, end_date, eye_sides_json) = row.map_err(error_string)?;
        Ok(EyeAssignmentInterval {
            start_date,
            end_date,
            eye_sides: parse_string_vec(&eye_sides_json)?,
        })
    })
    .collect()
}

fn load_usage_facts(connection: &Connection) -> Result<Vec<Value>, String> {
    let mut statement = connection
        .prepare(
            "SELECT id, item_id, stock_lot_id, transaction_id, occurred_date,
                fact_kind, quantity, reason
         FROM usage_facts ORDER BY sequence",
        )
        .map_err(error_string)?;
    let rows = statement
        .query_map([], |row| {
            Ok(UsageFact {
                id: row.get(0)?,
                item_id: row.get(1)?,
                stock_lot_id: row.get(2)?,
                transaction_id: row.get(3)?,
                date: row.get(4)?,
                kind: row.get(5)?,
                quantity: row.get(6)?,
                reason: row.get(7)?,
            })
        })
        .map_err(error_string)?;
    rows.map(|row| serde_json::to_value(row.map_err(error_string)?).map_err(error_string))
        .collect()
}

fn load_care_events(connection: &Connection) -> Result<Vec<Value>, String> {
    let mut statement = connection
        .prepare(
            "SELECT id, item_id, event_kind, planned_date, completed_date
         FROM care_events ORDER BY sequence",
        )
        .map_err(error_string)?;
    let rows = statement
        .query_map([], |row| {
            Ok(LensCareEvent {
                id: row.get(0)?,
                item_id: row.get(1)?,
                kind: row.get(2)?,
                planned_date: row.get(3)?,
                completed_date: row.get(4)?,
            })
        })
        .map_err(error_string)?;
    rows.map(|row| serde_json::to_value(row.map_err(error_string)?).map_err(error_string))
        .collect()
}

fn non_empty<T>(values: Vec<T>) -> Option<Vec<T>> {
    if values.is_empty() {
        None
    } else {
        Some(values)
    }
}

fn parse_optional_string_vec(value: Option<String>) -> Result<Option<Vec<String>>, String> {
    value.map(|json| parse_string_vec(&json)).transpose()
}

fn parse_string_vec(json: &str) -> Result<Vec<String>, String> {
    serde_json::from_str(json).map_err(error_string)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn valid_snapshot() -> AppDataSnapshot {
        AppDataSnapshot {
            schema_version: 1,
            profiles: vec![json!({
                "id": "profile-1", "groupId": "lenses",
                "managementTemplate": "rigid_long_term", "standardType": "scleral",
                "name": "巩膜镜（L）", "baseUnit": "片", "side": "L", "active": true, "order": 0
            })],
            products: vec![json!({
                "id": "product-1", "itemProfileId": "profile-1",
                "standardType": "scleral", "brand": "测试", "baseUnit": "片",
                "unitsPerPackage": 1, "active": true
            })],
            locations: vec![json!({
                "id": "home", "name": "家", "active": true, "order": 0
            })],
            lots: vec![json!({
                "id": "lot-1", "productId": "product-1", "internalLotCode": "20260825-1",
                "receivedDate": "2026-08-25", "locationId": "home",
                "initialUnitQuantity": 2, "unitPriceMinor": 10000, "currency": "CNY"
            })],
            items: vec![json!({
                "id": "item-1", "categoryId": "profile-1", "groupId": "lenses",
                "categoryName": "巩膜镜（L）", "productId": "product-1",
                "sourceStockLotId": "lot-1", "label": "镜片", "detail": "",
                "location": "家", "locationId": "home", "startDate": "2026-08-25",
                "endDate": null, "status": "active",
                "stateIntervals": [{"startDate": "2026-08-25", "endDate": null, "status": "active"}],
                "locationIntervals": [{"locationId": "home", "startDate": "2026-08-25", "endDate": null}]
            })],
            transactions: vec![
                json!({
                    "id": "stock-in-1", "stockLotId": "lot-1", "occurredDate": "2026-08-25",
                    "type": "stock_in", "quantityDelta": 2, "locationId": "home"
                }),
                json!({
                    "id": "activate-1", "stockLotId": "lot-1", "occurredDate": "2026-08-25",
                    "type": "activate", "quantityDelta": -1, "relatedInstanceId": "item-1",
                    "locationId": "home"
                }),
            ],
            usage_facts: vec![],
            care_events: vec![json!({
                "id": "care-1", "itemId": "item-1", "kind": "review",
                "plannedDate": "2026-09-01"
            })],
        }
    }

    #[test]
    fn saves_and_loads_a_relational_snapshot() {
        let database = Database::in_memory().unwrap();
        let mut snapshot = valid_snapshot();
        snapshot.lots[0]["unitPriceMinor"] = json!(123456);
        database.save(&snapshot).unwrap();
        assert_eq!(database.load().unwrap().unwrap().lots, snapshot.lots);
        assert_eq!(database.load().unwrap().unwrap().items, snapshot.items);
        assert_eq!(
            database.load().unwrap().unwrap().transactions,
            snapshot.transactions
        );
    }

    #[test]
    fn migrates_cent_prices_to_integer_ten_thousandths() {
        let path =
            crate::test_support::test_directory("price-migration").join("lens-cycle.sqlite3");
        let connection = Connection::open(&path).unwrap();
        connection.execute_batch(MIGRATION_001).unwrap();
        connection
            .execute(
                "INSERT INTO products
             (id, sequence, item_profile_id, standard_type, brand, base_unit,
              units_per_package, is_active)
             VALUES ('old-product', 0, 'plunger-l', 'lens_applicator', '旧数据', '个', 1, 1)",
                [],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO stock_lots
             (id, sequence, product_id, location_id, internal_lot_code, received_date,
              initial_unit_quantity, unit_price_minor, currency)
             VALUES ('old-lot', 0, 'old-product', 'home', '20260912-1', '2026-09-12',
                     1, 1234, 'CNY')",
                [],
            )
            .unwrap();
        drop(connection);

        let database = Database::open(&path).unwrap();
        let connection = database.connection.lock().unwrap();
        let (price, storage_type, generation): (i64, String, String) = connection
            .query_row(
                "SELECT unit_price_minor, typeof(unit_price_minor),
                        (SELECT value FROM app_metadata WHERE key='schema_generation')
                   FROM stock_lots WHERE id='old-lot'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        assert_eq!(
            (price, storage_type.as_str(), generation.as_str()),
            (123400, "integer", "current-2")
        );
    }

    #[test]
    fn current_price_column_is_integer_only() {
        let database = Database::in_memory().unwrap();
        database.save(&valid_snapshot()).unwrap();
        let connection = database.connection.lock().unwrap();
        let declared_type = connection
            .query_row(
                "SELECT type FROM pragma_table_info('stock_lots') WHERE name='unit_price_minor'",
                [],
                |row| row.get::<_, String>(0),
            )
            .unwrap();
        assert_eq!(declared_type, "INTEGER");
        assert!(connection
            .execute(
                "UPDATE stock_lots SET unit_price_minor=1234.5 WHERE id='lot-1'",
                [],
            )
            .is_err());
    }

    #[test]
    fn checkpoint_and_explicit_close_leave_main_database_reopenable() {
        let directory = crate::test_support::test_directory("explicit-close");
        let path = directory.join("lens-cycle.sqlite3");
        let database = Database::open(&path).unwrap();
        database.save(&valid_snapshot()).unwrap();
        database.checkpoint().unwrap();
        database
            .close()
            .map_err(|failure| {
                let (_, error) = *failure;
                error
            })
            .unwrap();

        let wal = directory.join("lens-cycle.sqlite3-wal");
        assert!(!wal.exists() || std::fs::metadata(&wal).unwrap().len() == 0);
        let reopened = Database::open(&path).unwrap();
        assert_eq!(reopened.load().unwrap(), Some(valid_snapshot()));
    }

    #[test]
    fn checkpoint_reports_a_busy_reader_instead_of_claiming_success() {
        let path =
            crate::test_support::test_directory("checkpoint-busy").join("lens-cycle.sqlite3");
        let database = Database::open(&path).unwrap();
        database.save(&valid_snapshot()).unwrap();
        database
            .connection
            .lock()
            .unwrap()
            .busy_timeout(std::time::Duration::ZERO)
            .unwrap();

        let reader = Connection::open(&path).unwrap();
        reader.execute_batch("BEGIN").unwrap();
        reader
            .query_row("SELECT COUNT(*) FROM stock_lots", [], |row| {
                row.get::<_, i64>(0)
            })
            .unwrap();
        let mut changed = valid_snapshot();
        changed.products[0]["brand"] = json!("checkpoint 后写入");
        database.save(&changed).unwrap();

        assert!(database.checkpoint().unwrap_err().contains("未能取得"));
        reader.execute_batch("ROLLBACK").unwrap();
        database.checkpoint().unwrap();
    }

    #[test]
    fn rejects_broken_foreign_keys_and_preserves_the_previous_snapshot() {
        let database = Database::in_memory().unwrap();
        let snapshot = valid_snapshot();
        database.save(&snapshot).unwrap();
        let mut broken = snapshot.clone();
        broken.lots[0]["productId"] = json!("missing-product");
        assert!(database.save(&broken).is_err());
        assert_eq!(database.load().unwrap().unwrap().lots, snapshot.lots);
    }

    #[test]
    fn persists_the_latest_of_multiple_saves_across_reopen() {
        let path = crate::test_support::test_directory("persistence").join("lens-cycle.sqlite3");
        let mut snapshot = valid_snapshot();
        {
            let database = Database::open(&path).unwrap();
            database.save(&snapshot).unwrap();
            snapshot.products[0]["brand"] = json!("连续修改后的品牌");
            database.save(&snapshot).unwrap();
            snapshot.care_events[0]["plannedDate"] = json!("2026-09-08");
            database.save(&snapshot).unwrap();
        }

        let reopened = Database::open(&path).unwrap();
        let loaded = reopened.load().unwrap().unwrap();
        assert_eq!(loaded.products, snapshot.products);
        assert_eq!(loaded.care_events, snapshot.care_events);
        drop(reopened);
    }

    #[test]
    fn saves_and_loads_typed_preferences() {
        let database = Database::in_memory().unwrap();
        assert!(database.load_preferences().unwrap().is_some());
        let preferences = AppPreferences {
            timeline_palette: TimelinePalette {
                active: "#111111".into(),
                paused: "#222222".into(),
                completed: "#333333".into(),
                review: "#444444".into(),
                protein: "#555555".into(),
                forecast: "#666666".into(),
                historical_paused: "#777777".into(),
                danger: "#888888".into(),
            },
            consumption_history_range: "recent_products".into(),
            recent_product_count: 5,
            consumption_history_scope: "same_product".into(),
        };
        database.save_preferences(&preferences).unwrap();
        assert_eq!(database.load_preferences().unwrap(), Some(preferences));
    }

    #[test]
    fn rejects_invalid_preferences_without_replacing_existing_values() {
        let database = Database::in_memory().unwrap();
        let snapshot = valid_snapshot();
        database.save(&snapshot).unwrap();
        let valid = AppPreferences {
            timeline_palette: TimelinePalette {
                active: "#111111".into(),
                paused: "#222222".into(),
                completed: "#333333".into(),
                review: "#444444".into(),
                protein: "#555555".into(),
                forecast: "#666666".into(),
                historical_paused: "#777777".into(),
                danger: "#888888".into(),
            },
            consumption_history_range: "all".into(),
            recent_product_count: 3,
            consumption_history_scope: "same_profile".into(),
        };
        database.save_preferences(&valid).unwrap();
        let mut invalid = valid.clone();
        invalid.recent_product_count = 0;
        assert!(database.save_preferences(&invalid).is_err());
        assert_eq!(database.load_preferences().unwrap(), Some(valid.clone()));

        let mut replacement = snapshot.clone();
        replacement.products[0]["brand"] = json!("不应提交的恢复品牌");
        assert!(database.restore(&replacement, &invalid).is_err());
        assert_eq!(database.load().unwrap(), Some(snapshot));
        assert_eq!(database.load_preferences().unwrap(), Some(valid));
    }

    #[test]
    fn current_schema_contains_no_payload_columns() {
        let database = Database::in_memory().unwrap();
        let connection = database.connection.lock().unwrap();
        let payload_columns = connection
            .prepare("SELECT name FROM sqlite_master WHERE type='table'")
            .and_then(|mut tables| {
                let names = tables
                    .query_map([], |row| row.get::<_, String>(0))?
                    .collect::<rusqlite::Result<Vec<_>>>()?;
                let mut count = 0;
                for name in names {
                    let sql = connection.query_row(
                        "SELECT sql FROM sqlite_master WHERE type='table' AND name=?1",
                        [&name],
                        |row| row.get::<_, String>(0),
                    )?;
                    if sql.contains(&["payload", "json"].join("_")) {
                        count += 1;
                    }
                }
                Ok(count)
            })
            .unwrap();
        assert_eq!(payload_columns, 0);
    }

    #[test]
    fn fresh_database_seeds_only_configuration_and_locations() {
        let database = Database::in_memory().unwrap();
        let data = database.load().unwrap().unwrap();
        assert_eq!((data.profiles.len(), data.locations.len()), (10, 3));
        assert!(data.products.is_empty() && data.lots.is_empty());
        assert!(data.transactions.is_empty() && data.items.is_empty());
        assert!(data.usage_facts.is_empty() && data.care_events.is_empty());
        assert!(database.load_preferences().unwrap().is_some());
    }

    #[test]
    fn rejects_current_instances_without_required_intervals_and_rolls_back() {
        let database = Database::in_memory().unwrap();
        let before = database.load().unwrap().unwrap();

        let mut snapshot = valid_snapshot();
        snapshot.items[0]
            .as_object_mut()
            .unwrap()
            .remove("stateIntervals");
        assert!(database.save(&snapshot).is_err());
        assert_eq!(database.load().unwrap().unwrap(), before);

        let mut item: TimelineItem =
            serde_json::from_value(valid_snapshot().items[0].clone()).unwrap();
        item.location_intervals = None;
        let mutation = AppDataMutation {
            upsert_items: vec![item],
            delete_item_ids: vec![],
            append_transactions: vec![],
            upsert_usage_facts: vec![],
            delete_usage_fact_ids: vec![],
            upsert_care_events: vec![],
            delete_care_event_ids: vec![],
        };
        assert!(database.commit_mutation(&mutation).is_err());
        assert_eq!(database.load().unwrap().unwrap(), before);
    }

    #[test]
    fn rejects_a_database_without_the_exact_current_baseline_marker() {
        let connection = Connection::open_in_memory().unwrap();
        connection
            .execute_batch(
                "CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY);
                 INSERT INTO schema_migrations(version) VALUES (1), (2);",
            )
            .unwrap();
        let error = Database::from_connection(connection).err().unwrap();
        assert!(error.contains("数据库格式不受支持"));
    }

    #[test]
    fn location_commands_write_relational_rows_and_respect_foreign_keys() {
        let database = Database::in_memory().unwrap();
        database.save(&valid_snapshot()).unwrap();
        let mut office = InventoryLocation {
            id: "office".into(),
            name: "办公室".into(),
            note: Some("抽屉".into()),
            active: true,
            order: 1,
        };
        database.create_location(&office).unwrap();
        assert_eq!(
            database.load().unwrap().unwrap().locations[1],
            json!(office)
        );

        office.note = Some("储物柜".into());
        database.update_location(&office).unwrap();
        assert_eq!(
            database.load().unwrap().unwrap().locations[1],
            json!(office)
        );

        assert!(database.delete_location("home").is_err());
        database.delete_location("office").unwrap();
        assert_eq!(database.load().unwrap().unwrap().locations.len(), 1);
    }

    #[test]
    fn profile_and_product_commands_enforce_relations_and_cascade_profile_fields() {
        let database = Database::in_memory().unwrap();
        let mut profile = ItemProfile {
            id: "profile-command".into(),
            group_id: "periodic".into(),
            management_template: "lens_accessory".into(),
            standard_type: "lens_applicator".into(),
            standard_type_name: Some("摘戴工具".into()),
            name: "摘戴工具".into(),
            base_unit: "个".into(),
            side: None,
            default_duration_days: Some(90),
            active: true,
            order: 0,
        };
        database.create_profile(&profile).unwrap();
        let product = Product {
            id: "product-command".into(),
            item_profile_id: profile.id.clone(),
            standard_type: profile.standard_type.clone(),
            brand: "测试品牌".into(),
            model: Some("A".into()),
            specification: None,
            capacity_ml: None,
            base_unit: "个".into(),
            units_per_package: 1,
            default_duration_days: Some(90),
            sort_order: None,
            active: true,
        };
        database.create_product(&product).unwrap();
        assert!(database.delete_profile(&profile.id).is_err());

        profile.standard_type = "column_bottle".into();
        profile.base_unit = "瓶".into();
        database.update_profile(&profile).unwrap();
        let loaded = database.load().unwrap().unwrap();
        assert_eq!(loaded.products[0]["standardType"], json!("column_bottle"));
        assert_eq!(loaded.products[0]["baseUnit"], json!("瓶"));

        database.delete_product(&product.id).unwrap();
        database.delete_profile(&profile.id).unwrap();
    }

    #[test]
    fn receive_stock_commits_lot_and_entry_atomically() {
        let database = Database::in_memory().unwrap();
        database.save(&valid_snapshot()).unwrap();
        let lot = StockLot {
            id: "lot-command".into(),
            product_id: "product-1".into(),
            internal_lot_code: "20260903-1".into(),
            lot_number: Some("A-1".into()),
            manufactured_date: None,
            expiry_date: Some("2027-09-03".into()),
            expected_usage_days: Some(365),
            received_date: "2026-09-03".into(),
            location_id: "home".into(),
            initial_unit_quantity: 2,
            initial_package_quantity: None,
            initial_loose_unit_quantity: None,
            units_per_package_at_receipt: None,
            unit_price_minor: 12000,
            currency: "CNY".into(),
            voided_at: None,
            voided_by_transaction_id: None,
        };
        let entry = InventoryTransaction {
            id: "tx-command".into(),
            stock_lot_id: lot.id.clone(),
            occurred_date: lot.received_date.clone(),
            transaction_type: "stock_in".into(),
            quantity_delta: 2,
            related_instance_id: None,
            related_cycle_id: None,
            reversed_transaction_id: None,
            allocated_unit_quantity: None,
            location_id: Some("home".into()),
            from_location_id: None,
            to_location_id: None,
            transfer_quantity: None,
            reversible_with_instance: None,
            reason: None,
        };
        database.receive_stock(&lot, &entry, None).unwrap();
        let loaded = database.load().unwrap().unwrap();
        assert_eq!(loaded.lots.last(), Some(&json!(lot)));
        assert_eq!(loaded.transactions.last(), Some(&json!(entry)));

        let mut invalid = lot.clone();
        invalid.id = "lot-rollback".into();
        invalid.internal_lot_code = "20260903-2".into();
        assert!(database.receive_stock(&invalid, &entry, None).is_err());
        assert!(!database
            .load()
            .unwrap()
            .unwrap()
            .lots
            .contains(&json!(invalid)));
    }

    #[test]
    fn voids_only_unused_stock_lots_and_preserves_inventory_history() {
        let database = Database::in_memory().unwrap();
        database.save(&valid_snapshot()).unwrap();
        let lot = StockLot {
            id: "unused-lot".into(),
            product_id: "product-1".into(),
            internal_lot_code: "20260904-1".into(),
            lot_number: None,
            manufactured_date: None,
            expiry_date: None,
            expected_usage_days: None,
            received_date: "2026-09-04".into(),
            location_id: "home".into(),
            initial_unit_quantity: 2,
            initial_package_quantity: None,
            initial_loose_unit_quantity: None,
            units_per_package_at_receipt: None,
            unit_price_minor: 10000,
            currency: "CNY".into(),
            voided_at: None,
            voided_by_transaction_id: None,
        };
        let entry = InventoryTransaction {
            id: "unused-stock-in".into(),
            stock_lot_id: lot.id.clone(),
            occurred_date: lot.received_date.clone(),
            transaction_type: "stock_in".into(),
            quantity_delta: lot.initial_unit_quantity,
            related_instance_id: None,
            related_cycle_id: None,
            reversed_transaction_id: None,
            allocated_unit_quantity: None,
            location_id: Some(lot.location_id.clone()),
            from_location_id: None,
            to_location_id: None,
            transfer_quantity: None,
            reversible_with_instance: None,
            reason: None,
        };
        database.receive_stock(&lot, &entry, None).unwrap();
        let correction = InventoryTransaction {
            id: "unused-correction".into(),
            stock_lot_id: lot.id.clone(),
            occurred_date: "2026-09-05".into(),
            transaction_type: "correction".into(),
            quantity_delta: 1,
            related_instance_id: None,
            related_cycle_id: None,
            reversed_transaction_id: None,
            allocated_unit_quantity: None,
            location_id: Some(lot.location_id.clone()),
            from_location_id: None,
            to_location_id: None,
            transfer_quantity: None,
            reversible_with_instance: None,
            reason: Some("盘点更正".into()),
        };
        database
            .commit_mutation(&AppDataMutation {
                upsert_items: vec![],
                delete_item_ids: vec![],
                append_transactions: vec![correction],
                upsert_usage_facts: vec![],
                delete_usage_fact_ids: vec![],
                upsert_care_events: vec![],
                delete_care_event_ids: vec![],
            })
            .unwrap();

        let (voided_lot, reversals) = database
            .void_unused_stock_lot(&lot.id, "2026-09-06", "unused-reverse")
            .unwrap();
        let loaded = database.load().unwrap().unwrap();
        assert_eq!(voided_lot.voided_at.as_deref(), Some("2026-09-06"));
        assert_eq!(
            voided_lot.voided_by_transaction_id.as_deref(),
            Some("unused-reverse")
        );
        assert_eq!(reversals.len(), 2);
        assert!(loaded.lots.iter().any(|value| {
            value["id"] == lot.id
                && value["voidedAt"] == "2026-09-06"
                && value["voidedByTransactionId"] == "unused-reverse"
        }));
        assert!(loaded
            .transactions
            .iter()
            .any(|value| value["id"] == "unused-stock-in"));
        assert!(loaded.transactions.iter().any(|value| {
            value["id"] == "unused-reverse"
                && value["reversedTransactionId"] == "unused-stock-in"
                && value["quantityDelta"] == -2
        }));
        assert!(loaded.transactions.iter().any(|value| {
            value["id"] == "unused-reverse-1"
                && value["reversedTransactionId"] == "unused-correction"
                && value["quantityDelta"] == -1
        }));
        database.save(&loaded).unwrap();
        assert_eq!(database.load().unwrap().unwrap(), loaded);

        let before = database.load().unwrap().unwrap();
        assert!(database
            .void_unused_stock_lot(&lot.id, "2026-09-06", "repeat-reverse")
            .is_err());
        assert!(database
            .void_unused_stock_lot("lot-1", "2026-09-06", "used-reverse")
            .is_err());
        assert_eq!(database.load().unwrap().unwrap(), before);
        assert!(database
            .void_unused_stock_lot("missing-lot", "2026-09-06", "missing-reverse")
            .is_err());
    }

    #[test]
    fn database_triggers_reject_inventory_transaction_update_and_delete() {
        let database = Database::in_memory().unwrap();
        database.save(&valid_snapshot()).unwrap();
        let before = database.load().unwrap().unwrap();
        let connection = database.connection.lock().unwrap();
        let update_error = connection
            .execute(
                "UPDATE inventory_transactions SET reason='覆盖历史' WHERE id='stock-in-1'",
                [],
            )
            .unwrap_err()
            .to_string();
        assert!(update_error.contains("库存流水不可修改"));
        let delete_error = connection
            .execute(
                "DELETE FROM inventory_transactions WHERE id='stock-in-1'",
                [],
            )
            .unwrap_err()
            .to_string();
        assert!(delete_error.contains("库存流水不可删除"));
        drop(connection);
        assert_eq!(database.load().unwrap().unwrap(), before);
    }

    #[test]
    fn transfer_and_lot_correction_enforce_inventory_invariants() {
        let database = Database::in_memory().unwrap();
        database.save(&valid_snapshot()).unwrap();
        database
            .create_location(&InventoryLocation {
                id: "office".into(),
                name: "办公室".into(),
                note: None,
                active: true,
                order: 1,
            })
            .unwrap();
        let transfer = InventoryTransaction {
            id: "transfer-command".into(),
            stock_lot_id: "lot-1".into(),
            occurred_date: "2026-09-03".into(),
            transaction_type: "transfer".into(),
            quantity_delta: 0,
            related_instance_id: None,
            related_cycle_id: None,
            reversed_transaction_id: None,
            allocated_unit_quantity: None,
            location_id: None,
            from_location_id: Some("home".into()),
            to_location_id: Some("office".into()),
            transfer_quantity: Some(1),
            reversible_with_instance: None,
            reason: None,
        };
        database.transfer_stock(&transfer).unwrap();
        let mut excessive = transfer.clone();
        excessive.id = "transfer-too-much".into();
        excessive.transfer_quantity = Some(2);
        assert!(database.transfer_stock(&excessive).is_err());

        let mut lot: StockLot = serde_json::from_value(valid_snapshot().lots[0].clone()).unwrap();
        lot.initial_unit_quantity = 3;
        let created = database
            .update_stock_lot(&lot, "reverse-correction", "stock-in-correction")
            .unwrap();
        assert_eq!(created.len(), 2);
        let loaded = database.load().unwrap().unwrap();
        assert_eq!(loaded.lots[0]["initialUnitQuantity"], json!(3));
        assert_eq!(loaded.transactions.len(), 5);
    }

    #[test]
    fn commit_mutation_writes_timeline_usage_and_care_relationally() {
        let database = Database::in_memory().unwrap();
        database.save(&valid_snapshot()).unwrap();
        let mut item: TimelineItem =
            serde_json::from_value(valid_snapshot().items[0].clone()).unwrap();
        item.label = "关系化实例".into();
        item.detail = "事务提交".into();
        item.prediction_date = Some("2026-09-25".into());
        item.eye_sides = Some(vec!["L".into()]);
        item.eye_assignment_intervals = Some(vec![EyeAssignmentInterval {
            start_date: "2026-08-25".into(),
            end_date: None,
            eye_sides: vec!["L".into()],
        }]);
        let transaction = InventoryTransaction {
            id: "consume-command".into(),
            stock_lot_id: "lot-1".into(),
            occurred_date: "2026-09-03".into(),
            transaction_type: "consume".into(),
            quantity_delta: -1,
            related_instance_id: Some(item.id.clone()),
            related_cycle_id: None,
            reversed_transaction_id: None,
            allocated_unit_quantity: None,
            location_id: Some("home".into()),
            from_location_id: None,
            to_location_id: None,
            transfer_quantity: None,
            reversible_with_instance: None,
            reason: Some("测试消耗".into()),
        };
        let fact = UsageFact {
            id: "usage-command".into(),
            item_id: item.id.clone(),
            stock_lot_id: "lot-1".into(),
            transaction_id: transaction.id.clone(),
            date: "2026-09-03".into(),
            kind: "wear".into(),
            quantity: 1,
            reason: Some("测试消耗".into()),
        };
        let event = LensCareEvent {
            id: "care-command".into(),
            item_id: item.id.clone(),
            kind: "protein".into(),
            planned_date: None,
            completed_date: Some("2026-09-02".into()),
        };
        let mutation = AppDataMutation {
            upsert_items: vec![item],
            delete_item_ids: vec![],
            append_transactions: vec![transaction],
            upsert_usage_facts: vec![fact],
            delete_usage_fact_ids: vec![],
            upsert_care_events: vec![event],
            delete_care_event_ids: vec![],
        };
        database.commit_mutation(&mutation).unwrap();
        let loaded = database.load().unwrap().unwrap();
        assert_eq!(loaded.items[0]["label"], json!("关系化实例"));
        assert_eq!(loaded.items[0]["eyeSides"], json!(["L"]));
        assert_eq!(loaded.usage_facts[0]["reason"], json!("测试消耗"));
        assert_eq!(
            loaded.care_events.last(),
            Some(&json!({
                "id": "care-command", "itemId": "item-1", "kind": "protein",
                "completedDate": "2026-09-02"
            }))
        );
    }
}
