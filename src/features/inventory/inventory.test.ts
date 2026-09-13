import { describe, expect, it } from "vitest";
import {
  allocatedDailyRemainingUnits,
  allocatedLooseUnitQuantity,
  availableLooseUnitQuantity,
  availableLotsByExpiry,
  availableReusableLooseUnitQuantity,
  availableUnits,
  availableUnitsAtLocation,
  effectiveInventoryTransactions,
  formatUnitPrice,
  lotHasUsageRecords,
  lotInitialLooseUnitQuantity,
  lotInitialPackageQuantity,
  lotLocationBalances,
  lotUnitsPerPackage,
  nextInternalLotCode,
  openedPackageCount,
  productMatchesProfile,
  productAvailableUnits,
  productInventoryValueMinor,
  sortProductsByProfileOrder,
  unopenedPackageCount,
  yuanTextToMinor
} from "./inventory";
import type { ItemProfile } from "../catalog/catalog.types";
import type {
  InventoryTransaction,
  Product,
  StockLot
} from "./inventory.types";

const product: Product = {
  id: "p1",
  itemProfileId: "profile-plunger",
  standardType: "lens_applicator",
  brand: "A",
  baseUnit: "个",
  unitsPerPackage: 1,
  active: true
};

describe("unit prices", () => {
  it("converts and formats yuan prices to four decimal places", () => {
    const minor = yuanTextToMinor("12.3456");
    expect(minor).toBe(123456);
    expect(formatUnitPrice(minor)).toContain("12.3456");
  });

  it("parses four decimal places without persisting a floating-point amount", () => {
    expect(yuanTextToMinor("0")).toBe(0);
    expect(yuanTextToMinor("12.3456")).toBe(123456);
    expect(yuanTextToMinor("12.34")).toBe(123400);
    expect(yuanTextToMinor("12.3400")).toBe(123400);
    expect(yuanTextToMinor("900719925474.0991")).toBe(Number.MAX_SAFE_INTEGER);
    expect(() => yuanTextToMinor("12.34567")).toThrow("最多支持 4 位小数");
    expect(() => yuanTextToMinor("-1")).toThrow("最多支持 4 位小数");
    expect(() => yuanTextToMinor("900719925474.0992")).toThrow("超出支持范围");
  });
});

describe("inventory product ordering", () => {
  it("follows the timeline profile group and item order", () => {
    const profiles: ItemProfile[] = [
      {
        id: "periodic-first",
        groupId: "periodic",
        managementTemplate: "lens_case",
        standardType: "lens_case",
        name: "镜盒",
        active: true,
        order: 0
      },
      {
        id: "lens-second",
        groupId: "lenses",
        managementTemplate: "rigid_long_term",
        standardType: "rgp",
        name: "第二项",
        active: true,
        order: 1
      },
      {
        id: "lens-first",
        groupId: "lenses",
        managementTemplate: "rigid_long_term",
        standardType: "ortho_k",
        name: "第一项",
        active: true,
        order: 0
      }
    ];
    const unordered: Product[] = [
      { ...product, id: "periodic", itemProfileId: "periodic-first" },
      { ...product, id: "second", itemProfileId: "lens-second" },
      {
        ...product,
        id: "first-b",
        itemProfileId: "lens-first",
        brand: "B",
        sortOrder: 0
      },
      {
        ...product,
        id: "first-a",
        itemProfileId: "lens-first",
        brand: "A",
        sortOrder: 1
      }
    ];

    expect(sortProductsByProfileOrder(unordered, profiles).map(({ id }) => id)).toEqual([
      "first-b",
      "first-a",
      "second",
      "periodic"
    ]);
  });
});

const lots: StockLot[] = [
  {
    id: "later",
    productId: "p1",
    internalLotCode: "20260101-1",
    receivedDate: "2026-01-01",
    expiryDate: "2028-01-01",
    locationId: "home",
    initialUnitQuantity: 2,
    unitPriceMinor: 1200,
    currency: "CNY"
  },
  {
    id: "earlier",
    productId: "p1",
    internalLotCode: "20260201-1",
    receivedDate: "2026-02-01",
    expiryDate: "2027-01-01",
    locationId: "home",
    initialUnitQuantity: 3,
    unitPriceMinor: 1000,
    currency: "CNY"
  }
];

