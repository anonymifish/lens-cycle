mod database;
#[cfg(test)]
mod test_support;

use database::{
    AppDataMutation, AppDataSnapshot, AppPreferences, CurrentAppDataSnapshot, Database,
    InventoryLocation, InventoryTransaction, ItemProfile, LensCareEvent, Product, ProductOrder,
    ProfileOrder, StockLot, TimelineItem, UsageFact,
};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{Manager, State};
use tauri_plugin_dialog::{DialogExt, MessageDialogKind};

const DATABASE_FILE_NAME: &str = "lens-cycle.sqlite3";
const DATA_LOCATION_CONFIG_FILE: &str = "data-location.json";
struct StartupNotice(Mutex<Option<String>>);
struct DatabaseState(Mutex<Option<Database>>);
struct ShutdownState(AtomicBool);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct UpdateStockLotResult {
    lot: StockLot,
    transactions: Vec<InventoryTransaction>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct VoidStockLotResult {
    lot: StockLot,
    transactions: Vec<InventoryTransaction>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DataLocationConfig {
    format_version: u32,
    directory: PathBuf,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DataLocationInfo {
    directory: String,
    default_directory: String,
    is_default: bool,
    qa_mode: bool,
    initialized: bool,
}

struct DataLocationState {
    current_directory: PathBuf,
    default_directory: PathBuf,
    config_path: PathBuf,
    qa_mode: bool,
}

#[tauri::command]
fn get_startup_notice(notice: State<'_, StartupNotice>) -> Result<Option<String>, String> {
    notice
        .0
        .lock()
        .map_err(error_string)
        .map(|message| message.clone())
}

#[tauri::command]
fn load_app_data(
    database: State<'_, DatabaseState>,
) -> Result<Option<CurrentAppDataSnapshot>, String> {
    database
        .0
        .lock()
        .map_err(error_string)?
        .as_ref()
        .ok_or_else(|| "尚未选择数据存放位置".to_string())?
        .load()?
        .map(CurrentAppDataSnapshot::try_from)
        .transpose()
}

#[tauri::command]
fn replace_app_data(
    database: State<'_, DatabaseState>,
    snapshot: CurrentAppDataSnapshot,
    preferences: Option<AppPreferences>,
) -> Result<(), String> {
    let guard = database.0.lock().map_err(error_string)?;
    let database = guard
        .as_ref()
        .ok_or_else(|| "尚未选择数据存放位置".to_string())?;
    let snapshot = snapshot.into();
    match preferences {
        Some(preferences) => database.restore(&snapshot, &preferences),
        None => database.save(&snapshot),
    }
}

#[tauri::command]
fn load_preferences(database: State<'_, DatabaseState>) -> Result<Option<AppPreferences>, String> {
    database
        .0
        .lock()
        .map_err(error_string)?
        .as_ref()
        .ok_or_else(|| "数据库尚未初始化".to_string())?
        .load_preferences()
}

#[tauri::command]
fn save_preferences(
    database: State<'_, DatabaseState>,
    preferences: AppPreferences,
) -> Result<(), String> {
    database
        .0
        .lock()
        .map_err(error_string)?
        .as_ref()
        .ok_or_else(|| "数据库尚未初始化".to_string())?
        .save_preferences(&preferences)
}

#[tauri::command]
fn create_location(
    database: State<'_, DatabaseState>,
    location: InventoryLocation,
) -> Result<InventoryLocation, String> {
    let location = normalize_location(location)?;
    database
        .0
        .lock()
        .map_err(error_string)?
        .as_ref()
        .ok_or_else(|| "数据库尚未初始化".to_string())?
        .create_location(&location)?;
    Ok(location)
}

#[tauri::command]
fn update_location(
    database: State<'_, DatabaseState>,
    location: InventoryLocation,
) -> Result<InventoryLocation, String> {
    let location = normalize_location(location)?;
    database
        .0
        .lock()
        .map_err(error_string)?
        .as_ref()
        .ok_or_else(|| "数据库尚未初始化".to_string())?
        .update_location(&location)?;
    Ok(location)
}

#[tauri::command]
fn delete_location(database: State<'_, DatabaseState>, id: String) -> Result<(), String> {
    database
        .0
        .lock()
        .map_err(error_string)?
        .as_ref()
        .ok_or_else(|| "数据库尚未初始化".to_string())?
        .delete_location(&id)
}

#[tauri::command]
fn create_profile(
    database: State<'_, DatabaseState>,
    profile: ItemProfile,
) -> Result<ItemProfile, String> {
    let profile = normalize_profile(profile)?;
    database
        .0
        .lock()
        .map_err(error_string)?
        .as_ref()
        .ok_or_else(|| "数据库尚未初始化".to_string())?
        .create_profile(&profile)?;
    Ok(profile)
}

#[tauri::command]
fn update_profile(
    database: State<'_, DatabaseState>,
    profile: ItemProfile,
) -> Result<ItemProfile, String> {
    let profile = normalize_profile(profile)?;
    database
        .0
        .lock()
        .map_err(error_string)?
        .as_ref()
        .ok_or_else(|| "数据库尚未初始化".to_string())?
        .update_profile(&profile)?;
    Ok(profile)
}

#[tauri::command]
fn delete_profile(database: State<'_, DatabaseState>, id: String) -> Result<(), String> {
    database
        .0
        .lock()
        .map_err(error_string)?
        .as_ref()
        .ok_or_else(|| "数据库尚未初始化".to_string())?
        .delete_profile(&id)
}

#[tauri::command]
fn reorder_profiles(
    database: State<'_, DatabaseState>,
    order: Vec<ProfileOrder>,
) -> Result<(), String> {
    database
        .0
        .lock()
        .map_err(error_string)?
        .as_ref()
        .ok_or_else(|| "数据库尚未初始化".to_string())?
        .reorder_profiles(&order)
}

#[tauri::command]
fn create_product(database: State<'_, DatabaseState>, product: Product) -> Result<Product, String> {
    let product = normalize_product(product)?;
    database
        .0
        .lock()
        .map_err(error_string)?
        .as_ref()
        .ok_or_else(|| "数据库尚未初始化".to_string())?
        .create_product(&product)?;
    Ok(product)
}

#[tauri::command]
fn update_product(database: State<'_, DatabaseState>, product: Product) -> Result<Product, String> {
    let product = normalize_product(product)?;
    database
        .0
        .lock()
        .map_err(error_string)?
        .as_ref()
        .ok_or_else(|| "数据库尚未初始化".to_string())?
        .update_product(&product)?;
    Ok(product)
}

#[tauri::command]
fn delete_product(database: State<'_, DatabaseState>, id: String) -> Result<(), String> {
    database
        .0
        .lock()
        .map_err(error_string)?
        .as_ref()
        .ok_or_else(|| "数据库尚未初始化".to_string())?
        .delete_product(&id)
}

#[tauri::command]
fn reorder_products(
    database: State<'_, DatabaseState>,
    order: Vec<ProductOrder>,
) -> Result<(), String> {
    database
        .0
        .lock()
        .map_err(error_string)?
        .as_ref()
        .ok_or_else(|| "数据库尚未初始化".to_string())?
        .reorder_products(&order)
}

#[tauri::command]
fn receive_stock(
    database: State<'_, DatabaseState>,
    lot: StockLot,
    inventory_transaction: InventoryTransaction,
    product: Option<Product>,
) -> Result<StockLot, String> {
    let lot = normalize_stock_lot(lot)?;
    if lot.initial_unit_quantity == 0 {
        return Err("入库数量必须是正整数".into());
    }
    let inventory_transaction = normalize_inventory_transaction(inventory_transaction)?;
    let product = product.map(normalize_product).transpose()?;
    database
        .0
        .lock()
        .map_err(error_string)?
        .as_ref()
        .ok_or_else(|| "数据库尚未初始化".to_string())?
        .receive_stock(&lot, &inventory_transaction, product.as_ref())?;
    Ok(lot)
}

#[tauri::command]
fn transfer_stock(
    database: State<'_, DatabaseState>,
    inventory_transaction: InventoryTransaction,
) -> Result<InventoryTransaction, String> {
    let inventory_transaction = normalize_inventory_transaction(inventory_transaction)?;
    database
        .0
        .lock()
        .map_err(error_string)?
        .as_ref()
        .ok_or_else(|| "数据库尚未初始化".to_string())?
        .transfer_stock(&inventory_transaction)?;
    Ok(inventory_transaction)
}

#[tauri::command]
fn update_stock_lot(
    database: State<'_, DatabaseState>,
    lot: StockLot,
    reverse_id: String,
    replacement_id: String,
) -> Result<UpdateStockLotResult, String> {
    let lot = normalize_stock_lot(lot)?;
    let transactions = database
        .0
        .lock()
        .map_err(error_string)?
        .as_ref()
        .ok_or_else(|| "数据库尚未初始化".to_string())?
        .update_stock_lot(&lot, &reverse_id, &replacement_id)?;
    Ok(UpdateStockLotResult { lot, transactions })
}

#[tauri::command]
fn void_unused_stock_lot(
    database: State<'_, DatabaseState>,
    id: String,
    voided_at: String,
    reversal_id: String,
) -> Result<VoidStockLotResult, String> {
    let id = id.trim();
    let voided_at = voided_at.trim();
    let reversal_id = reversal_id.trim();
    if id.is_empty() || voided_at.is_empty() || reversal_id.is_empty() {
        return Err("批次、作废日期和反向流水标识不能为空".into());
    }
    let (lot, transactions) = database
        .0
        .lock()
        .map_err(error_string)?
        .as_ref()
        .ok_or_else(|| "数据库尚未初始化".to_string())?
        .void_unused_stock_lot(id, voided_at, reversal_id)?;
    Ok(VoidStockLotResult { lot, transactions })
}

#[tauri::command]
fn commit_app_data_mutation(
    database: State<'_, DatabaseState>,
    mut mutation: AppDataMutation,
) -> Result<(), String> {
    for product in &mut mutation.upsert_products {
        *product = normalize_product(product.clone())?;
    }
    for item in &mut mutation.upsert_items {
        normalize_timeline_item(item)?;
    }
    for entry in &mut mutation.append_transactions {
        *entry = normalize_inventory_transaction(entry.clone())?;
    }
    for fact in &mut mutation.upsert_usage_facts {
        normalize_usage_fact(fact)?;
    }
    for event in &mut mutation.upsert_care_events {
        normalize_care_event(event)?;
    }
    normalize_ids(&mut mutation.delete_item_ids);
    normalize_ids(&mut mutation.delete_usage_fact_ids);
    normalize_ids(&mut mutation.delete_care_event_ids);
    database
        .0
        .lock()
        .map_err(error_string)?
        .as_ref()
        .ok_or_else(|| "数据库尚未初始化".to_string())?
        .commit_mutation(&mutation)
}

fn normalize_location(mut location: InventoryLocation) -> Result<InventoryLocation, String> {
    location.id = location.id.trim().to_string();
    location.name = location.name.trim().to_string();
    location.note = location
        .note
        .map(|note| note.trim().to_string())
        .filter(|note| !note.is_empty());
    if location.id.is_empty() || location.name.is_empty() {
        return Err("地点标识和名称不能为空".into());
    }
    if location.order < 0 {
        return Err("地点排序值不能为负数".into());
    }
    Ok(location)
}

fn normalize_profile(mut profile: ItemProfile) -> Result<ItemProfile, String> {
    profile.id = profile.id.trim().to_string();
    profile.name = profile.name.trim().to_string();
    profile.standard_type_name = profile
        .standard_type_name
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    profile.base_unit = profile.base_unit.trim().to_string();
    if profile.id.is_empty()
        || profile.name.is_empty()
        || profile.base_unit.is_empty()
        || profile.order < 0
    {
        return Err("用品配置标识、名称或排序值无效".into());
    }
    Ok(profile)
}

fn normalize_product(mut product: Product) -> Result<Product, String> {
    product.id = product.id.trim().to_string();
    product.item_profile_id = product.item_profile_id.trim().to_string();
    product.brand = product.brand.trim().to_string();
    product.base_unit = product.base_unit.trim().to_string();
    product.model = product
        .model
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    product.specification = product
        .specification
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    if product.id.is_empty()
        || product.item_profile_id.is_empty()
        || product.brand.is_empty()
        || product.base_unit.is_empty()
        || product.units_per_package <= 0
    {
        return Err("产品标识、用品配置、品牌、单位或包装数量无效".into());
    }
    Ok(product)
}

fn normalize_stock_lot(mut lot: StockLot) -> Result<StockLot, String> {
    lot.id = lot.id.trim().to_string();
    lot.product_id = lot.product_id.trim().to_string();
    lot.location_id = lot.location_id.trim().to_string();
    lot.internal_lot_code = lot.internal_lot_code.trim().to_string();
    lot.lot_number = lot
        .lot_number
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    lot.voided_at = trim_optional(lot.voided_at.take());
    lot.voided_by_transaction_id = trim_optional(lot.voided_by_transaction_id.take());
    if lot.voided_at.is_some() != lot.voided_by_transaction_id.is_some() {
        return Err("批次作废信息不完整".into());
    }
    if lot.id.is_empty()
        || lot.product_id.is_empty()
        || lot.location_id.is_empty()
        || lot.internal_lot_code.is_empty()
        || lot.initial_unit_quantity < 0
        || lot.unit_price_minor < 0
        || lot.currency != "CNY"
    {
        return Err("入库批次字段无效".into());
    }
    if let (Some(manufactured), Some(expiry)) =
        (lot.manufactured_date.as_deref(), lot.expiry_date.as_deref())
    {
        if expiry < manufactured {
            return Err("预计到期日期不能早于生产日期".into());
        }
    }
    let package_fields = [
        lot.initial_package_quantity,
        lot.initial_loose_unit_quantity,
        lot.units_per_package_at_receipt,
    ];
    if package_fields.iter().any(Option::is_some) {
        let (Some(packages), Some(loose), Some(per_package)) =
            (package_fields[0], package_fields[1], package_fields[2])
        else {
            return Err("包装库存字段不完整".into());
        };
        if packages < 0
            || loose < 0
            || per_package <= 0
            || packages * per_package + loose != lot.initial_unit_quantity
        {
            return Err("盒数、散片数与基础单位总数不一致".into());
        }
    }
    Ok(lot)
}

fn normalize_inventory_transaction(
    mut entry: InventoryTransaction,
) -> Result<InventoryTransaction, String> {
    entry.id = entry.id.trim().to_string();
    entry.stock_lot_id = entry.stock_lot_id.trim().to_string();
    entry.reason = entry
        .reason
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    if entry.id.is_empty() || entry.stock_lot_id.is_empty() {
        return Err("库存流水标识无效".into());
    }
    Ok(entry)
}

fn normalize_timeline_item(item: &mut TimelineItem) -> Result<(), String> {
    item.id = item.id.trim().to_string();
    item.category_id = item.category_id.trim().to_string();
    item.group_id = item.group_id.trim().to_string();
    item.category_name = item.category_name.trim().to_string();
    item.product_id = trim_required_option(item.product_id.take());
    item.source_stock_lot_id = trim_required_option(item.source_stock_lot_id.take());
    item.label = item.label.trim().to_string();
    item.detail = item.detail.trim().to_string();
    item.location = item.location.trim().to_string();
    item.location_id = trim_required_option(item.location_id.take());
    item.status = item.status.trim().to_string();
    item.end_reason = trim_optional(item.end_reason.take());
    item.completion_usage_fact_id = trim_optional(item.completion_usage_fact_id.take());
    item.inventory_source_kind = trim_optional(item.inventory_source_kind.take());
    if item.id.is_empty()
        || item.category_id.is_empty()
        || item.category_name.is_empty()
        || item.product_id.is_none()
        || item.source_stock_lot_id.is_none()
        || item.label.is_empty()
        || item.location.is_empty()
        || item.location_id.is_none()
    {
        return Err("使用实例核心字段不能为空".into());
    }
    if !matches!(
        item.status.as_str(),
        "active" | "paused" | "planned" | "completed"
    ) {
        return Err("使用实例状态无效".into());
    }
    if let Some(quantity) = item.initial_unit_quantity {
        if quantity <= 0 {
            return Err("实例初始数量必须是正整数".into());
        }
    }
    if let Some(rate) = item.usage_rate_per_day {
        if !rate.is_finite() || rate <= 0.0 {
            return Err("每日用量必须大于零".into());
        }
    }
    if let Some(capacity) = item.capacity_ml {
        if !capacity.is_finite() || capacity <= 0.0 {
            return Err("容量必须大于零".into());
        }
    }
    if let Some(kind) = item.inventory_source_kind.as_deref() {
        if !matches!(kind, "package" | "loose") {
            return Err("库存来源类型无效".into());
        }
    }
    if let Some(eye_sides) = item.eye_sides.as_deref() {
        validate_eye_sides(eye_sides)?;
    }
    if let Some(intervals) = item.state_intervals.as_mut() {
        for interval in intervals {
            interval.status = interval.status.trim().to_string();
            if !matches!(interval.status.as_str(), "active" | "paused") {
                return Err("实例状态区间无效".into());
            }
        }
    }
    if let Some(cycles) = item.reusable_lens_cycles.as_mut() {
        for cycle in cycles {
            cycle.id = cycle.id.trim().to_string();
            cycle.label = cycle.label.trim().to_string();
            cycle.status = cycle.status.trim().to_string();
            cycle.end_reason = trim_optional(cycle.end_reason.take());
            if cycle.id.is_empty() || cycle.label.is_empty() || cycle.prediction_date.is_empty() {
                return Err("可复用镜片周期字段不能为空".into());
            }
            if !matches!(cycle.status.as_str(), "active" | "completed") {
                return Err("可复用镜片周期状态无效".into());
            }
        }
    }
    if let Some(intervals) = item.eye_assignment_intervals.as_mut() {
        for interval in intervals {
            validate_eye_sides(&interval.eye_sides)?;
        }
    }
    Ok(())
}

fn normalize_usage_fact(fact: &mut UsageFact) -> Result<(), String> {
    fact.id = fact.id.trim().to_string();
    fact.item_id = fact.item_id.trim().to_string();
    fact.stock_lot_id = fact.stock_lot_id.trim().to_string();
    fact.transaction_id = fact.transaction_id.trim().to_string();
    fact.kind = fact.kind.trim().to_string();
    fact.reason = trim_optional(fact.reason.take());
    if fact.id.is_empty()
        || fact.item_id.is_empty()
        || fact.stock_lot_id.is_empty()
        || fact.transaction_id.is_empty()
        || fact.date.is_empty()
        || fact.quantity <= 0
    {
        return Err("使用事实字段无效".into());
    }
    if !matches!(fact.kind.as_str(), "wear" | "extra_loss" | "dose") {
        return Err("使用事实类型无效".into());
    }
    Ok(())
}

fn normalize_care_event(event: &mut LensCareEvent) -> Result<(), String> {
    event.id = event.id.trim().to_string();
    event.item_id = event.item_id.trim().to_string();
    event.kind = event.kind.trim().to_string();
    if event.id.is_empty() || event.item_id.is_empty() {
        return Err("护理事件标识无效".into());
    }
    if !matches!(event.kind.as_str(), "review" | "protein") {
        return Err("护理事件类型无效".into());
    }
    if event.planned_date.is_none() && event.completed_date.is_none() {
        return Err("护理事件至少需要计划或完成日期".into());
    }
    Ok(())
}

fn validate_eye_sides(eye_sides: &[String]) -> Result<(), String> {
    if eye_sides.is_empty() {
        return Err("镜盒眼别不能为空".into());
    }
    let mut seen = std::collections::HashSet::new();
    for side in eye_sides {
        if !matches!(side.as_str(), "L" | "R") || !seen.insert(side) {
            return Err("镜盒眼别无效".into());
        }
    }
    Ok(())
}

fn trim_optional(value: Option<String>) -> Option<String> {
    value
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn trim_required_option(value: Option<String>) -> Option<String> {
    value.map(|value| value.trim().to_string())
}

fn normalize_ids(ids: &mut Vec<String>) {
    ids.iter_mut().for_each(|id| *id = id.trim().to_string());
    ids.retain(|id| !id.is_empty());
}

#[tauri::command]
fn get_data_location(
    location: State<'_, DataLocationState>,
    database: State<'_, DatabaseState>,
) -> Result<DataLocationInfo, String> {
    let initialized = database.0.lock().map_err(error_string)?.is_some();
    Ok(DataLocationInfo {
        directory: location.current_directory.display().to_string(),
        default_directory: location.default_directory.display().to_string(),
        is_default: paths_equal(&location.current_directory, &location.default_directory),
        qa_mode: location.qa_mode,
        initialized,
    })
}

#[tauri::command]
fn relocate_data(
    database: State<'_, DatabaseState>,
    location: State<'_, DataLocationState>,
    target_directory: String,
) -> Result<(), String> {
    let target = validate_data_directory(Path::new(target_directory.trim()))?;
    if paths_equal(&target, &location.current_directory) {
        return Err("所选目录已经是当前数据位置".into());
    }
    let guard = database.0.lock().map_err(error_string)?;
    let current_database = guard
        .as_ref()
        .ok_or_else(|| "尚未初始化数据库".to_string())?;
    migrate_database_to_directory(
        current_database,
        &target,
        &location.current_directory,
        &location.default_directory,
        &location.config_path,
    )
}

#[tauri::command]
fn initialize_data_location(
    database: State<'_, DatabaseState>,
    location: State<'_, DataLocationState>,
    target_directory: String,
) -> Result<(), String> {
    if database.0.lock().map_err(error_string)?.is_some() {
        return Err("数据库已经初始化，无需再次选择位置".into());
    }
    let target = validate_data_directory(Path::new(target_directory.trim()))?;
    initialize_database_in_directory(&target, &location.default_directory, &location.config_path)
}

fn close_database_for_shutdown(
    database: &DatabaseState,
    shutdown: &ShutdownState,
) -> Result<(), String> {
    if shutdown.0.load(Ordering::Acquire) {
        return Ok(());
    }
    let mut guard = database.0.lock().map_err(error_string)?;
    let Some(current) = guard.as_ref() else {
        shutdown.0.store(true, Ordering::Release);
        return Ok(());
    };
    current
        .checkpoint()
        .map_err(|error| format!("关闭前 WAL checkpoint 失败：{error}"))?;
    let current = guard
        .take()
        .expect("database presence checked while state lock is held");
    match current.close() {
        Ok(()) => {
            shutdown.0.store(true, Ordering::Release);
            Ok(())
        }
        Err(failure) => {
            let (database, error) = *failure;
            *guard = Some(database);
            Err(format!("显式关闭 SQLite 连接失败：{error}"))
        }
    }
}

#[tauri::command]
fn restart_app(
    database: State<'_, DatabaseState>,
    shutdown: State<'_, ShutdownState>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    close_database_for_shutdown(&database, &shutdown)?;
    app.restart();
}

#[tauri::command]
fn exit_app(
    database: State<'_, DatabaseState>,
    shutdown: State<'_, ShutdownState>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    close_database_for_shutdown(&database, &shutdown)?;
    app.exit(0);
    Ok(())
}

#[tauri::command]
fn write_backup_file(
    app: tauri::AppHandle,
    contents: String,
    suggested_file_name: String,
) -> Result<String, String> {
    if contents.len() > 50 * 1024 * 1024 {
        return Err("备份内容超过 50 MB 安全限制".into());
    }
    if !valid_backup_file_name(&suggested_file_name) {
        return Err("备份文件名无效".into());
    }
    let directory = app.path().download_dir().map_err(error_string)?;
    fs::create_dir_all(&directory).map_err(error_string)?;
    let destination = unique_destination(&directory, &suggested_file_name)?;
    let temporary = destination.with_extension(format!("json.tmp-{}", std::process::id()));
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temporary)
        .map_err(error_string)?;
    if let Err(error) = file
        .write_all(contents.as_bytes())
        .and_then(|_| file.sync_all())
    {
        let _ = fs::remove_file(&temporary);
        return Err(error_string(error));
    }
    fs::rename(&temporary, &destination).map_err(error_string)?;
    Ok(destination.display().to_string())
}

fn valid_backup_file_name(name: &str) -> bool {
    name.starts_with("lens-cycle-backup-")
        && name.ends_with(".json")
        && name
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || "-_.".contains(character))
}

fn unique_destination(directory: &Path, file_name: &str) -> Result<PathBuf, String> {
    let requested = directory.join(file_name);
    if !requested.exists() {
        return Ok(requested);
    }
    let stem = file_name.trim_end_matches(".json");
    for suffix in 1..1000 {
        let candidate = directory.join(format!("{stem}-{suffix}.json"));
        if !candidate.exists() {
            return Ok(candidate);
        }
    }
    Err("无法生成唯一的备份文件名".into())
}

fn open_database_with_recovery(current_path: &Path) -> Result<(Database, Option<String>), String> {
    let current_existed = current_path.exists();
    let current = Database::open(current_path)
        .and_then(|database| database.load().map(|data| (database, data)));
    let (database, notice) = match current {
        Ok((database, _)) => (database, None),
        Err(error) if current_existed && is_corruption_error(&error) => {
            let quarantined = quarantine_database(current_path)?;
            let database = Database::open(current_path)?;
            (
                database,
                Some(format!(
                    "检测到损坏的数据库，原文件已保留为 {}。请从已验证备份恢复。",
                    quarantined.display()
                )),
            )
        }
        Err(error) => return Err(error),
    };

    Ok((database, notice))
}

fn is_corruption_error(error: &str) -> bool {
    let message = error.to_ascii_lowercase();
    [
        "database disk image is malformed",
        "file is not a database",
        "database integrity check failed",
    ]
    .iter()
    .any(|needle| message.contains(needle))
}

fn quarantine_database(path: &Path) -> Result<PathBuf, String> {
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(error_string)?
        .as_secs();
    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| "数据库文件名无效".to_string())?;
    let quarantined = path.with_file_name(format!("{file_name}.corrupt-{stamp}"));
    fs::rename(path, &quarantined).map_err(error_string)?;
    for suffix in ["-wal", "-shm"] {
        let sidecar = path.with_file_name(format!("{file_name}{suffix}"));
        if sidecar.exists() {
            let target = path.with_file_name(format!("{file_name}{suffix}.corrupt-{stamp}"));
            fs::rename(sidecar, target).map_err(error_string)?;
        }
    }
    Ok(quarantined)
}

fn data_location_previous_path(config_path: &Path) -> PathBuf {
    config_path.with_extension("json.previous")
}

fn read_data_location_config(config_path: &Path) -> Result<Option<PathBuf>, String> {
    let previous = data_location_previous_path(config_path);
    if !config_path.exists() && previous.exists() {
        fs::rename(&previous, config_path).map_err(error_string)?;
    }
    if !config_path.exists() {
        return Ok(None);
    }
    let contents = fs::read_to_string(config_path).map_err(error_string)?;
    let config: DataLocationConfig = serde_json::from_str(&contents).map_err(error_string)?;
    if config.format_version != 1 || !config.directory.is_absolute() {
        return Err("数据位置配置无效".into());
    }
    let directory = normalize_windows_path(config.directory);
    if !directory.is_dir() {
        return Err(format!("自定义数据目录不可用：{}", directory.display()));
    }
    if !directory.join(DATABASE_FILE_NAME).is_file() {
        return Err(format!(
            "自定义数据目录中找不到 {}：{}",
            DATABASE_FILE_NAME,
            directory.display()
        ));
    }
    Ok(Some(directory))
}

fn write_data_location_config(config_path: &Path, directory: &Path) -> Result<(), String> {
    let parent = config_path
        .parent()
        .ok_or_else(|| "数据位置配置目录无效".to_string())?;
    fs::create_dir_all(parent).map_err(error_string)?;
    let temporary = config_path.with_extension(format!("json.next-{}", std::process::id()));
    let previous = data_location_previous_path(config_path);
    let contents = serde_json::to_vec_pretty(&DataLocationConfig {
        format_version: 1,
        directory: directory.to_path_buf(),
    })
    .map_err(error_string)?;
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temporary)
        .map_err(error_string)?;
    if let Err(error) = file.write_all(&contents).and_then(|_| file.sync_all()) {
        let _ = fs::remove_file(&temporary);
        return Err(error_string(error));
    }
    drop(file);
    if previous.exists() {
        fs::remove_file(&previous).map_err(error_string)?;
    }
    if config_path.exists() {
        fs::rename(config_path, &previous).map_err(error_string)?;
    }
    if let Err(error) = fs::rename(&temporary, config_path) {
        if previous.exists() {
            let _ = fs::rename(&previous, config_path);
        }
        return Err(error_string(error));
    }
    if previous.exists() {
        let _ = fs::remove_file(previous);
    }
    Ok(())
}

