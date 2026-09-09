import { invokePersistence as invoke } from "./persistenceGateway";
import { usePersistenceStatusStore } from "../../stores/persistenceStatusStore";
import type { InventoryTransaction } from "./inventory.types";
import {
  applyAppDataSnapshot,
  assertValidAppDataSnapshot,
  collectAppDataSnapshot,
  type AppDataSnapshot
} from "./appDataSnapshot";
import { applyDatabaseViewUpdate } from "./databasePersistence";
import { runLocalDataTransaction } from "./localDataTransaction";
import { batchStoreNotifications } from "../../stores/atomicStore";
import { useTimelineItemStore } from "../../stores/timelineItemStore";
import { useTimelineCareEventStore } from "../../stores/timelineCareEventStore";
import { useUsageFactStore } from "../../stores/usageFactStore";
import { useInventoryStore } from "../../stores/inventoryStore";
import {
  availableUnitsAtLocation,
  effectiveInventoryTransactions
} from "./inventory";
import type { LocalDate } from "../../shared/dates/localDate";
import type { TimelineItem } from "../timeline/timeline.types";
import { useItemProfileStore } from "../../stores/itemProfileStore";
import { endTimelineItem } from "../timeline/domain/lifecycle";

interface AppDataMutation {
  upsertItems: AppDataSnapshot["items"];
  deleteItemIds: string[];
  appendTransactions: InventoryTransaction[];
  upsertUsageFacts: AppDataSnapshot["usageFacts"];
  deleteUsageFactIds: string[];
  upsertCareEvents: AppDataSnapshot["careEvents"];
  deleteCareEventIds: string[];
}

export async function commitDataMutation<T>(operation: () => T): Promise<T> {
  const before = collectAppDataSnapshot();
  let result!: T;
  let after!: AppDataSnapshot;
  batchStoreNotifications(() => {
    try {
      result = runLocalDataTransaction(operation);
      after = collectAppDataSnapshot();
      for (const collection of ["profiles", "products", "locations", "lots"] as const) {
        if (stableStringify(before[collection]) !== stableStringify(after[collection])) {
          throw new Error(`组合事务不支持修改 ${collection}，请使用对应 repository`);
        }
      }
      normalizeDeletedItemState(before, after);
      assertValidAppDataSnapshot(after);
    } finally {
      applyAppDataSnapshot(before);
    }
  }, false);
  const mutation = buildMutation(before, after);
  if (!hasMutation(mutation)) {
    return result;
  }

  const status = usePersistenceStatusStore.getState();
  status.setStatus("sqlite", "saving");
  try {
    await invoke("commit_app_data_mutation", { mutation });
    applyDatabaseViewUpdate(() => applyAppDataSnapshot(after));
    status.setStatus("sqlite", "ready");
    return result;
  } catch (error) {
    status.setStatus("sqlite", "error", errorMessage(error));
    throw error;
  }
}

/**
 * Deletes one mistakenly-created usage instance without constructing and
 * publishing a full application snapshot. The Rust command remains the atomic
 * persistence boundary; only the affected stores are updated after commit.
 */
