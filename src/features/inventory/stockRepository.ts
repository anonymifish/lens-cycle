import { invokePersistence as invoke } from "./persistenceGateway";
import { useInventoryStore } from "../../stores/inventoryStore";
import { applyDatabaseViewUpdate } from "./databasePersistence";
import type { EditableStockLot, InventoryTransaction, NewStockLot, Product, StockLot } from "./inventory.types";
import type { LocalDate } from "../../shared/dates/localDate";
import { todayLocalDate } from "../../shared/dates/localDate";

interface VoidStockLotResult {
  lot: StockLot;
  transactions: InventoryTransaction[];
}

function editedLot(source: StockLot, changes: EditableStockLot): StockLot {
  const required = { ...source };
  delete required.lotNumber;
  delete required.manufacturedDate;
  delete required.expiryDate;
  delete required.expectedUsageDays;
  delete required.initialPackageQuantity;
  delete required.initialLooseUnitQuantity;
  delete required.unitsPerPackageAtReceipt;
  return {
    ...required, internalLotCode: changes.internalLotCode.trim(),
    receivedDate: changes.receivedDate, locationId: changes.locationId,
    initialUnitQuantity: changes.quantity, unitPriceMinor: changes.unitPriceMinor,
    ...(changes.lotNumber?.trim() ? { lotNumber: changes.lotNumber.trim() } : {}),
    ...(changes.manufacturedDate ? { manufacturedDate: changes.manufacturedDate } : {}),
    ...(changes.expiryDate ? { expiryDate: changes.expiryDate } : {}),
    ...(changes.expectedUsageDays !== undefined ? { expectedUsageDays: changes.expectedUsageDays } : {}),
    ...(changes.packageQuantity !== undefined ? { initialPackageQuantity: changes.packageQuantity } : {}),
    ...(changes.looseUnitQuantity !== undefined ? { initialLooseUnitQuantity: changes.looseUnitQuantity } : {}),
    ...(changes.unitsPerPackageAtReceipt !== undefined
      ? { unitsPerPackageAtReceipt: changes.unitsPerPackageAtReceipt }
      : {})
  };
}

export async function receiveStock(input: NewStockLot, product?: Product) {
  const id = `lot-${crypto.randomUUID()}`;
  const lot: StockLot = {
    id,
    productId: input.productId,
    internalLotCode: input.internalLotCode.trim(),
    ...(input.lotNumber?.trim() ? { lotNumber: input.lotNumber.trim() } : {}),
    ...(input.manufacturedDate ? { manufacturedDate: input.manufacturedDate } : {}),
    ...(input.expiryDate ? { expiryDate: input.expiryDate } : {}),
    ...(input.expectedUsageDays !== undefined
      ? { expectedUsageDays: input.expectedUsageDays }
      : {}),
    receivedDate: input.receivedDate,
    locationId: input.locationId,
    initialUnitQuantity: input.quantity,
    ...(input.packageQuantity !== undefined
      ? { initialPackageQuantity: input.packageQuantity }
      : {}),
    ...(input.looseUnitQuantity !== undefined
      ? { initialLooseUnitQuantity: input.looseUnitQuantity }
      : {}),
    ...(input.unitsPerPackageAtReceipt !== undefined
      ? { unitsPerPackageAtReceipt: input.unitsPerPackageAtReceipt }
      : {}),
    unitPriceMinor: input.unitPriceMinor,
    currency: "CNY"
  };
  const inventoryTransaction: InventoryTransaction = {
    id: `tx-${crypto.randomUUID()}`,
    stockLotId: id,
    occurredDate: input.receivedDate,
    type: "stock_in",
    quantityDelta: input.quantity,
    locationId: input.locationId
  };
  const stored = await invoke<StockLot>("receive_stock", {
    lot,
    inventoryTransaction,
    product
  });
  applyDatabaseViewUpdate(() => useInventoryStore.setState((state) => ({
    lots: [...state.lots, stored],
    transactions: [...state.transactions, inventoryTransaction],
    products: product
      ? state.products.map((entry) => entry.id === product.id ? product : entry)
      : state.products
  })));
  return stored.id;
}

export async function voidUnusedStockLot(
  id: string,
  voidedAt: LocalDate = todayLocalDate()
) {
  const result = await invoke<VoidStockLotResult>("void_unused_stock_lot", {
    id,
    voidedAt,
    reversalId: `tx-${crypto.randomUUID()}`
  });
  applyDatabaseViewUpdate(() => useInventoryStore.setState((state) => ({
    lots: state.lots.map((lot) => lot.id === id ? result.lot : lot),
    transactions: [...state.transactions, ...result.transactions]
  })));
}

export async function transferStock(input: {
  stockLotId: string;
  fromLocationId: string;
  toLocationId: string;
  quantity: number;
  occurredDate: LocalDate;
  reason?: string;
}) {
  const inventoryTransaction: InventoryTransaction = {
    id: `tx-${crypto.randomUUID()}`,
    stockLotId: input.stockLotId,
    occurredDate: input.occurredDate,
    type: "transfer",
    quantityDelta: 0,
    fromLocationId: input.fromLocationId,
    toLocationId: input.toLocationId,
    transferQuantity: input.quantity,
    ...(input.reason?.trim() ? { reason: input.reason.trim() } : {})
  };
  const stored = await invoke<InventoryTransaction>("transfer_stock", {
    inventoryTransaction
  });
  applyDatabaseViewUpdate(() => useInventoryStore.setState((state) => ({
    transactions: [...state.transactions, stored]
  })));
}

export async function updateStockLot(id: string, changes: EditableStockLot) {
  const source = useInventoryStore.getState().lots.find((entry) => entry.id === id);
  if (!source) throw new Error("库存批次不存在");
  const result = await invoke<{ lot: StockLot; transactions: InventoryTransaction[] }>(
    "update_stock_lot",
    {
      lot: editedLot(source, changes),
      reverseId: `tx-${crypto.randomUUID()}`,
      replacementId: `tx-${crypto.randomUUID()}`
    }
  );
  applyDatabaseViewUpdate(() => useInventoryStore.setState((state) => ({
    lots: state.lots.map((entry) => entry.id === id ? result.lot : entry),
    transactions: [...state.transactions, ...result.transactions]
  })));
}