const transactions: InventoryTransaction[] = [
  {
    id: "t1",
    stockLotId: "later",
    occurredDate: "2026-01-01",
    type: "stock_in",
    quantityDelta: 2
  },
  {
    id: "t2",
    stockLotId: "earlier",
    occurredDate: "2026-02-01",
    type: "stock_in",
    quantityDelta: 3
  },
  {
    id: "t3",
    stockLotId: "earlier",
    occurredDate: "2026-03-01",
    type: "activate",
    quantityDelta: -1
  }
];

describe("inventory calculations", () => {
  it("derives available units from immutable transactions", () => {
    expect(availableUnits("earlier", transactions)).toBe(2);
  });

  it("selects the earliest expiring available lot first", () => {
    expect(availableLotsByExpiry(product, lots, transactions)[0]?.id).toBe(
      "earlier"
    );
  });

  it("never offers a voided lot for allocation", () => {
    const voidedLots = lots.map((lot) => lot.id === "earlier"
      ? { ...lot, voidedAt: "2026-09-06" as const, voidedByTransactionId: "reverse-earlier" }
      : lot);
    expect(availableLotsByExpiry(product, voidedLots, transactions)[0]?.id).toBe("later");
  });

  it("uses each lot price to value remaining stock", () => {
    expect(productInventoryValueMinor("p1", lots, transactions)).toBe(4400);
  });

  it("matches a new product only to the selected timeline configuration", () => {
    const selectedProfile: ItemProfile = {
      id: "profile-a",
      groupId: "periodic",
      managementTemplate: "lens_accessory",
      standardType: "lens_applicator",
      name: "摘戴吸棒",
      active: true,
      order: 0
    };
    const otherProfile = { ...selectedProfile, id: "profile-b", order: 1 };
    const linkedProduct = { ...product, itemProfileId: selectedProfile.id };

    expect(productMatchesProfile(linkedProduct, selectedProfile)).toBe(true);
    expect(productMatchesProfile(linkedProduct, otherProfile)).toBe(false);
  });

  it("does not guess a profile from the product standard type", () => {
    const profile: ItemProfile = {
      id: "profile-a",
      groupId: "periodic",
      managementTemplate: "lens_accessory",
      standardType: "lens_applicator",
      name: "摘戴吸棒",
      active: true,
      order: 0
    };

    expect(productMatchesProfile(product, profile)).toBe(false);
  });

  it("uses the replacement activation after an immutable reversal", () => {
    const rescheduled: InventoryTransaction[] = [
      ...transactions,
      {
        id: "reverse-t3",
        stockLotId: "earlier",
        occurredDate: "2026-03-03",
        type: "reverse",
        quantityDelta: 1,
        reversedTransactionId: "t3"
      },
      {
        id: "t4",
        stockLotId: "earlier",
        occurredDate: "2026-03-03",
        type: "activate",
        quantityDelta: -1
      }
    ];

    expect(availableUnits("earlier", rescheduled)).toBe(2);
    expect(
      effectiveInventoryTransactions(rescheduled).some(
        (transaction) => transaction.id === "t3"
      )
    ).toBe(false);
    expect(
      effectiveInventoryTransactions(rescheduled).some(
        (transaction) => transaction.id === "t4"
      )
    ).toBe(true);
  });

  it("allows adjusted lots to be voided until a usage fact exists", () => {
    const adjusted: InventoryTransaction[] = [
      transactions[0]!,
      {
        id: "correction-1",
        stockLotId: "later",
        occurredDate: "2026-02-01",
        type: "correction",
        quantityDelta: 1
      }
    ];

    expect(lotHasUsageRecords("later", adjusted)).toBe(false);
    expect(
      lotHasUsageRecords("later", [
        ...adjusted,
        {
          id: "consume-1",
          stockLotId: "later",
          occurredDate: "2026-02-02",
          type: "consume",
          quantityDelta: -1
        }
      ])
    ).toBe(true);
    expect(
      lotHasUsageRecords("later", [
        ...adjusted,
        {
          id: "consume-1",
          stockLotId: "later",
          occurredDate: "2026-02-02",
          type: "consume",
          quantityDelta: -1
        },
        {
          id: "reverse-consume-1",
          stockLotId: "later",
          occurredDate: "2026-02-03",
          type: "reverse",
          quantityDelta: 1,
          reversedTransactionId: "consume-1"
        }
      ])
    ).toBe(true);
  });

  it("generates the next product-local system lot code", () => {
    expect(nextInternalLotCode("p1", "2026-02-01", lots)).toBe(
      "20260201-2"
    );
    expect(nextInternalLotCode("other", "2026-02-01", lots)).toBe(
      "20260201-1"
    );
  });

  it("rejects a packaged lot without receipt-time packaging snapshots", () => {
    const dailyProduct: Product = {
      id: "daily-product",
      itemProfileId: "soft-daily",
      standardType: "soft_daily",
      brand: "Daily",
      baseUnit: "片",
      unitsPerPackage: 30,
      active: true
    };
    const dailyLot: StockLot = {
      id: "daily-lot",
      productId: dailyProduct.id,
      internalLotCode: "20260817-1",
      receivedDate: "2026-08-17",
      locationId: "home",
      initialUnitQuantity: 30,
      unitPriceMinor: 100,
      currency: "CNY"
    };
    const dailyTransactions: InventoryTransaction[] = [
      {
        id: "daily-stock-in",
        stockLotId: dailyLot.id,
        occurredDate: "2026-08-17",
        type: "stock_in",
        quantityDelta: 30
      },
      {
        id: "daily-open",
        stockLotId: dailyLot.id,
        occurredDate: "2026-08-17",
        type: "package_open",
        quantityDelta: 0,
        allocatedUnitQuantity: 30,
        relatedInstanceId: "daily-instance"
      }
    ];

    expect(() =>
      unopenedPackageCount(dailyLot, dailyProduct, dailyTransactions)
    ).toThrow("快照");
  });

  it("keeps loose daily units separate from unopened packages", () => {
    const dailyProduct: Product = {
      id: "daily-product",
      itemProfileId: "soft-daily",
      standardType: "soft_daily",
      brand: "Daily",
      baseUnit: "片",
      unitsPerPackage: 30,
      active: true
    };
    const dailyLot: StockLot = {
      id: "daily-lot",
      productId: dailyProduct.id,
      internalLotCode: "20260817-1",
      receivedDate: "2026-08-17",
      locationId: "home",
      initialUnitQuantity: 35,
      initialPackageQuantity: 1,
      initialLooseUnitQuantity: 5,
      unitsPerPackageAtReceipt: 30,
      unitPriceMinor: 100,
      currency: "CNY"
    };
    const dailyTransactions: InventoryTransaction[] = [
      {
        id: "daily-stock-in",
        stockLotId: dailyLot.id,
        occurredDate: "2026-08-17",
        type: "stock_in",
        quantityDelta: 35
      },
      {
        id: "daily-loose-allocation",
        stockLotId: dailyLot.id,
        occurredDate: "2026-08-17",
        type: "loose_allocate",
        quantityDelta: 0,
        allocatedUnitQuantity: 3,
        relatedInstanceId: "loose-instance"
      }
    ];

    expect(
      unopenedPackageCount(dailyLot, dailyProduct, dailyTransactions)
    ).toBe(1);
    expect(
      availableLooseUnitQuantity(
        dailyLot,
        dailyProduct,
        dailyTransactions
      )
    ).toBe(2);
    expect(
      allocatedDailyRemainingUnits(
        dailyLot,
        dailyProduct,
        dailyTransactions
      )
    ).toBe(3);
  });
});