export async function deleteMistakenTimelineItem(
  itemId: string,
  occurredDate: LocalDate
) {
  const inventory = useInventoryStore.getState();
  const items = useTimelineItemStore.getState().items;
  const facts = useUsageFactStore.getState().facts.filter(
    (fact) => fact.itemId === itemId
  );
  const careEvents = useTimelineCareEventStore.getState().events.filter(
    (event) => event.itemId === itemId
  );
  if (!items.some((item) => item.id === itemId)) {
    throw new Error("使用实例不存在");
  }

  const effective = effectiveInventoryTransactions(inventory.transactions);
  const effectiveById = new Map(effective.map((entry) => [entry.id, entry]));
  const activationTransactions = effective.filter(
    (entry) =>
      ["activate", "package_open", "loose_allocate"].includes(entry.type) &&
      entry.reversibleWithInstance !== false &&
      entry.relatedInstanceId === itemId
  );
  const usageTransactions = facts.map((fact) => {
    const transaction = effectiveById.get(fact.transactionId);
    if (!transaction) {
      throw new Error("使用记录对应的库存流水不存在或已撤销");
    }
    if (
      transaction.relatedInstanceId !== itemId ||
      transaction.stockLotId !== fact.stockLotId ||
      transaction.quantityDelta !== -fact.quantity
    ) {
      throw new Error("使用记录与库存流水不一致");
    }
    return transaction;
  });
  const originals = [...activationTransactions, ...usageTransactions];
  if (new Set(originals.map((entry) => entry.id)).size !== originals.length) {
    throw new Error("待撤销的库存流水重复");
  }
  const reversals: InventoryTransaction[] = originals.map((original) => ({
    id: `tx-${crypto.randomUUID()}`,
    stockLotId: original.stockLotId,
    occurredDate,
    type: "reverse",
    quantityDelta: -original.quantityDelta,
    reversedTransactionId: original.id,
    ...(original.locationId ? { locationId: original.locationId } : {}),
    reason:
      original.type === "activate" ||
      original.type === "package_open" ||
      original.type === "loose_allocate"
        ? "删除误录实例"
        : "删除误录实例并撤销使用记录"
  }));
  const mutation: AppDataMutation = {
    upsertItems: [],
    deleteItemIds: [itemId],
    appendTransactions: reversals,
    upsertUsageFacts: [],
    deleteUsageFactIds: facts.map((fact) => fact.id),
    upsertCareEvents: [],
    deleteCareEventIds: careEvents.map((event) => event.id)
  };

  await invoke("commit_app_data_mutation", { mutation });
  applyDatabaseViewUpdate(() => {
    if (reversals.length > 0) {
      useInventoryStore.setState((state) => ({
        transactions: [...state.transactions, ...reversals]
      }));
    }
    useTimelineItemStore.setState((state) => ({
      items: state.items.filter((item) => item.id !== itemId)
    }));
    if (facts.length > 0) {
      const factIds = new Set(facts.map((fact) => fact.id));
      useUsageFactStore.setState((state) => ({
        facts: state.facts.filter((fact) => !factIds.has(fact.id))
      }));
    }
    if (careEvents.length > 0) {
      const eventIds = new Set(careEvents.map((event) => event.id));
      useTimelineCareEventStore.setState((state) => ({
        events: state.events.filter((event) => !eventIds.has(event.id))
      }));
    }
  });
}

type TimelineItemsUpdater = (current: TimelineItem[]) => TimelineItem[];

/** Commit lifecycle-only item updates without replacing unrelated stores. */
export async function commitTimelineItemUpdates(updater: TimelineItemsUpdater) {
  const current = useTimelineItemStore.getState().items;
  const next = updater(current);
  if (
    next.length !== current.length ||
    next.some((item, index) => item.id !== current[index]?.id)
  ) {
    throw new Error("生命周期增量事务不能新增、删除或重排实例");
  }
  const changed = next.filter((item, index) => item !== current[index]);
  if (changed.length === 0) return;
  await commitTimelineItemUpserts(changed);
}

/**
 * Commits one timeline detail update together with its inventory transfer or
 * activation-date correction entries, without cloning the full application.
 */
export async function commitTimelineItemInventoryUpdate(
  upsertItem: TimelineItem,
  appendTransactions: InventoryTransaction[]
) {
  const currentItems = useTimelineItemStore.getState().items;
  if (!currentItems.some((item) => item.id === upsertItem.id)) {
    throw new Error("待更新的使用实例不存在");
  }
  const inventory = useInventoryStore.getState();
  const existingTransactionIds = new Set(
    inventory.transactions.map((entry) => entry.id)
  );
  const appendedIds = appendTransactions.map((entry) => entry.id);
  if (
    new Set(appendedIds).size !== appendedIds.length ||
    appendedIds.some((id) => existingTransactionIds.has(id))
  ) {
    throw new Error("增量库存事务包含重复流水");
  }
  const allowedTypes = new Set<InventoryTransaction["type"]>([
    "activate",
    "package_open",
    "loose_allocate",
    "transfer",
    "reverse"
  ]);
  if (appendTransactions.some((entry) => !allowedTypes.has(entry.type))) {
    throw new Error("实例资料更新包含不支持的库存流水");
  }
  appendTransactions.forEach((entry, index) => {
    if (entry.type !== "transfer") return;
    const lot = inventory.lots.find((candidate) => candidate.id === entry.stockLotId);
    const source = inventory.locations.find(
      (candidate) => candidate.id === entry.fromLocationId
    );
    const target = inventory.locations.find(
      (candidate) => candidate.id === entry.toLocationId && candidate.active
    );
    const quantity = entry.transferQuantity ?? 0;
    if (
      !lot ||
      !source ||
      !target ||
      source.id === target.id ||
      !Number.isInteger(quantity) ||
      quantity <= 0
    ) {
      throw new Error("批次、来源地点、目标地点或转移数量不可用");
    }
    if (
      availableUnitsAtLocation(lot, source.id, [
        ...inventory.transactions,
        ...appendTransactions.slice(0, index)
      ]) < quantity
    ) {
      throw new Error("来源地点可转移库存不足");
    }
  });
  const mutation: AppDataMutation = {
    upsertItems: [upsertItem],
    deleteItemIds: [],
    appendTransactions,
    upsertUsageFacts: [],
    deleteUsageFactIds: [],
    upsertCareEvents: [],
    deleteCareEventIds: []
  };

  await invoke("commit_app_data_mutation", { mutation });
  applyDatabaseViewUpdate(() => {
    if (appendTransactions.length > 0) {
      useInventoryStore.setState((state) => ({
        transactions: [...state.transactions, ...appendTransactions]
      }));
    }
    publishTimelineItemUpserts([upsertItem]);
  });
}

