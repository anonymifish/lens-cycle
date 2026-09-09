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