describe("location balances", () => {
  it("moves quantity between locations without changing total stock", () => {
    const lot: StockLot = {
      id: "lot-location",
      productId: "p1",
      internalLotCode: "20260801-1",
      receivedDate: "2026-08-01",
      locationId: "home",
      initialUnitQuantity: 10,
      unitPriceMinor: 100,
      currency: "CNY"
    };
    const transactions: InventoryTransaction[] = [
      {
        id: "in",
        stockLotId: lot.id,
        occurredDate: "2026-08-01",
        type: "stock_in",
        quantityDelta: 10,
        locationId: "home"
      },
      {
        id: "move",
        stockLotId: lot.id,
        occurredDate: "2026-08-02",
        type: "transfer",
        quantityDelta: 0,
        fromLocationId: "home",
        toLocationId: "office",
        transferQuantity: 4
      }
    ];
    expect(availableUnitsAtLocation(lot, "home", transactions)).toBe(6);
    expect(availableUnitsAtLocation(lot, "office", transactions)).toBe(4);
    expect(availableUnits(lot.id, transactions)).toBe(10);
  });

  it("tracks chained transfers and location-specific consumption", () => {
    const lot: StockLot = {
      id: "lot-location",
      productId: "p1",
      internalLotCode: "20260801-1",
      receivedDate: "2026-08-01",
      locationId: "home",
      initialUnitQuantity: 10,
      unitPriceMinor: 100,
      currency: "CNY"
    };
    const movement: InventoryTransaction[] = [
      {
        id: "in",
        stockLotId: lot.id,
        occurredDate: "2026-08-01",
        type: "stock_in",
        quantityDelta: 10,
        locationId: "home"
      },
      {
        id: "home-office",
        stockLotId: lot.id,
        occurredDate: "2026-08-02",
        type: "transfer",
        quantityDelta: 0,
        fromLocationId: "home",
        toLocationId: "office",
        transferQuantity: 6
      },
      {
        id: "office-carry",
        stockLotId: lot.id,
        occurredDate: "2026-08-03",
        type: "transfer",
        quantityDelta: 0,
        fromLocationId: "office",
        toLocationId: "carry",
        transferQuantity: 2
      },
      {
        id: "consume-office",
        stockLotId: lot.id,
        occurredDate: "2026-08-04",
        type: "consume",
        quantityDelta: -1,
        locationId: "office"
      }
    ];

    expect(availableUnitsAtLocation(lot, "home", movement)).toBe(4);
    expect(availableUnitsAtLocation(lot, "office", movement)).toBe(3);
    expect(availableUnitsAtLocation(lot, "carry", movement)).toBe(2);
    expect(availableUnits(lot.id, movement)).toBe(9);
  });

  it("restores both sides when a transfer is reversed", () => {
    const lot: StockLot = {
      id: "lot-location",
      productId: "p1",
      internalLotCode: "20260801-1",
      receivedDate: "2026-08-01",
      locationId: "home",
      initialUnitQuantity: 10,
      unitPriceMinor: 100,
      currency: "CNY"
    };
    const movement: InventoryTransaction[] = [
      {
        id: "in",
        stockLotId: lot.id,
        occurredDate: "2026-08-01",
        type: "stock_in",
        quantityDelta: 10,
        locationId: "home"
      },
      {
        id: "move",
        stockLotId: lot.id,
        occurredDate: "2026-08-02",
        type: "transfer",
        quantityDelta: 0,
        fromLocationId: "home",
        toLocationId: "office",
        transferQuantity: 4
      },
      {
        id: "reverse-move",
        stockLotId: lot.id,
        occurredDate: "2026-08-03",
        type: "reverse",
        quantityDelta: 0,
        reversedTransactionId: "move"
      }
    ];

    expect(availableUnitsAtLocation(lot, "home", movement)).toBe(10);
    expect(availableUnitsAtLocation(lot, "office", movement)).toBe(0);
    expect(availableUnits(lot.id, movement)).toBe(10);
  });
});