fn disable_data_location_config(config_path: &Path) -> Result<(), String> {
    if !config_path.exists() {
        return Ok(());
    }
    let stamp = unix_timestamp()?;
    let archived = config_path.with_extension(format!("json.disabled-{stamp}"));
    fs::rename(config_path, archived).map_err(error_string)
}

fn validate_data_directory(path: &Path) -> Result<PathBuf, String> {
    if path.as_os_str().is_empty() || !path.is_absolute() {
        return Err("请选择一个有效的绝对目录".into());
    }
    let canonical = fs::canonicalize(path)
        .map_err(|error| format!("无法访问所选目录 {}：{error}", path.display()))?;
    if !canonical.is_dir() || canonical.parent().is_none() {
        return Err("不能把磁盘根目录作为数据目录".into());
    }
    #[cfg(windows)]
    {
        use std::path::{Component, Prefix};
        match canonical.components().next() {
            Some(Component::Prefix(prefix))
                if matches!(prefix.kind(), Prefix::Disk(_) | Prefix::VerbatimDisk(_)) => {}
            _ => return Err("当前版本只支持本机磁盘目录，不支持网络共享路径".into()),
        }
    }
    let probe = canonical.join(format!(".lens-cycle-write-test-{}", std::process::id()));
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&probe)
        .map_err(|error| format!("所选目录不可写：{error}"))?;
    let result = file.write_all(b"lens-cycle").and_then(|_| file.sync_all());
    drop(file);
    let _ = fs::remove_file(&probe);
    result.map_err(|error| format!("所选目录写入校验失败：{error}"))?;
    Ok(normalize_windows_path(canonical))
}

