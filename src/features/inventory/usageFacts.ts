import type { LocalDate } from "../../shared/dates/localDate";
import type { InventoryTransaction } from "./inventory.types";
import {
  availableUnits,
  availableUnitsAtLocation,
  effectiveInventoryTransactions
} from "./inventory";
import { useInventoryStore } from "../../stores/inventoryStore";
import { useUsageFactStore } from "../../stores/usageFactStore";
import type { UsageFactKind } from "../timeline/timeline.types";
import { runLocalDataTransaction } from "./localDataTransaction";
import { useTimelineItemStore } from "../../stores/timelineItemStore";
import { useItemProfileStore } from "../../stores/itemProfileStore";

function validateUsageInput(input: {
  itemId: string;
  stockLotId: string;
  date: LocalDate;
  quantity: number;
}, allowCompleted = false) {
  if (!Number.isInteger(input.quantity) || input.quantity <= 0)
    throw new Error("使用数量必须是正整数");
  const item = useTimelineItemStore
    .getState()
    .items.find((entry) => entry.id === input.itemId);
  if (!item) throw new Error("使用实例不存在");
  if (!allowCompleted && item.status === "completed")
    throw new Error("已经结束的实例不能新增使用记录");
  if (item.sourceStockLotId !== input.stockLotId)
    throw new Error("使用实例与来源批次不一致");
  if (
    input.date < item.startDate ||
    (item.endDate !== null && input.date >= item.endDate)
  )
    throw new Error("使用日期不在实例生命周期内");
  return item;
}

export function recordUsageFact(input: {
  itemId: string;
  stockLotId: string;
  date: LocalDate;
  kind: UsageFactKind;
  quantity: number;
  locationId?: string;
  reason?: string;
}) {
  return runLocalDataTransaction(() => recordUsageFactUnsafe(input));
}

function recordUsageFactUnsafe(input: {
  itemId: string;
  stockLotId: string;
  date: LocalDate;
  kind: UsageFactKind;
  quantity: number;
  locationId?: string;
  reason?: string;
}) {
  const inventory = useInventoryStore.getState();
  const item = validateUsageInput(input);
  const quantity = input.quantity;
  const lot = inventory.lots.find((entry) => entry.id === input.stockLotId);
  if (!lot) throw new Error("来源批次不存在");
  const locationId = input.locationId ?? item.locationId;
  const available = locationId
    ? availableUnitsAtLocation(lot, locationId, inventory.transactions)
    : availableUnits(input.stockLotId, inventory.transactions);
  if (available < quantity) {
    throw new Error("来源批次库存不足");
  }
  const profile = useItemProfileStore
    .getState()
    .profiles.find((entry) => entry.id === item.categoryId);
  const existingFacts = useUsageFactStore
    .getState()
    .facts.filter((fact) => fact.itemId === item.id);
  if (
    input.kind === "wear" &&
    existingFacts.some((fact) => fact.kind === "wear" && fact.date === input.date)
  )
    throw new Error("同一天只能记录一次正常佩戴");
  if (
    profile?.managementTemplate === "soft_daily" &&
    existingFacts.reduce((sum, fact) => sum + fact.quantity, 0) + quantity >
      (item.initialUnitQuantity ?? 0)
  )
    throw new Error("使用与损耗数量超过实例分配数量");
  if (
    profile?.managementTemplate === "soft_reusable" &&
    (item.reusableLensCycles?.length ?? 0) +
      existingFacts
        .filter((fact) => fact.kind === "extra_loss")
        .reduce((sum, fact) => sum + fact.quantity, 0) +
      (input.kind === "extra_loss" ? quantity : 0) >
      (item.initialUnitQuantity ?? 0)
  )
    throw new Error("使用与损耗数量超过实例分配数量");
  const transactionId = `tx-${crypto.randomUUID()}`;
  const factId = `usage-${crypto.randomUUID()}`;
  inventory.addTransaction({
    id: transactionId,
    stockLotId: input.stockLotId,
    occurredDate: input.date,
    type: input.kind === "extra_loss" ? "loss" : "consume",
    quantityDelta: -quantity,
    ...(locationId ? { locationId } : {}),
    relatedInstanceId: input.itemId,
    ...(input.reason ? { reason: input.reason } : {})
  });
  useUsageFactStore.getState().addFact({
    id: factId,
    itemId: input.itemId,
    stockLotId: input.stockLotId,
    transactionId,
    date: input.date,
    kind: input.kind,
    quantity,
    ...(input.reason ? { reason: input.reason } : {})
  });
  return factId;
}