/** End a batch consumable using a user-confirmed physical stock count. */
export async function completeBatchConsumableTimelineItem(
  itemId: string,
  actualEndDate: LocalDate,
  actualRemainingQuantity: number
) {
  if (!Number.isInteger(actualRemainingQuantity) || actualRemainingQuantity < 0) {
    throw new Error("实际剩余数量必须是非负整数");
  }
  const item = useTimelineItemStore
    .getState()
    .items.find((entry) => entry.id === itemId);
  if (!item) throw new Error("使用实例不存在");
  const profile = useItemProfileStore
    .getState()
    .profiles.find((entry) => entry.id === item.categoryId);
  if (profile?.managementTemplate !== "batch_consumable") {
    throw new Error("只有批量消耗品可以确认结束库存");
  }
  if (!item.sourceStockLotId || !item.locationId) {
    throw new Error("实例缺少来源批次或当前地点");
  }
  const inventory = useInventoryStore.getState();
  const lot = inventory.lots.find((entry) => entry.id === item.sourceStockLotId);
  if (!lot) throw new Error("来源批次不存在");
  const ledgerRemaining = availableUnitsAtLocation(
    lot,
    item.locationId,
    inventory.transactions
  );
  const difference = actualRemainingQuantity - ledgerRemaining;
  const reason = `结束盘点：账面 ${ledgerRemaining}，实际 ${actualRemainingQuantity}`;
  const adjustment: InventoryTransaction | null =
    difference === 0
      ? null
      : {
          id: `tx-${crypto.randomUUID()}`,
          stockLotId: lot.id,
          occurredDate: actualEndDate,
          type: difference < 0 ? "loss" : "correction",
          quantityDelta: difference,
          locationId: item.locationId,
          relatedInstanceId: item.id,
          reason
        };
  const usageFact: AppDataSnapshot["usageFacts"][number] | null =
    adjustment?.type === "loss"
      ? {
          id: `usage-${crypto.randomUUID()}`,
          itemId: item.id,
          stockLotId: lot.id,
          transactionId: adjustment.id,
          date: actualEndDate,
          kind: "extra_loss",
          quantity: -difference,
          reason
        }
      : null;
  const completedItem = endTimelineItem(item, actualEndDate);
  const mutation: AppDataMutation = {
    upsertItems: [completedItem],
    deleteItemIds: [],
    appendTransactions: adjustment ? [adjustment] : [],
    upsertUsageFacts: usageFact ? [usageFact] : [],
    deleteUsageFactIds: [],
    upsertCareEvents: [],
    deleteCareEventIds: []
  };

  await invoke("commit_app_data_mutation", { mutation });
  applyDatabaseViewUpdate(() => {
    if (adjustment) {
      useInventoryStore.setState((state) => ({
        transactions: [...state.transactions, adjustment]
      }));
    }
    if (usageFact) {
      useUsageFactStore.setState((state) => ({ facts: [...state.facts, usageFact] }));
    }
    publishTimelineItemUpserts([completedItem]);
  });
  return { ledgerRemaining, actualRemainingQuantity, difference };
}

/**
 * Reopens a discard-completed instance and reverses its inventory fact in the
 * same SQLite transaction, then publishes only the affected collections.
 */