#[cfg(windows)]
fn normalize_windows_path(path: PathBuf) -> PathBuf {
    let value = path.to_string_lossy();
    if let Some(rest) = value.strip_prefix(r"\\?\UNC\") {
        return PathBuf::from(format!(r"\\{rest}"));
    }
    if let Some(rest) = value.strip_prefix(r"\\?\") {
        return PathBuf::from(rest);
    }
    path
}

#[cfg(not(windows))]
fn normalize_windows_path(path: PathBuf) -> PathBuf {
    path
}

fn paths_equal(left: &Path, right: &Path) -> bool {
    match (fs::canonicalize(left), fs::canonicalize(right)) {
        (Ok(left), Ok(right)) => left == right,
        _ => left == right,
    }
}

fn unix_timestamp() -> Result<u64, String> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(error_string)
        .map(|duration| duration.as_secs())
}

fn database_sidecar(path: &Path, suffix: &str) -> Result<PathBuf, String> {
    let name = path
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| "数据库文件名无效".to_string())?;
    Ok(path.with_file_name(format!("{name}{suffix}")))
}

fn archive_existing_database(path: &Path) -> Result<Option<PathBuf>, String> {
    if !path.exists() {
        return Ok(None);
    }
    let stamp = unix_timestamp()?;
    let name = path
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| "数据库文件名无效".to_string())?;
    let archived = path.with_file_name(format!("{name}.before-location-change-{stamp}"));
    fs::rename(path, &archived).map_err(error_string)?;
    for suffix in ["-wal", "-shm"] {
        let sidecar = database_sidecar(path, suffix)?;
        if sidecar.exists() {
            fs::rename(&sidecar, database_sidecar(&archived, suffix)?).map_err(error_string)?;
        }
    }
    Ok(Some(archived))
}

