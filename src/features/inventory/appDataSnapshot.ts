import type { ItemProfile } from "../catalog/catalog.types";
import {
  validateDataIntegrity,
  type DataIntegrityIssue
} from "./dataIntegrity";
import type {
  InventoryLocation,
  InventoryTransaction,
  Product,
  StockLot
} from "./inventory.types";
import type {
  LensCareEvent,
  TimelineItem,
  UsageFact
} from "../timeline/timeline.types";
import { useInventoryStore } from "../../stores/inventoryStore";
import { useItemProfileStore } from "../../stores/itemProfileStore";
import { useTimelineCareEventStore } from "../../stores/timelineCareEventStore";
import { useTimelineItemStore } from "../../stores/timelineItemStore";
import { useUsageFactStore } from "../../stores/usageFactStore";

export const appDataSchemaVersion = 1;

export interface AppDataSnapshot {
  schemaVersion: number;
  profiles: ItemProfile[];
  products: Product[];
  locations: InventoryLocation[];
  lots: StockLot[];
  transactions: InventoryTransaction[];
  items: TimelineItem[];
  usageFacts: UsageFact[];
  careEvents: LensCareEvent[];
}

export function collectAppDataSnapshot(): AppDataSnapshot {
  const inventory = useInventoryStore.getState();
  return structuredClone({
    schemaVersion: appDataSchemaVersion,
    profiles: useItemProfileStore.getState().profiles,
    products: inventory.products,
    locations: inventory.locations,
    lots: inventory.lots,
    transactions: inventory.transactions,
    items: useTimelineItemStore.getState().items,
    usageFacts: useUsageFactStore.getState().facts,
    careEvents: useTimelineCareEventStore.getState().events
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function assertCurrentAppDataSnapshot(
  value: unknown
): asserts value is AppDataSnapshot {
  if (!isRecord(value) || value.schemaVersion !== appDataSchemaVersion) {
    throw new Error(
      `数据库 schema 版本必须精确等于 ${appDataSchemaVersion}`
    );
  }
  const collections = [
    "profiles", "products", "locations", "lots", "transactions",
    "items", "usageFacts", "careEvents"
  ] as const;
  for (const name of collections) {
    const entries = value[name];
    if (!Array.isArray(entries)) throw new Error(`数据库缺少集合：${name}`);
    if (entries.some((entry) => !isRecord(entry) || typeof entry.id !== "string" || !entry.id))
      throw new Error(`数据库集合 ${name} 包含无效记录`);
  }
  const snapshot = value as unknown as AppDataSnapshot;
  if (snapshot.profiles.some((entry) => typeof entry.baseUnit !== "string"))
    throw new Error("用品配置缺少当前格式必需的 baseUnit");
  if (snapshot.products.some((entry) => typeof entry.itemProfileId !== "string"))
    throw new Error("产品缺少当前格式必需的 itemProfileId");
  if (snapshot.lots.some((entry) => {
    const hasVoidedAt = entry.voidedAt !== undefined;
    const hasVoidingTransaction = entry.voidedByTransactionId !== undefined;
    return hasVoidedAt !== hasVoidingTransaction ||
      (hasVoidedAt && (
        typeof entry.voidedAt !== "string" ||
        typeof entry.voidedByTransactionId !== "string"
      ));
  })) throw new Error("库存批次作废信息不完整");
  if (snapshot.items.some((entry) =>
    typeof entry.locationId !== "string" ||
    !Array.isArray(entry.stateIntervals) ||
    !Array.isArray(entry.locationIntervals)
  )) throw new Error("使用实例缺少当前格式必需的地点或区间字段");
}

export function snapshotIntegrityIssues(snapshot: AppDataSnapshot) {
  return validateDataIntegrity({
    profiles: snapshot.profiles,
    products: snapshot.products,
    locations: snapshot.locations,
    lots: snapshot.lots,
    transactions: snapshot.transactions,
    items: snapshot.items,
    usageFacts: snapshot.usageFacts,
    careEvents: snapshot.careEvents
  });
}

export function assertValidAppDataSnapshot(snapshot: AppDataSnapshot) {
  assertCurrentAppDataSnapshot(snapshot);
  const issues = snapshotIntegrityIssues(snapshot);
  if (!issues.length) return;
  throw new Error(formatIntegrityIssues(issues));
}

function formatIntegrityIssues(issues: DataIntegrityIssue[]) {
  const preview = issues
    .slice(0, 5)
    .map((issue) => `${issue.entity}/${issue.id}: ${issue.message}`)
    .join("；");
  return `数据完整性检查失败（${issues.length} 项）：${preview}`;
}

export function applyAppDataSnapshot(snapshot: AppDataSnapshot) {
  useItemProfileStore.setState({ profiles: structuredClone(snapshot.profiles) });
  useInventoryStore.setState({
    products: structuredClone(snapshot.products),
    locations: structuredClone(snapshot.locations),
    lots: structuredClone(snapshot.lots),
    transactions: structuredClone(snapshot.transactions)
  });
  useTimelineItemStore.setState({ items: structuredClone(snapshot.items) });
  useUsageFactStore.setState({ facts: structuredClone(snapshot.usageFacts) });
  useTimelineCareEventStore.setState({
    events: structuredClone(snapshot.careEvents)
  });
}
