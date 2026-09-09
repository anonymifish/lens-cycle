import type {
  InventoryTransaction,
  Product,
  StockLot
} from "./inventory.types";
import type { ItemProfile } from "../catalog/catalog.types";
import type { TimelineItem } from "../timeline/timeline.types";

const inventoryGroupOrder = ["lenses", "periodic", "consumables"] as const;

export function sortProductsByProfileOrder(
  products: Product[],
  profiles: ItemProfile[]
): Product[] {
  const profilesById = new Map(profiles.map((profile) => [profile.id, profile]));
  const profileFor = (product: Product) => profilesById.get(product.itemProfileId);

  return [...products].sort((left, right) => {
    const leftProfile = profileFor(left);
    const rightProfile = profileFor(right);
    if (leftProfile && rightProfile) {
      const byGroup =
        inventoryGroupOrder.indexOf(leftProfile.groupId) -
        inventoryGroupOrder.indexOf(rightProfile.groupId);
      if (byGroup !== 0) return byGroup;
      const byProfile = leftProfile.order - rightProfile.order;
      if (byProfile !== 0) return byProfile;
    } else if (leftProfile) {
      return -1;
    } else if (rightProfile) {
      return 1;
    }

    const leftHasCustomOrder = Number.isInteger(left.sortOrder);
    const rightHasCustomOrder = Number.isInteger(right.sortOrder);
    if (leftHasCustomOrder && rightHasCustomOrder) {
      const byCustomOrder = left.sortOrder! - right.sortOrder!;
      if (byCustomOrder !== 0) return byCustomOrder;
    } else if (leftHasCustomOrder) {
      return -1;
    } else if (rightHasCustomOrder) {
      return 1;
    }

    return `${left.brand}\u0000${left.model ?? ""}\u0000${left.specification ?? ""}`.localeCompare(
      `${right.brand}\u0000${right.model ?? ""}\u0000${right.specification ?? ""}`,
      "zh-CN"
    );
  });
}

export function effectiveInventoryTransactions(
  transactions: InventoryTransaction[]
) {
  const reversedIds = new Set(
    transactions
      .filter((transaction) => transaction.type === "reverse")
      .map((transaction) => transaction.reversedTransactionId)
      .filter((id): id is string => Boolean(id))
  );
  return transactions.filter(
    (transaction) =>
      transaction.type !== "reverse" && !reversedIds.has(transaction.id)
  );
}

export function lotHasUsageRecords(
  lotId: string,
  transactions: InventoryTransaction[]
) {
  return transactions.some(
    (transaction) =>
      transaction.stockLotId === lotId &&
      (transaction.type === "activate" ||
        transaction.type === "package_open" ||
        transaction.type === "loose_allocate" ||
        transaction.type === "consume" ||
        transaction.type === "loss" ||
        transaction.type === "discard")
  );
}

export function nextInternalLotCode(
  productId: string,
  date: string,
  lots: StockLot[]
) {
  const prefix = date.replaceAll("-", "");
  const highestSuffix = lots
    .filter((lot) => lot.productId === productId)
    .map((lot) => lot.internalLotCode)
    .filter((code) => code.startsWith(`${prefix}-`))
    .map((code) => Number(code.slice(prefix.length + 1)))
    .filter((suffix) => Number.isInteger(suffix) && suffix > 0)
    .reduce((highest, suffix) => Math.max(highest, suffix), 0);
  return `${prefix}-${highestSuffix + 1}`;
}

export function productMatchesProfile(
  product: Product,
  profile: ItemProfile
) {
  return product.itemProfileId === profile.id;
}

export function availableUnits(
  lotId: string,
  transactions: InventoryTransaction[]
) {
  return effectiveInventoryTransactions(transactions)
    .filter((transaction) => transaction.stockLotId === lotId)
    .reduce((total, transaction) => total + transaction.quantityDelta, 0);
}