fn restore_archived_database(path: &Path, archived: &Path) {
    let _ = fs::rename(archived, path);
    for suffix in ["-wal", "-shm"] {
        if let (Ok(source), Ok(target)) = (
            database_sidecar(archived, suffix),
            database_sidecar(path, suffix),
        ) {
            if source.exists() {
                let _ = fs::rename(source, target);
            }
        }
    }
}

fn migrate_database_to_directory(
    database: &Database,
    target_directory: &Path,
    current_directory: &Path,
    default_directory: &Path,
    config_path: &Path,
) -> Result<(), String> {
    let target_database = target_directory.join(DATABASE_FILE_NAME);
    let returning_to_default = paths_equal(target_directory, default_directory);
    if target_database.exists() && !returning_to_default {
        return Err(format!(
            "所选目录已经包含 {}，为避免覆盖，请选择空目录",
            DATABASE_FILE_NAME
        ));
    }
    if paths_equal(target_directory, current_directory) {
        return Err("所选目录已经是当前数据位置".into());
    }
    let snapshot = database
        .load()?
        .ok_or_else(|| "当前数据库尚未包含可迁移的数据".to_string())?;
    let preferences = database
        .load_preferences()?
        .ok_or_else(|| "当前数据库尚未包含可迁移的偏好设置".to_string())?;
    let staging = create_verified_staging_database(&snapshot, &preferences, target_directory)?;

    let archived = archive_existing_database(&target_database)?;
    if let Err(error) = fs::rename(&staging, &target_database) {
        if let Some(archived) = archived.as_deref() {
            restore_archived_database(&target_database, archived);
        }
        return Err(error_string(error));
    }
    let config_result = if returning_to_default {
        disable_data_location_config(config_path)
    } else {
        write_data_location_config(config_path, target_directory)
    };
    if let Err(error) = config_result {
        let _ = fs::remove_file(&target_database);
        if let Some(archived) = archived.as_deref() {
            restore_archived_database(&target_database, archived);
        }
        return Err(error);
    }
    Ok(())
}