export async function reopenDiscardedTimelineItems(
  factId: string,
  occurredDate: LocalDate,
  upsertItems: TimelineItem[]
) {
  const facts = useUsageFactStore.getState().facts;
  const fact = facts.find((entry) => entry.id === factId);
  if (!fact) throw new Error("消耗记录不存在");
  const original = effectiveInventoryTransactions(
    useInventoryStore.getState().transactions
  ).find((entry) => entry.id === fact.transactionId);
  if (
    !original ||
    original.relatedInstanceId !== fact.itemId ||
    original.stockLotId !== fact.stockLotId ||
    original.quantityDelta !== -fact.quantity
  ) {
    throw new Error("消耗记录对应的库存流水不存在、已撤销或字段不一致");
  }
  const reversal: InventoryTransaction = {
    id: `tx-${crypto.randomUUID()}`,
    stockLotId: original.stockLotId,
    occurredDate,
    type: "reverse",
    quantityDelta: -original.quantityDelta,
    reversedTransactionId: original.id,
    ...(original.locationId ? { locationId: original.locationId } : {}),
    reason: "撤销丢弃并恢复使用"
  };
  const mutation: AppDataMutation = {
    upsertItems,
    deleteItemIds: [],
    appendTransactions: [reversal],
    upsertUsageFacts: [],
    deleteUsageFactIds: [fact.id],
    upsertCareEvents: [],
    deleteCareEventIds: []
  };

  await invoke("commit_app_data_mutation", { mutation });
  applyDatabaseViewUpdate(() => {
    useInventoryStore.setState((state) => ({
      transactions: [...state.transactions, reversal]
    }));
    publishTimelineItemUpserts(upsertItems);
    useUsageFactStore.setState((state) => ({
      facts: state.facts.filter((entry) => entry.id !== fact.id)
    }));
  });
}

async function commitTimelineItemUpserts(upsertItems: TimelineItem[]) {
  const currentIds = new Set(
    useTimelineItemStore.getState().items.map((item) => item.id)
  );
  if (
    upsertItems.length === 0 ||
    upsertItems.some((item) => !currentIds.has(item.id)) ||
    new Set(upsertItems.map((item) => item.id)).size !== upsertItems.length
  ) {
    throw new Error("生命周期增量事务包含无效实例");
  }
  const mutation: AppDataMutation = {
    upsertItems,
    deleteItemIds: [],
    appendTransactions: [],
    upsertUsageFacts: [],
    deleteUsageFactIds: [],
    upsertCareEvents: [],
    deleteCareEventIds: []
  };
  await invoke("commit_app_data_mutation", { mutation });
  applyDatabaseViewUpdate(() => publishTimelineItemUpserts(upsertItems));
}

function publishTimelineItemUpserts(upsertItems: TimelineItem[]) {
  const byId = new Map(upsertItems.map((item) => [item.id, item]));
  useTimelineItemStore.setState((state) => ({
    items: state.items.map((item) => byId.get(item.id) ?? item)
  }));
}

function buildMutation(
  before: AppDataSnapshot,
  after: AppDataSnapshot
): AppDataMutation {
  const beforeTransactionIds = new Set(before.transactions.map((entry) => entry.id));
  const removedTransactionIds = removedIds(before.transactions, after.transactions);
  if (removedTransactionIds.length) {
    throw new Error("库存流水不可删除；请追加反向流水");
  }
  const changedExistingTransaction = after.transactions.find((entry) => {
    if (!beforeTransactionIds.has(entry.id)) return false;
    const original = before.transactions.find((candidate) => candidate.id === entry.id);
    return stableStringify(original) !== stableStringify(entry);
  });
  if (changedExistingTransaction) {
    throw new Error("库存流水不可覆盖；请追加反向或替代流水");
  }

  return {
    upsertItems: changedById(before.items, after.items),
    deleteItemIds: removedIds(before.items, after.items),
    appendTransactions: after.transactions.filter(
      (entry) => !beforeTransactionIds.has(entry.id)
    ),
    upsertUsageFacts: changedById(before.usageFacts, after.usageFacts),
    deleteUsageFactIds: removedIds(before.usageFacts, after.usageFacts),
    upsertCareEvents: changedById(before.careEvents, after.careEvents),
    deleteCareEventIds: removedIds(before.careEvents, after.careEvents)
  };
}

function normalizeDeletedItemState(
  before: AppDataSnapshot,
  after: AppDataSnapshot
) {
  const deletedItemIds = new Set(removedIds(before.items, after.items));
  if (!deletedItemIds.size) return;
  after.usageFacts = after.usageFacts.filter((fact) => !deletedItemIds.has(fact.itemId));
  after.careEvents = after.careEvents.filter((event) => !deletedItemIds.has(event.itemId));
}

function changedById<T extends { id: string }>(before: T[], after: T[]): T[] {
  const beforeById = new Map(before.map((entry) => [entry.id, stableStringify(entry)]));
  return after.filter((entry) => beforeById.get(entry.id) !== stableStringify(entry));
}

function removedIds<T extends { id: string }>(before: T[], after: T[]) {
  const afterIds = new Set(after.map((entry) => entry.id));
  return before
    .filter((entry) => !afterIds.has(entry.id))
    .map((entry) => entry.id);
}

function hasMutation(mutation: AppDataMutation) {
  return Object.values(mutation).some((entries) => entries.length > 0);
}

function stableStringify(value: unknown) {
  return JSON.stringify(value);
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
