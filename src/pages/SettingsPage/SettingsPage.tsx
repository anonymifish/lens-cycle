import { useEffect, useState, type ChangeEvent, type FormEvent } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { defaultTimelinePalette, useTimelineThemeStore } from "../../stores/timelineThemeStore";
import type { TimelinePalette } from "../../stores/timelineThemeStore";
import { useForecastSettingsStore } from "../../stores/forecastSettingsStore";
import styles from "./SettingsPage.module.css";
import { useInventoryStore } from "../../stores/inventoryStore";
import { useTimelineItemStore } from "../../stores/timelineItemStore";
import { availableUnitsAtLocation } from "../../features/inventory/inventory";
import {
  createLocation,
  deleteLocation,
  setLocationActive,
  updateLocation
} from "../../features/inventory/locationRepository";
import { exportBackupFile, parseBackupText, restoreBackupText } from "../../features/inventory/dataBackup";
import {
  getDataLocation,
  type DataLocationInfo
} from "../../features/inventory/databasePersistence";
import { flushPreferencesSave, savePreferences, type AppPreferences } from "../../features/inventory/preferencesPersistence";
import { invokePersistence as invoke } from "../../features/inventory/persistenceGateway";

const colorFields: Array<{
  key: keyof TimelinePalette;
  label: string;
  description: string;
}> = [
  { key: "active", label: "使用中", description: "正在使用的镜片和用品" },
  { key: "paused", label: "暂停使用", description: "此刻仍处于暂停使用状态" },
  { key: "historicalPaused", label: "历史暂停", description: "已经结束的暂停区间" },
  { key: "completed", label: "结束使用", description: "用完、更换、丢弃或停用" },
  { key: "review", label: "复查节点", description: "复查和计划复查节点" },
  { key: "protein", label: "除蛋白节点", description: "除蛋白和计划除蛋白节点" },
  { key: "forecast", label: "计划与预测", description: "计划更换及预计耗尽日期" },
  { key: "danger", label: "警告与逾期", description: "仅用于异常或逾期状态" }
];