fn create_verified_staging_database(
    snapshot: &AppDataSnapshot,
    preferences: &AppPreferences,
    target_directory: &Path,
) -> Result<PathBuf, String> {
    let staging = target_directory.join(format!(
        ".{DATABASE_FILE_NAME}.migrating-{}-{}",
        std::process::id(),
        unix_timestamp()?
    ));
    let verification = (|| {
        let staged = Database::open(&staging)?;
        staged.restore(snapshot, preferences)?;
        if staged.load()?.as_ref() != Some(snapshot) {
            return Err("迁移后的数据库内容校验失败".into());
        }
        if staged.load_preferences()?.as_ref() != Some(preferences) {
            return Err("迁移后的偏好设置校验失败".into());
        }
        staged.finalize_for_file_move()
    })();
    if let Err(error) = verification {
        let _ = fs::remove_file(&staging);
        return Err(error);
    }
    Ok(staging)
}

fn initialize_database_in_directory(
    target_directory: &Path,
    default_directory: &Path,
    config_path: &Path,
) -> Result<(), String> {
    let target_database = target_directory.join(DATABASE_FILE_NAME);
    if target_database.exists() {
        return Err(format!(
            "所选目录已经包含 {}，为避免覆盖，请选择其他目录",
            DATABASE_FILE_NAME
        ));
    }
    let staging = target_directory.join(format!(
        ".{DATABASE_FILE_NAME}.initializing-{}-{}",
        std::process::id(),
        unix_timestamp()?
    ));
    let initialized = (|| {
        let database = Database::open(&staging)?;
        let snapshot = database
            .load()?
            .ok_or_else(|| "新数据库未生成现行种子".to_string())?;
        if snapshot.profiles.len() != 10
            || snapshot.locations.len() != 3
            || !snapshot.products.is_empty()
            || !snapshot.items.is_empty()
        {
            return Err("新数据库种子校验失败".to_string());
        }
        database.finalize_for_file_move()
    })();
    if let Err(error) = initialized {
        let _ = fs::remove_file(&staging);
        return Err(error);
    }
    fs::rename(&staging, &target_database).map_err(error_string)?;
    let config_result = if paths_equal(target_directory, default_directory) {
        disable_data_location_config(config_path)
    } else {
        write_data_location_config(config_path, target_directory)
    };
    if let Err(error) = config_result {
        let _ = fs::remove_file(&target_database);
        return Err(error);
    }
    Ok(())
}