describe("inventory calculation edge branches", () => {
  const packagedProduct: Product = {
    id: "packaged", itemProfileId: "daily", standardType: "soft_daily",
    brand: "Daily", baseUnit: "片", unitsPerPackage: 6, active: true
  };
  const packagedLot: StockLot = {
    id: "packaged-lot", productId: "packaged", internalLotCode: "20260901-1",
    receivedDate: "2026-09-01", locationId: "home", initialUnitQuantity: 14,
    initialPackageQuantity: 2, initialLooseUnitQuantity: 2,
    unitsPerPackageAtReceipt: 6, unitPriceMinor: 1400, currency: "CNY"
  };
  const stockIn: InventoryTransaction = {
    id: "stock", stockLotId: packagedLot.id, occurredDate: "2026-09-01",
    type: "stock_in", quantityDelta: 14, locationId: "home"
  };

  it("sorts linked and unlinked products through every fallback ordering tier", () => {
    const profiles: ItemProfile[] = [{
      id: "linked", groupId: "lenses", managementTemplate: "rigid_long_term",
      standardType: "scleral", name: "镜片", active: true, order: 0
    }];
    const sorted = sortProductsByProfileOrder([
      { ...product, id: "z-unlinked", itemProfileId: "missing", brand: "Z" },
      { ...product, id: "linked-b", itemProfileId: "linked", brand: "B", sortOrder: 1 },
      { ...product, id: "linked-a", itemProfileId: "linked", brand: "A", sortOrder: 0 },
      { ...product, id: "a-unlinked", itemProfileId: "missing", brand: "A", model: "M", specification: "S" }
    ], profiles);
    expect(sorted.map((entry) => entry.id)).toEqual([
      "linked-a", "linked-b", "a-unlinked", "z-unlinked"
    ]);
  });

  it.each(["activate", "package_open", "loose_allocate", "consume", "loss", "discard"] as const)(
    "recognizes %s as a lot usage record",
    (type) => expect(lotHasUsageRecords("lot", [{
      id: type, stockLotId: "lot", occurredDate: "2026-09-01", type,
      quantityDelta: type === "activate" ? -1 : 0
    }])).toBe(true)
  );

  it("ignores malformed reversal references and invalid lot-code suffixes", () => {
    const entries: InventoryTransaction[] = [
      stockIn,
      { id: "reverse", stockLotId: packagedLot.id, occurredDate: "2026-09-02", type: "reverse", quantityDelta: 0 }
    ];
    expect(effectiveInventoryTransactions(entries).map((entry) => entry.id)).toEqual(["stock"]);
    expect(nextInternalLotCode("packaged", "2026-09-01", [
      packagedLot,
      { ...packagedLot, id: "bad", internalLotCode: "20260901-X" },
      { ...packagedLot, id: "zero", internalLotCode: "20260901-0" }
    ])).toBe("20260901-2");
  });

  it("uses lot location fallbacks, ignores negative transfer sizes, and filters zero balances", () => {
    const entries: InventoryTransaction[] = [
      { ...stockIn, locationId: undefined as never },
      { id: "bad-transfer", stockLotId: packagedLot.id, occurredDate: "2026-09-02",
        type: "transfer", quantityDelta: 0, fromLocationId: "home", toLocationId: "office", transferQuantity: -2 },
      { id: "other", stockLotId: "other", occurredDate: "2026-09-02",
        type: "consume", quantityDelta: -5, locationId: "home" }
    ];
    expect(availableUnitsAtLocation(packagedLot, "home", entries)).toBe(14);
    expect(lotLocationBalances(packagedLot, ["home", "office"], entries)).toEqual([
      { locationId: "home", quantity: 14 }
    ]);
    expect(productAvailableUnits("packaged", [packagedLot], entries)).toBe(14);
  });

  it("validates and falls back across packaging snapshots", () => {
    expect(lotUnitsPerPackage(packagedLot, packagedProduct)).toBe(6);
    expect(lotInitialPackageQuantity(packagedLot)).toBe(2);
    expect(lotInitialLooseUnitQuantity(packagedLot)).toBe(2);
    expect(lotUnitsPerPackage({ ...packagedLot, unitsPerPackageAtReceipt: undefined as never }, {
      ...packagedProduct, standardType: "saline"
    })).toBe(6);
    expect(() => lotInitialPackageQuantity({ ...packagedLot, initialPackageQuantity: undefined as never }))
      .toThrow("包装数快照");
    expect(() => lotInitialLooseUnitQuantity({ ...packagedLot, initialLooseUnitQuantity: undefined as never }))
      .toThrow("散装单位数快照");
  });

  it("deduplicates explicit and inferred package and loose allocations", () => {
    const entries: InventoryTransaction[] = [stockIn, {
      id: "open", stockLotId: packagedLot.id, occurredDate: "2026-09-02",
      type: "package_open", quantityDelta: 0, relatedInstanceId: "package-item"
    }, {
      id: "loose", stockLotId: packagedLot.id, occurredDate: "2026-09-02",
      type: "loose_allocate", quantityDelta: 0, relatedInstanceId: "loose-item",
      allocatedUnitQuantity: -3
    }];
    const items = [{
      id: "package-item", categoryId: "daily", groupId: "lenses" as const,
      categoryName: "日抛", label: "整盒", detail: "", location: "家",
      sourceStockLotId: packagedLot.id, inventorySourceKind: "package" as const,
      initialUnitQuantity: 6, startDate: "2026-09-02", endDate: null, status: "active" as const
    }, {
      id: "loose-item", categoryId: "daily", groupId: "lenses" as const,
      categoryName: "日抛", label: "散片", detail: "", location: "家",
      sourceStockLotId: packagedLot.id, inventorySourceKind: "loose" as const,
      initialUnitQuantity: 2, startDate: "2026-09-02", endDate: null, status: "active" as const
    }, {
      id: "inferred", categoryId: "daily", groupId: "lenses" as const,
      categoryName: "日抛", label: "推断整盒", detail: "", location: "家",
      sourceStockLotId: packagedLot.id, initialUnitQuantity: 6,
      startDate: "2026-09-02", endDate: null, status: "active" as const
    }];
    expect(openedPackageCount(packagedLot, entries, items)).toBe(2);
    expect(allocatedLooseUnitQuantity(packagedLot, entries, items)).toBe(0);
  });

  it("calculates reusable loose remainder from active package outflows", () => {
    const reusable = { ...packagedProduct, standardType: "soft_reusable" as const };
    const entries: InventoryTransaction[] = [stockIn, {
      id: "open", stockLotId: packagedLot.id, occurredDate: "2026-09-02",
      type: "package_open", quantityDelta: 0, relatedInstanceId: "box"
    }, {
      id: "activate", stockLotId: packagedLot.id, occurredDate: "2026-09-02",
      type: "activate", quantityDelta: -1, relatedInstanceId: "box"
    }];
    const box = [{
      id: "box", categoryId: "reusable", groupId: "lenses" as const,
      categoryName: "复用软镜", label: "一盒", detail: "", location: "家",
      sourceStockLotId: packagedLot.id, inventorySourceKind: "package" as const,
      startDate: "2026-09-02", endDate: null, status: "active" as const
    }];
    expect(availableReusableLooseUnitQuantity(packagedLot, reusable, entries, box)).toBe(2);
  });

  it("orders available lots with missing expiry dates after expiring lots", () => {
    const noExpiry = { ...packagedLot, id: "no-expiry", expiryDate: undefined as never, receivedDate: "2026-08-01" as const };
    const expiring = { ...packagedLot, id: "expiring", expiryDate: "2027-01-01" as const };
    const entries = [
      { ...stockIn, id: "a", stockLotId: noExpiry.id },
      { ...stockIn, id: "b", stockLotId: expiring.id }
    ];
    expect(availableLotsByExpiry(packagedProduct, [noExpiry, expiring], entries).map((entry) => entry.id))
      .toEqual(["expiring", "no-expiry"]);
  });
});