export function availableUnitsAtLocation(
  lot: StockLot,
  locationId: string,
  transactions: InventoryTransaction[]
) {
  return effectiveInventoryTransactions(transactions)
    .filter((transaction) => transaction.stockLotId === lot.id)
    .reduce((total, transaction) => {
      if (transaction.type === "transfer") {
        const quantity = Math.max(0, transaction.transferQuantity ?? 0);
        if (transaction.fromLocationId === locationId) total -= quantity;
        if (transaction.toLocationId === locationId) total += quantity;
        return total;
      }
      const transactionLocationId = transaction.locationId ?? lot.locationId;
      return transactionLocationId === locationId
        ? total + transaction.quantityDelta
        : total;
    }, 0);
}

export function lotLocationBalances(
  lot: StockLot,
  locationIds: string[],
  transactions: InventoryTransaction[]
) {
  return locationIds
    .map((locationId) => ({
      locationId,
      quantity: availableUnitsAtLocation(lot, locationId, transactions)
    }))
    .filter((entry) => entry.quantity > 0);
}

export function productAvailableUnits(
  productId: string,
  lots: StockLot[],
  transactions: InventoryTransaction[]
) {
  return lots
    .filter((lot) => lot.productId === productId)
    .reduce((total, lot) => total + availableUnits(lot.id, transactions), 0);
}

export function productInventoryValueMinor(
  productId: string,
  lots: StockLot[],
  transactions: InventoryTransaction[]
) {
  return lots
    .filter((lot) => lot.productId === productId)
    .reduce(
      (total, lot) =>
        total + Math.max(0, availableUnits(lot.id, transactions)) * lot.unitPriceMinor,
      0
    );
}

export function lotUnitsPerPackage(lot: StockLot, product: Product) {
  if (
    lot.unitsPerPackageAtReceipt === undefined &&
    ["soft_daily", "soft_reusable"].includes(product.standardType)
  )
    throw new Error("批次缺少收货时每包装单位数快照");
  return lot.unitsPerPackageAtReceipt ?? product.unitsPerPackage;
}

export function lotInitialPackageQuantity(lot: StockLot) {
  if (lot.initialPackageQuantity === undefined)
    throw new Error("批次缺少收货时包装数快照");
  return lot.initialPackageQuantity;
}

export function lotInitialLooseUnitQuantity(lot: StockLot) {
  if (lot.initialLooseUnitQuantity === undefined)
    throw new Error("批次缺少收货时散装单位数快照");
  return lot.initialLooseUnitQuantity;
}

export function openedPackageCount(
  lot: StockLot,
  transactions: InventoryTransaction[],
  timelineItems: TimelineItem[] = []
) {
  const explicitPackageIds = new Set(
    effectiveInventoryTransactions(transactions)
      .filter(
        (transaction) =>
          transaction.stockLotId === lot.id &&
          transaction.type === "package_open"
      )
      .map((transaction) => transaction.relatedInstanceId ?? transaction.id)
  );
  const explicitLooseIds = new Set(
    effectiveInventoryTransactions(transactions)
      .filter(
        (transaction) =>
          transaction.stockLotId === lot.id &&
          transaction.type === "loose_allocate" &&
          transaction.relatedInstanceId
      )
      .map((transaction) => transaction.relatedInstanceId!)
  );
  timelineItems
    .filter(
      (item) =>
        item.sourceStockLotId === lot.id &&
        item.inventorySourceKind !== "loose"
    )
    .forEach((item) => {
      if (!explicitLooseIds.has(item.id)) explicitPackageIds.add(item.id);
    });
  return explicitPackageIds.size;
}

export function unopenedPackageCount(
  lot: StockLot,
  product: Product,
  transactions: InventoryTransaction[],
  timelineItems: TimelineItem[] = []
) {
  return Math.max(
    0,
    lotInitialPackageQuantity(lot) -
      openedPackageCount(lot, transactions, timelineItems)
  );
}

export function allocatedLooseUnitQuantity(
  lot: StockLot,
  transactions: InventoryTransaction[],
  timelineItems: TimelineItem[] = []
) {
  const effective = effectiveInventoryTransactions(transactions);
  const explicitByInstance = new Map(
    effective
      .filter(
        (transaction) =>
          transaction.stockLotId === lot.id &&
          transaction.type === "loose_allocate" &&
          transaction.relatedInstanceId
      )
      .map((transaction) => [
        transaction.relatedInstanceId!,
        Math.max(0, transaction.allocatedUnitQuantity ?? 0)
      ])
  );
  timelineItems
    .filter(
      (item) =>
        item.sourceStockLotId === lot.id && item.inventorySourceKind === "loose"
    )
    .forEach((item) => {
      if (!explicitByInstance.has(item.id)) {
        explicitByInstance.set(item.id, item.initialUnitQuantity ?? 0);
      }
    });
  return [...explicitByInstance.values()].reduce(
    (total, quantity) => total + quantity,
    0
  );
}