fn error_string(error: impl std::fmt::Display) -> String {
    error.to_string()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let configured_data_dir = app.path().app_data_dir()?;
            let qa_data_dir = std::env::var_os("LENS_CYCLE_DATA_DIR")
                .filter(|value| !value.is_empty())
                .map(PathBuf::from);
            let default_data_dir = qa_data_dir
                .as_ref()
                .map(|root| root.join("Roaming"))
                .unwrap_or_else(|| configured_data_dir.clone());
            fs::create_dir_all(&default_data_dir)?;
            let config_path = qa_data_dir
                .as_ref()
                .map(|root| root.join("Control").join(DATA_LOCATION_CONFIG_FILE))
                .unwrap_or_else(|| configured_data_dir.join(DATA_LOCATION_CONFIG_FILE));
            let app_data_dir = match read_data_location_config(&config_path) {
                Ok(Some(directory)) => directory,
                Ok(None) => default_data_dir.clone(),
                Err(error) => {
                    app.dialog()
                        .message(format!(
                            "Lens Cycle 无法打开已配置的数据位置。为避免显示空数据，应用将停止启动。\n\n{error}\n\n请恢复该目录后重试。"
                        ))
                        .title("数据位置不可用")
                        .kind(MessageDialogKind::Error)
                        .blocking_show();
                    return Err(std::io::Error::other(error).into());
                }
            };
            fs::create_dir_all(&app_data_dir)?;
            let current_database = app_data_dir.join(DATABASE_FILE_NAME);
            let (database, startup_notice) =
                open_database_with_recovery(&current_database).map_err(std::io::Error::other)?;
            let database = Some(database);
            app.manage(DatabaseState(Mutex::new(database)));
            app.manage(ShutdownState(AtomicBool::new(false)));
            app.manage(StartupNotice(Mutex::new(startup_notice)));
            app.manage(DataLocationState {
                current_directory: app_data_dir,
                default_directory: default_data_dir,
                config_path,
                qa_mode: qa_data_dir.is_some(),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            load_app_data,
            replace_app_data,
            load_preferences,
            save_preferences,
            create_location,
            update_location,
            delete_location,
            create_profile,
            update_profile,
            delete_profile,
            reorder_profiles,
            create_product,
            update_product,
            delete_product,
            reorder_products,
            receive_stock,
            transfer_stock,
            update_stock_lot,
            void_unused_stock_lot,
            commit_app_data_mutation,
            get_startup_notice,
            write_backup_file,
            get_data_location,
            relocate_data,
            initialize_data_location,
            restart_app,
            exit_app
        ])
        .build(tauri::generate_context!())
        .expect("error while building Lens Cycle")
        .run(|app, event| {
            if let tauri::RunEvent::ExitRequested { api, .. } = event {
                let shutdown = app.state::<ShutdownState>();
                if shutdown.0.load(Ordering::Acquire) {
                    return;
                }
                api.prevent_exit();
                let database = app.state::<DatabaseState>();
                match close_database_for_shutdown(&database, &shutdown) {
                    Ok(()) => app.exit(0),
                    Err(error) => {
                        app.dialog()
                            .message(format!(
                                "Lens Cycle 无法安全退出，应用将保持打开。\n\n{error}"
                            ))
                            .title("数据库收尾失败")
                            .kind(MessageDialogKind::Error)
                            .blocking_show();
                    }
                }
            }
        });
}