export function reverseUsageFact(factId: string, occurredDate: LocalDate) {
  return runLocalDataTransaction(() => reverseUsageFactUnsafe(factId, occurredDate));
}

function reverseUsageFactUnsafe(factId: string, occurredDate: LocalDate) {
  const facts = useUsageFactStore.getState();
  const fact = facts.facts.find((item) => item.id === factId);
  if (!fact) throw new Error("消耗记录不存在");
  const inventory = useInventoryStore.getState();
  const original = inventory.transactions.find(
    (transaction) => transaction.id === fact.transactionId
  );
  if (
    !original ||
    !effectiveInventoryTransactions(inventory.transactions).some(
      (transaction) => transaction.id === original.id
    )
  )
    throw new Error("消耗记录对应的库存流水不存在或已撤销");
  const reverseTransaction: InventoryTransaction = {
    id: `tx-${crypto.randomUUID()}`,
    stockLotId: fact.stockLotId,
    occurredDate,
    type: "reverse",
    quantityDelta: fact.quantity,
    reversedTransactionId: fact.transactionId,
    reason: "撤销消耗记录"
  };
  inventory.addTransaction(reverseTransaction);
  facts.deleteFact(factId);
}

export function replaceUsageFact(
  factId: string,
  changes: { date: LocalDate; quantity: number; reason?: string }
) {
  return runLocalDataTransaction(() =>
    replaceUsageFactUnsafe(factId, changes)
  );
}

function replaceUsageFactUnsafe(
  factId: string,
  changes: { date: LocalDate; quantity: number; reason?: string }
) {
  const facts = useUsageFactStore.getState();
  const fact = facts.facts.find((item) => item.id === factId);
  if (!fact) throw new Error("消耗记录不存在");
  const inventory = useInventoryStore.getState();
  const item = validateUsageInput(
    {
      itemId: fact.itemId,
      stockLotId: fact.stockLotId,
      date: changes.date,
      quantity: changes.quantity
    },
    true
  );
  const quantity = changes.quantity;
  const original = inventory.transactions.find(
    (transaction) => transaction.id === fact.transactionId
  );
  if (!original) throw new Error("消耗记录对应的库存流水不存在");
  const lot = inventory.lots.find((entry) => entry.id === fact.stockLotId);
  if (!lot) throw new Error("来源批次不存在");
  const originalLocationId = original.locationId ?? item.locationId;
  const available = originalLocationId
    ? availableUnitsAtLocation(
        lot,
        originalLocationId,
        inventory.transactions
      )
    : availableUnits(fact.stockLotId, inventory.transactions);
  if (available + fact.quantity < quantity) {
    throw new Error("来源批次库存不足");
  }
  const replacementTransactionId = `tx-${crypto.randomUUID()}`;
  inventory.addTransaction({
    id: `tx-${crypto.randomUUID()}`,
    stockLotId: fact.stockLotId,
    occurredDate: changes.date,
    type: "reverse",
    quantityDelta: fact.quantity,
    relatedInstanceId: fact.itemId,
    reversedTransactionId: fact.transactionId,
    reason: "修改消耗记录"
  });
  inventory.addTransaction({
    id: replacementTransactionId,
    stockLotId: fact.stockLotId,
    occurredDate: changes.date,
    type: fact.kind === "extra_loss" ? "loss" : "consume",
    quantityDelta: -quantity,
    ...(originalLocationId ? { locationId: originalLocationId } : {}),
    relatedInstanceId: fact.itemId,
    ...(changes.reason ? { reason: changes.reason } : {})
  });
  const nextFact = {
    ...fact,
    transactionId: replacementTransactionId,
    date: changes.date,
    quantity,
    ...(changes.reason ? { reason: changes.reason } : {})
  };
  if (!changes.reason) delete nextFact.reason;
  facts.updateFact(factId, nextFact);
}

export function usedQuantityForItem(itemId: string) {
  return useUsageFactStore
    .getState()
    .facts.filter((fact) => fact.itemId === itemId)
    .reduce((total, fact) => total + fact.quantity, 0);
}
