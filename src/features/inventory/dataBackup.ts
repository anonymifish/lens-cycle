import type { TimelinePalette } from "../../stores/timelineThemeStore";
import {
  assertValidAppDataSnapshot,
  collectAppDataSnapshot,
  assertCurrentAppDataSnapshot,
  type AppDataSnapshot
} from "./appDataSnapshot";
import { replacePersistedAppData } from "./databasePersistence";
import { applyPreferences, collectPreferences } from "./preferencesPersistence";
import { invokePersistence as invoke } from "./persistenceGateway";

export const backupFormatVersion = 1;
export const backupAppVersion = "0.1.0";

const collectionNames = [
  "profiles", "products", "locations", "lots", "transactions",
  "items", "usageFacts", "careEvents"
] as const;

export interface BackupPreferences {
  timelinePalette: TimelinePalette;
  consumptionHistoryRange: "all" | "recent_year" | "recent_products";
  recentProductCount: number;
  consumptionHistoryScope: "same_product" | "same_profile" | "same_standard_type";
}

export interface BackupDocument {
  format: "lens-cycle-backup";
  formatVersion: 1;
  appVersion: string;
  exportedAt: string;
  data: AppDataSnapshot;
  preferences: BackupPreferences;
  checksum: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertSnapshotShape(value: unknown): asserts value is AppDataSnapshot {
  if (!isRecord(value) || !Number.isInteger(value.schemaVersion))
    throw new Error("备份中的业务数据缺少有效版本号");
  for (const name of collectionNames) {
    const collection = value[name];
    if (!Array.isArray(collection))
      throw new Error("备份中的业务数据集合缺失：" + name);
    if (collection.some((entry) => !isRecord(entry) || typeof entry.id !== "string" || !entry.id))
      throw new Error("备份中的 " + name + " 集合包含无效记录");
  }
}

function assertPreferencesShape(value: unknown): asserts value is BackupPreferences {
  if (!isRecord(value) || !isRecord(value.timelinePalette))
    throw new Error("备份中的偏好设置结构无效");
  const palette = value.timelinePalette;
  const paletteKeys: Array<keyof TimelinePalette> = [
    "active", "paused", "completed", "review", "protein",
    "forecast", "historicalPaused", "danger"
  ];
  if (paletteKeys.some((key) => typeof palette[key] !== "string"))
    throw new Error("备份中的时间轴配色无效");
  if (!["all", "recent_year", "recent_products"].includes(String(value.consumptionHistoryRange)))
    throw new Error("备份中的预测历史范围无效");
  if (!["same_product", "same_profile", "same_standard_type"].includes(String(value.consumptionHistoryScope)))
    throw new Error("备份中的预测样本范围无效");
  if (!Number.isInteger(value.recentProductCount) || Number(value.recentProductCount) < 1)
    throw new Error("备份中的预测产品数量无效");
}

function checksumPayload(document: Omit<BackupDocument, "checksum">) {
  return JSON.stringify(document);
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function createBackupDocument(now = new Date()): Promise<BackupDocument> {
  const data = collectAppDataSnapshot();
  assertValidAppDataSnapshot(data);
  const unsigned: Omit<BackupDocument, "checksum"> = {
    format: "lens-cycle-backup",
    formatVersion: backupFormatVersion,
    appVersion: backupAppVersion,
    exportedAt: now.toISOString(),
    data,
    preferences: collectPreferences()
  };
  return { ...unsigned, checksum: await sha256(checksumPayload(unsigned)) };
}

export async function parseBackupText(text: string) {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("备份文件不是有效的 JSON");
  }
  if (!isRecord(value) || !Number.isInteger(value.formatVersion))
    throw new Error("备份文件缺少格式版本");
  const formatVersion = Number(value.formatVersion);
  if (formatVersion !== backupFormatVersion)
    throw new Error(
      "仅支持当前备份格式版本 " + backupFormatVersion + "，收到 " + formatVersion
    );
  if (value.format !== "lens-cycle-backup") throw new Error("不支持的备份文件格式");

  assertSnapshotShape(value.data);
  const preferences = value.preferences;
  assertPreferencesShape(preferences);

  if (
    typeof value.appVersion !== "string" ||
    typeof value.exportedAt !== "string" ||
    Number.isNaN(Date.parse(value.exportedAt)) ||
    typeof value.checksum !== "string"
  ) throw new Error("备份文件结构无效或缺少必要字段");
  const { checksum, ...unsigned } = value;
  const actual = await sha256(
    checksumPayload(unsigned as unknown as Omit<BackupDocument, "checksum">)
  );
  if (actual !== checksum)
    throw new Error("备份文件校验失败，内容可能已损坏或被修改");

  let data: AppDataSnapshot;
  try {
    assertCurrentAppDataSnapshot(value.data);
    data = structuredClone(value.data);
    assertValidAppDataSnapshot(data);
  } catch (error) {
    throw new Error(
      "备份业务数据无效：" + (error instanceof Error ? error.message : String(error))
    );
  }
  return { data, preferences };
}

export async function exportBackupFile() {
  const document = await createBackupDocument();
  const contents = JSON.stringify(document, null, 2) + "\n";
  const stamp = document.exportedAt.replace(/[:.]/g, "-");
  const suggestedFileName = "lens-cycle-backup-" + stamp + ".json";
  return invoke<string>("write_backup_file", { contents, suggestedFileName });
}

export async function restoreBackupText(text: string) {
  const parsed = await parseBackupText(text);
  await replacePersistedAppData(parsed.data, parsed.preferences);
  applyPreferences(parsed.preferences);
  return parsed.data;
}