#[cfg(test)]
mod tests {
    use super::{
        close_database_for_shutdown, initialize_database_in_directory,
        migrate_database_to_directory, normalize_windows_path, open_database_with_recovery,
        read_data_location_config, valid_backup_file_name, write_data_location_config,
        AppDataSnapshot, Database, DatabaseState, ShutdownState, DATABASE_FILE_NAME,
        DATA_LOCATION_CONFIG_FILE,
    };
    use std::{
        fs,
        sync::{
            atomic::{AtomicBool, Ordering},
            Mutex,
        },
    };

    fn empty_snapshot() -> AppDataSnapshot {
        AppDataSnapshot {
            schema_version: 1,
            profiles: vec![],
            products: vec![],
            locations: vec![],
            lots: vec![],
            transactions: vec![],
            items: vec![],
            usage_facts: vec![],
            care_events: vec![],
        }
    }

    #[test]
    fn accepts_only_generated_backup_file_names() {
        assert!(valid_backup_file_name(
            "lens-cycle-backup-2026-08-27T10-00-00Z.json"
        ));
        assert!(!valid_backup_file_name("../backup.json"));
        assert!(!valid_backup_file_name("lens-cycle-backup-bad/name.json"));
    }

    #[test]
    fn shutdown_checkpoint_closes_the_shared_database_idempotently() {
        let path = crate::test_support::test_directory("shutdown-state").join(DATABASE_FILE_NAME);
        let database = Database::open(&path).unwrap();
        database.save(&empty_snapshot()).unwrap();
        let database = DatabaseState(Mutex::new(Some(database)));
        let shutdown = ShutdownState(AtomicBool::new(false));

        close_database_for_shutdown(&database, &shutdown).unwrap();
        assert!(database.0.lock().unwrap().is_none());
        assert!(shutdown.0.load(Ordering::Acquire));
        close_database_for_shutdown(&database, &shutdown).unwrap();
    }