export function SettingsPage() {
  const palette = useTimelineThemeStore((state) => state.palette);
  const setColor = (key: keyof TimelinePalette, value: string) => persistPreference({ timelinePalette: { ...palette, [key]: value } });
  const resetPalette = () => persistPreference({ timelinePalette: defaultTimelinePalette });
  const consumptionHistoryRange = useForecastSettingsStore(
    (state) => state.consumptionHistoryRange
  );
  const recentProductCount = useForecastSettingsStore(
    (state) => state.recentProductCount
  );
  const consumptionHistoryScope = useForecastSettingsStore(
    (state) => state.consumptionHistoryScope
  );
  const setConsumptionHistoryRange = (value: AppPreferences["consumptionHistoryRange"]) => persistPreference({ consumptionHistoryRange: value });
  const setRecentProductCount = (value: number) => persistPreference({ recentProductCount: value });
  const locations = useInventoryStore((state) => state.locations);
  const lots = useInventoryStore((state) => state.lots);
  const transactions = useInventoryStore((state) => state.transactions);
  const timelineItems = useTimelineItemStore((state) => state.items);
  const [editingLocationId, setEditingLocationId] = useState<string | null>(null);
  const [pendingDeleteLocationId, setPendingDeleteLocationId] = useState<string | null>(null);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [pendingRestore, setPendingRestore] = useState<{ name: string; text: string } | null>(null);
  const [dataLocation, setDataLocation] = useState<DataLocationInfo | null>(null);
  const [pendingDataDirectory, setPendingDataDirectory] = useState<string | null>(null);
  const [dataMessage, setDataMessage] = useState<{
    kind: "working" | "success" | "error";
    text: string;
  } | null>(null);
  const setConsumptionHistoryScope = (value: AppPreferences["consumptionHistoryScope"]) => persistPreference({ consumptionHistoryScope: value });
  function persistPreference(changes: Partial<AppPreferences>) {
    void savePreferences(changes)
      .then(() => setDataMessage(null))
      .catch((error: unknown) => {
        setDataMessage({ kind: "error", text: "设置未保存：" + String(error) });
      });
  }
  const isDefault = colorFields.every(
    ({ key }) => palette[key].toLowerCase() === defaultTimelinePalette[key].toLowerCase()
  );

  useEffect(() => {
    void getDataLocation()
      .then(setDataLocation)
      .catch((error) =>
        setDataMessage({ kind: "error", text: "读取数据位置失败：" + String(error) })
      );
  }, []);

  async function saveLocation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    try {
      const value = {
        name: String(formData.get("name")),
        ...(String(formData.get("note") || "").trim()
          ? { note: String(formData.get("note")) }
          : {})
      };
      if (editingLocationId) await updateLocation(editingLocationId, value);
      else await createLocation(value);
      setEditingLocationId(null);
      setLocationError(null);
      form.reset();
    } catch (error) {
      setLocationError(error instanceof Error ? error.message : "保存地点失败");
    }
  }

  async function toggleLocation(id: string, active: boolean) {
    if (!active) {
      const stock = lots.reduce(
        (sum, lot) => sum + availableUnitsAtLocation(lot, id, transactions),
        0
      );
      const hasActiveInstance = timelineItems.some(
        (item) => item.locationId === id && item.status !== "completed"
      );
      if (stock > 0 || hasActiveInstance) {
        setLocationError("该地点仍有库存或正在使用的实例，请先转移后再停用");
        return;
      }
    }
    try {
      await setLocationActive(id, active);
      setLocationError(null);
    } catch (error) {
      setLocationError(error instanceof Error ? error.message : "更新地点失败");
    }
  }

  function locationDeleteBlockReason(id: string) {
    const location = locations.find((entry) => entry.id === id);
    if (!location) return "地点不存在";
    if (locations.length <= 1) return "至少需要保留一个地点";
    if (location.active && locations.filter((entry) => entry.active).length <= 1)
      return "至少需要保留一个启用地点";
    const hasLotReference = lots.some((lot) => lot.locationId === id);
    const hasTransactionReference = transactions.some(
      (transaction) =>
        transaction.locationId === id ||
        transaction.fromLocationId === id ||
        transaction.toLocationId === id
    );
    const hasTimelineReference = timelineItems.some(
      (item) =>
        item.locationId === id ||
        item.locationIntervals?.some((interval) => interval.locationId === id)
    );
    if (hasLotReference || hasTransactionReference || hasTimelineReference)
      return "该地点已有库存批次、流水或使用实例关联";
    return null;
  }

  async function confirmDeleteLocation(id: string) {
    try {
      await deleteLocation(id);
      if (editingLocationId === id) setEditingLocationId(null);
      setPendingDeleteLocationId(null);
      setLocationError(null);
    } catch (error) {
      setLocationError(error instanceof Error ? error.message : "删除地点失败");
    }
  }

  async function createBackup() {
    setDataMessage({ kind: "working", text: "正在校验并创建备份…" });
    try {
      const path = await exportBackupFile();
      setDataMessage({ kind: "success", text: "备份已保存：" + path });
    } catch (error) {
      setDataMessage({
        kind: "error",
        text: error instanceof Error ? error.message : String(error)
      });
    }
  }

  async function selectRestoreFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    if (file.size > 50 * 1024 * 1024) {
      setDataMessage({ kind: "error", text: "备份文件超过 50 MB 安全限制" });
      return;
    }
    try {
      const text = await file.text();
      await parseBackupText(text);
      setPendingRestore({ name: file.name, text });
      setDataMessage(null);
    } catch (error) {
      setPendingRestore(null);
      setDataMessage({
        kind: "error",
        text: error instanceof Error ? error.message : String(error)
      });
    }
  }

  async function confirmRestore() {
    if (!pendingRestore) return;
    setDataMessage({ kind: "working", text: "正在恢复并验证数据…" });
    try {
      await restoreBackupText(pendingRestore.text);
      setPendingRestore(null);
      setDataMessage({ kind: "success", text: "恢复成功，业务数据和偏好设置已更新。" });
    } catch (error) {
      setDataMessage({
        kind: "error",
        text: "恢复失败，当前数据未被覆盖：" +
          (error instanceof Error ? error.message : String(error))
      });
    }
  }

  async function chooseDataDirectory() {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: "选择 Lens Cycle 数据存放目录",
        ...(dataLocation?.directory ? { defaultPath: dataLocation.directory } : {})
      });
      if (typeof selected === "string") {
        setPendingDataDirectory(selected);
        setDataMessage(null);
      }
    } catch (error) {
      setDataMessage({ kind: "error", text: "选择目录失败：" + String(error) });
    }
  }

  async function confirmDataDirectoryChange() {
    if (!pendingDataDirectory) return;
    setDataMessage({ kind: "working", text: "正在保存、校验并迁移数据库…" });
    try {
      await flushPreferencesSave();
      await invoke("relocate_data", {
        targetDirectory: pendingDataDirectory
      });
      setDataMessage({ kind: "working", text: "迁移完成，正在重启应用…" });
      void invoke("restart_app");
    } catch (error) {
      setPendingDataDirectory(null);
      setDataMessage({
        kind: "error",
        text: "数据位置迁移失败，当前数据库未切换：" + String(error)
      });
    }
  }
  return (
    <section className={styles.page}>
      <header className={styles.pageHeader}>
        <span className={styles.eyebrow}>LENS CYCLE</span>
        <div>
          <h1>设置</h1>
          <p>管理时间轴外观、预测规则与库存地点。</p>
        </div>
      </header>

      <div className={styles.settingsLayout}>
        <aside className={styles.settingsNav}>
          <span>设置分区</span>
          <a href="#appearance-settings">
            <strong>外观配色</strong>
            <small>8 项时间轴语义色</small>
          </a>
          <a href="#forecast-settings">
            <strong>预测规则</strong>
            <small>消耗速度的取样方式</small>
          </a>
          <a href="#data-settings">
            <strong>数据安全</strong>
            <small>存放位置、备份与恢复</small>
          </a>
          <a href="#location-settings">
            <strong>地点管理</strong>
            <small>{locations.length} 个库存地点</small>
          </a>
          <p>所有设置会保存在当前设备，并即时应用到相关页面。</p>
        </aside>

        <main className={styles.settingsContent}>
          <section
            aria-labelledby="appearance-settings-title"
            className={styles.settingsCard}
            id="appearance-settings"
          >
            <div className={styles.cardHeading}>
              <div>
                <span>外观</span>
                <h2 id="appearance-settings-title">时间轴配色</h2>
                <p>为不同状态指定固定语义色，修改后立即应用。</p>
              </div>
              <button disabled={isDefault} onClick={resetPalette} type="button">
                恢复默认
              </button>
            </div>

            <div className={styles.preview}>
              <div className={styles.previewHeading}>
                <strong>即时预览</strong>
                <small>使用中 · 历史暂停 · 恢复使用 · 预测延伸</small>
              </div>
              <div className={styles.previewTrack}>
                <i style={{ background: palette.active }} />
                <i style={{ background: palette.historicalPaused }} />
                <i style={{ background: palette.active }} />
                <b style={{ borderColor: palette.forecast }} />
                <em style={{ background: palette.forecast }} />
              </div>
            </div>

            <div className={styles.colorGrid}>
              {colorFields.map((field) => (
                <label className={styles.colorField} key={field.key}>
                  <span className={styles.swatch} style={{ background: palette[field.key] }}>
                    <input
                      aria-label={`${field.label}颜色`}
                      onChange={(event) => setColor(field.key, event.target.value)}
                      type="color"
                      value={palette[field.key]}
                    />
                  </span>
                  <span className={styles.colorCopy}>
                    <strong>{field.label}</strong>
                    <small>{field.description}</small>
                  </span>
                  <code>{palette[field.key].toUpperCase()}</code>
                </label>
              ))}
            </div>
          </section>

          <section
            aria-labelledby="forecast-settings-title"
            className={styles.settingsCard}
            id="forecast-settings"
          >
            <div className={styles.cardHeading}>
              <div>
                <span>预测</span>
                <h2 id="forecast-settings-title">消耗品更换日期预测</h2>
                <p>选择计算使用速度时所参考的历史数据。</p>
              </div>
            </div>
            <div className={styles.forecastSettings}>
              <div className={styles.forecastControls}>
                <label>
                  历史样本对象
                  <select
                    onChange={(event) =>
                      setConsumptionHistoryScope(
                        event.target.value as
                          | "same_product"
                          | "same_profile"
                          | "same_standard_type"
                      )
                    }
                    value={consumptionHistoryScope}
                  >
                    <option value="same_profile">同一用品配置</option>
                    <option value="same_product">同一产品</option>
                    <option value="same_standard_type">同一标准类型</option>
                  </select>
                </label>
                <label>
                  历史样本范围
                  <select
                    onChange={(event) =>
                      setConsumptionHistoryRange(
                        event.target.value as "all" | "recent_year" | "recent_products"
                      )
                    }
                    value={consumptionHistoryRange}
                  >
                    <option value="all">所有历史</option>
                    <option value="recent_year">最近一年</option>
                    <option value="recent_products">最近 N 个产品</option>
                  </select>
                </label>
                {consumptionHistoryRange === "recent_products" && (
                  <label>
                    产品数量 N
                    <input
                      min="1"
                      onChange={(event) => setRecentProductCount(Number(event.target.value))}
                      type="number"
                      value={recentProductCount}
                    />
                  </label>
                )}
              </div>
            </div>
          </section>
          <section
            aria-labelledby="data-settings-title"
            className={styles.settingsCard}
            id="data-settings"
          >
            <div className={styles.cardHeading}>
              <div>
                <span>数据安全</span>
                <h2 id="data-settings-title">备份与恢复</h2>
                <p>备份包含完整业务数据、格式版本、导出时间、偏好设置和完整性校验值。</p>
              </div>
            </div>
            <div className={styles.dataLocationPanel}>
              <div>
                <strong>数据存放位置</strong>
                <small>
                  {dataLocation
                    ? dataLocation.isDefault
                      ? "当前使用 Windows 推荐的用户数据目录"
                      : "当前使用自定义本机目录"
                    : "正在读取当前数据位置…"}
                </small>
                {dataLocation && <code title={dataLocation.directory}>{dataLocation.directory}</code>}
              </div>
              <div className={styles.dataLocationActions}>
                <button
                  disabled={!dataLocation}
                  onClick={() => void chooseDataDirectory()}
                  type="button"
                >
                  选择目录
                </button>
                {dataLocation && !dataLocation.isDefault && (
                  <button
                    onClick={() => setPendingDataDirectory(dataLocation.defaultDirectory)}
                    type="button"
                  >
                    恢复默认位置
                  </button>
                )}
              </div>
            </div>
            <p className={styles.dataLocationHint}>
              仅支持本机磁盘目录。迁移前会保存并校验完整数据库，成功后应用立即重启；旧数据库不会删除。
            </p>
            {pendingDataDirectory && (
              <div className={styles.restoreConfirm} role="alertdialog" aria-labelledby="data-location-confirm-title">
                <div>
                  <strong id="data-location-confirm-title">确认更改数据存放位置？</strong>
                  <p>新位置：{pendingDataDirectory}</p>
                  <p>迁移成功后应用会立即重启。请勿在迁移过程中关闭应用或断开目标磁盘。</p>
                </div>
                <div>
                  <button onClick={() => setPendingDataDirectory(null)} type="button">取消</button>
                  <button className={styles.confirmRestoreButton} onClick={() => void confirmDataDirectoryChange()} type="button">
                    迁移并重启
                  </button>
                </div>
              </div>
            )}
            <div className={styles.dataActions}>
              <div>
                <strong>创建 JSON 备份</strong>
                <small>桌面版会保存到“下载”文件夹；同名文件不会被覆盖。</small>
              </div>
              <button onClick={() => void createBackup()} type="button">创建备份</button>
              <label className={styles.restoreButton}>
                选择备份恢复
                <input accept=".json,application/json" onChange={(event) => void selectRestoreFile(event)} type="file" />
              </label>
            </div>
            {pendingRestore && (
              <div className={styles.restoreConfirm} role="alertdialog" aria-labelledby="restore-confirm-title">
                <div>
                  <strong id="restore-confirm-title">确认恢复“{pendingRestore.name}”？</strong>
                  <p>恢复会替换当前业务数据和偏好设置。文件已通过结构、版本、校验和及业务完整性预检。</p>
                </div>
                <div>
                  <button onClick={() => setPendingRestore(null)} type="button">取消</button>
                  <button className={styles.confirmRestoreButton} onClick={() => void confirmRestore()} type="button">
                    确认恢复
                  </button>
                </div>
              </div>
            )}
            {dataMessage && (
              <div className={styles[dataMessage.kind === "error" ? "dataError" : dataMessage.kind === "success" ? "dataSuccess" : "dataWorking"]} role="status">
                {dataMessage.text}
              </div>
            )}
          </section>

          <section
            aria-labelledby="location-settings-title"
            className={styles.settingsCard}
            id="location-settings"
          >
            <div className={styles.cardHeading}>
              <div>
                <span>库存</span>
                <h2 id="location-settings-title">地点管理</h2>
                <p>地点用于入库、库存转移和使用实例的位置记录。</p>
              </div>
              <span className={styles.cardCount}>{locations.length} 个地点</span>
            </div>
            {locationError && <div className={styles.locationError}>{locationError}</div>}
            <div className={styles.locationList}>
              {[...locations].sort((a, b) => a.order - b.order).map((location) => {
                const deleteBlockReason = locationDeleteBlockReason(location.id);
                const isConfirmingDelete = pendingDeleteLocationId === location.id;
                return <article key={location.id}>
                  <div className={styles.locationInfo}>
                    <strong>{location.name}</strong>
                    <small>{location.note ?? (location.active ? "可用于入库和转入" : "已停用")}</small>
                  </div>
                  <span className={location.active ? styles.locationActive : styles.locationInactive}>
                    {location.active ? "启用" : "停用"}
                  </span>
                  <div className={styles.locationActions}>
                    {isConfirmingDelete ? (
                      <div className={styles.locationDeleteConfirm}>
                        <span>确认删除？</span>
                        <button onClick={() => setPendingDeleteLocationId(null)} type="button">
                          取消
                        </button>
                        <button
                          className={styles.confirmDeleteButton}
                          onClick={() => confirmDeleteLocation(location.id)}
                          type="button"
                        >
                          确认删除
                        </button>
                      </div>
                    ) : (
                      <>
                        <button
                          onClick={() => {
                            setEditingLocationId(location.id);
                            setPendingDeleteLocationId(null);
                          }}
                          type="button"
                        >
                          编辑
                        </button>
                        <button onClick={() => toggleLocation(location.id, !location.active)} type="button">
                          {location.active ? "停用" : "重新启用"}
                        </button>
                        <span className={styles.deleteLocationWrap} title={deleteBlockReason ?? "删除地点"}>
                          <button
                            className={styles.deleteLocationButton}
                            disabled={Boolean(deleteBlockReason)}
                            onClick={() => {
                              setPendingDeleteLocationId(location.id);
                              setLocationError(null);
                            }}
                            type="button"
                          >
                            删除
                          </button>
                        </span>
                      </>
                    )}
                  </div>
                </article>;
              })}
            </div>
            <div className={styles.locationFormPanel}>
              <div>
                <strong>{editingLocationId ? "编辑地点" : "添加地点"}</strong>
                <small>
                  {editingLocationId ? "修改地点名称或备注信息。" : "创建后可在入库与库存转移时选择。"}
                </small>
              </div>
              <form className={styles.locationForm} key={editingLocationId ?? "new"} onSubmit={saveLocation}>
                <label>
                  地点名称
                  <input
                    defaultValue={locations.find((item) => item.id === editingLocationId)?.name}
                    name="name"
                    placeholder="例如：公司、学校、旅行箱"
                    required
                  />
                </label>
                <label>
                  备注（选填）
                  <input
                    defaultValue={locations.find((item) => item.id === editingLocationId)?.note}
                    name="note"
                  />
                </label>
                <div className={styles.locationFormActions}>
                  {editingLocationId && (
                    <button onClick={() => setEditingLocationId(null)} type="button">取消</button>
                  )}
                  <button className={styles.primaryButton} type="submit">
                    {editingLocationId ? "保存修改" : "添加地点"}
                  </button>
                </div>
              </form>
            </div>
          </section>
        </main>
      </div>
    </section>
  );
}