export function availableLooseUnitQuantity(
  lot: StockLot,
  product: Product,
  transactions: InventoryTransaction[],
  timelineItems: TimelineItem[] = []
) {
  return Math.max(
    0,
    lotInitialLooseUnitQuantity(lot) -
      allocatedLooseUnitQuantity(lot, transactions, timelineItems)
  );
}

export function availableReusableLooseUnitQuantity(
  lot: StockLot,
  product: Product,
  transactions: InventoryTransaction[],
  timelineItems: TimelineItem[] = []
) {
  const effective = effectiveInventoryTransactions(transactions);
  const allocatedPackageRemaining = timelineItems
    .filter(
      (item) =>
        item.sourceStockLotId === lot.id &&
        item.inventorySourceKind !== "loose"
    )
    .reduce((total, item) => {
      const itemOutflow = effective
        .filter(
          (transaction) =>
            transaction.stockLotId === lot.id &&
            transaction.relatedInstanceId === item.id &&
            ["activate", "consume", "loss", "discard"].includes(
              transaction.type
            )
        )
        .reduce(
          (quantity, transaction) => quantity + transaction.quantityDelta,
          0
        );
      return (
        total +
        Math.max(
          0,
          (item.initialUnitQuantity ?? lotUnitsPerPackage(lot, product)) +
            itemOutflow
        )
      );
    }, 0);
  return Math.max(
    0,
    availableUnits(lot.id, transactions) -
      unopenedPackageCount(lot, product, transactions, timelineItems) *
        lotUnitsPerPackage(lot, product) -
      allocatedPackageRemaining
  );
}

export function allocatedDailyRemainingUnits(
  lot: StockLot,
  product: Product,
  transactions: InventoryTransaction[],
  timelineItems: TimelineItem[] = []
) {
  return Math.max(
    0,
    availableUnits(lot.id, transactions) -
      unopenedPackageCount(lot, product, transactions, timelineItems) *
        lotUnitsPerPackage(lot, product) -
      availableLooseUnitQuantity(
        lot,
        product,
        transactions,
        timelineItems
      )
  );
}

export function availableLotsByExpiry(
  product: Product,
  lots: StockLot[],
  transactions: InventoryTransaction[],
  timelineItems: TimelineItem[] = []
) {
  return lots
    .filter(
      (lot) =>
        lot.productId === product.id &&
        !lot.voidedAt &&
        (product.standardType === "soft_daily"
          ? unopenedPackageCount(lot, product, transactions, timelineItems) > 0 ||
            availableLooseUnitQuantity(
              lot,
              product,
              transactions,
              timelineItems
            ) > 0
          : product.standardType === "soft_reusable"
            ? unopenedPackageCount(
                lot,
                product,
                transactions,
                timelineItems
              ) > 0 ||
              availableReusableLooseUnitQuantity(
                lot,
                product,
                transactions,
                timelineItems
              ) > 0
          : availableUnits(lot.id, transactions) > 0)
    )
    .sort((a, b) => {
      if (a.expiryDate && b.expiryDate) {
        const byExpiry = a.expiryDate.localeCompare(b.expiryDate);
        if (byExpiry !== 0) return byExpiry;
      } else if (a.expiryDate) {
        return -1;
      } else if (b.expiryDate) {
        return 1;
      }
      return a.receivedDate.localeCompare(b.receivedDate);
    });
}

export function formatMoney(minor: number, currency = "CNY") {
  return new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency
  }).format(minor / 100);
}

export function formatUnitPrice(minor: number, currency = "CNY") {
  return new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency,
    minimumFractionDigits: 4,
    maximumFractionDigits: 4
  }).format(minor / 100);
}

export function yuanToMinor(yuan: number) {
  return Math.round(yuan * 10_000) / 100;
}