    #[cfg(windows)]
    #[test]
    fn presents_windows_paths_without_the_verbatim_prefix() {
        assert_eq!(
            normalize_windows_path(std::path::PathBuf::from(r"\\?\D:\Lens Cycle Data")),
            std::path::PathBuf::from(r"D:\Lens Cycle Data")
        );
    }

    #[test]
    fn migrates_to_a_custom_data_directory_without_changing_the_source() {
        let root = crate::test_support::test_directory("location");
        let default = root.join("default");
        let target = root.join("custom");
        fs::create_dir_all(&default).unwrap();
        fs::create_dir_all(&target).unwrap();
        let config = default.join(DATA_LOCATION_CONFIG_FILE);
        let source_path = default.join(DATABASE_FILE_NAME);
        let database = Database::open(&source_path).unwrap();
        database.save(&empty_snapshot()).unwrap();
        let mut preferences = database.load_preferences().unwrap().unwrap();
        preferences.timeline_palette.active = "#123456".into();
        database.save_preferences(&preferences).unwrap();

        migrate_database_to_directory(&database, &target, &default, &default, &config).unwrap();

        assert_eq!(
            read_data_location_config(&config).unwrap(),
            Some(target.clone())
        );
        assert_eq!(database.load().unwrap(), Some(empty_snapshot()));
        assert_eq!(
            database.load_preferences().unwrap(),
            Some(preferences.clone())
        );
        let migrated = Database::open(&target.join(DATABASE_FILE_NAME)).unwrap();
        assert_eq!(migrated.load().unwrap(), Some(empty_snapshot()));
        assert_eq!(migrated.load_preferences().unwrap(), Some(preferences));
        drop(migrated);
        drop(database);
    }

    #[test]
    fn initializes_a_verified_database_and_custom_location_config() {
        let root = crate::test_support::test_directory("first-run-custom");
        let default = root.join("default");
        let target = root.join("custom");
        fs::create_dir_all(&default).unwrap();
        fs::create_dir_all(&target).unwrap();
        let config = default.join(DATA_LOCATION_CONFIG_FILE);

        initialize_database_in_directory(&target, &default, &config).unwrap();

        assert_eq!(
            read_data_location_config(&config).unwrap(),
            Some(target.clone())
        );
        let database = Database::open(&target.join(DATABASE_FILE_NAME)).unwrap();
        let seeded = database.load().unwrap().unwrap();
        assert_eq!((seeded.profiles.len(), seeded.locations.len()), (10, 3));
        drop(database);
    }

    #[test]
    fn first_run_initialization_never_overwrites_an_existing_database() {
        let root = crate::test_support::test_directory("first-run-existing");
        let default = root.join("default");
        let target = root.join("custom");
        fs::create_dir_all(&default).unwrap();
        fs::create_dir_all(&target).unwrap();
        let config = default.join(DATA_LOCATION_CONFIG_FILE);
        let database_path = target.join(DATABASE_FILE_NAME);
        let original = b"existing user data";
        fs::write(&database_path, original).unwrap();

        let error = initialize_database_in_directory(&target, &default, &config).unwrap_err();

        assert!(error.contains("避免覆盖"));
        assert_eq!(fs::read(database_path).unwrap(), original);
        assert!(!config.exists());
    }

    #[test]
    fn rejects_a_missing_configured_data_directory() {
        let root = crate::test_support::test_directory("location-missing");
        fs::create_dir_all(&root).unwrap();
        let config = root.join(DATA_LOCATION_CONFIG_FILE);
        fs::write(
            &config,
            format!(
                "{{\"formatVersion\":1,\"directory\":{}}}",
                serde_json::to_string(&root.join("missing")).unwrap()
            ),
        )
        .unwrap();

        assert!(read_data_location_config(&config)
            .unwrap_err()
            .contains("不可用"));
    }

    #[test]
    fn returning_to_default_preserves_the_previous_default_database() {
        let root = crate::test_support::test_directory("location-return");
        let default = root.join("default");
        let custom = root.join("custom");
        fs::create_dir_all(&default).unwrap();
        fs::create_dir_all(&custom).unwrap();
        let config = default.join(DATA_LOCATION_CONFIG_FILE);
        let old_default = Database::open(&default.join(DATABASE_FILE_NAME)).unwrap();
        old_default.checkpoint().unwrap();
        drop(old_default);
        let current = Database::open(&custom.join(DATABASE_FILE_NAME)).unwrap();
        current.save(&empty_snapshot()).unwrap();
        write_data_location_config(&config, &custom).unwrap();

        migrate_database_to_directory(&current, &default, &custom, &default, &config).unwrap();

        assert_eq!(read_data_location_config(&config).unwrap(), None);
        let restored_default = Database::open(&default.join(DATABASE_FILE_NAME)).unwrap();
        assert_eq!(restored_default.load().unwrap(), Some(empty_snapshot()));
        assert!(fs::read_dir(&default).unwrap().any(|entry| {
            entry
                .unwrap()
                .file_name()
                .to_string_lossy()
                .contains("before-location-change")
        }));
        drop(restored_default);
        drop(current);
    }

    #[test]
    fn quarantines_a_corrupt_database_without_deleting_it() {
        let root = crate::test_support::test_directory("corrupt");
        fs::create_dir_all(&root).unwrap();
        let current = root.join("lens-cycle.sqlite3");
        fs::write(&current, b"not a sqlite database").unwrap();

        let (database, notice) = open_database_with_recovery(&current).unwrap();

        let recovered = database.load().unwrap().unwrap();
        assert_eq!(
            (recovered.profiles.len(), recovered.locations.len()),
            (10, 3)
        );
        assert!(recovered.products.is_empty() && recovered.items.is_empty());
        assert!(notice.unwrap().contains("损坏"));
        assert!(fs::read_dir(&root)
            .unwrap()
            .filter_map(Result::ok)
            .any(|entry| entry.file_name().to_string_lossy().contains(".corrupt-")));
    }
}
