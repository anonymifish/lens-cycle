import { beforeEach, describe, expect, it } from "vitest";
import type { AppDataSnapshot } from "./appDataSnapshot";
import {
  applyAppDataSnapshot,
  assertValidAppDataSnapshot,
  collectAppDataSnapshot,
} from "./appDataSnapshot";

function snapshot(): AppDataSnapshot {
  return {
    schemaVersion: 1,
    profiles: [
      {
        id: "profile-1",
        groupId: "lenses",
        managementTemplate: "rigid_long_term",
        standardType: "scleral",
        name: "巩膜镜（L）",
        baseUnit: "片",
        side: "L",
        active: true,
        order: 0
      }
    ],
    products: [
      {
        id: "product-1",
        itemProfileId: "profile-1",
        standardType: "scleral",
        brand: "测试",
        baseUnit: "片",
        unitsPerPackage: 1,
        active: true
      }
    ],
    locations: [{ id: "home", name: "家", active: true, order: 0 }],
    lots: [
      {
        id: "lot-1",
        productId: "product-1",
        internalLotCode: "20260825-1",
        receivedDate: "2026-08-25",
        locationId: "home",
        initialUnitQuantity: 2,
        unitPriceMinor: 10000,
        currency: "CNY"
      }
    ],
    transactions: [
      {
        id: "stock-in-1",
        stockLotId: "lot-1",
        occurredDate: "2026-08-25",
        type: "stock_in",
        quantityDelta: 2,
        locationId: "home"
      },
      {
        id: "activate-1",
        stockLotId: "lot-1",
        occurredDate: "2026-08-25",
        type: "activate",
        quantityDelta: -1,
        relatedInstanceId: "item-1",
        locationId: "home"
      }
    ],
    items: [
      {
        id: "item-1",
        categoryId: "profile-1",
        groupId: "lenses",
        categoryName: "巩膜镜（L）",
        productId: "product-1",
        sourceStockLotId: "lot-1",
        label: "镜片",
        detail: "",
        location: "家",
        locationId: "home",
        locationIntervals: [
          { locationId: "home", startDate: "2026-08-25", endDate: null }
        ],
        startDate: "2026-08-25",
        endDate: null,
        status: "active",
        stateIntervals: [
          { startDate: "2026-08-25", endDate: null, status: "active" }
        ]
      }
    ],
    usageFacts: [],
    careEvents: []
  };
}

describe("application data snapshots", () => {
  beforeEach(() => applyAppDataSnapshot(snapshot()));

  it("collects and reapplies every persisted domain collection", () => {
    const collected = collectAppDataSnapshot();
    expect(collected).toEqual(snapshot());
    applyAppDataSnapshot({ ...collected, items: [] });
    expect(collectAppDataSnapshot().items).toEqual([]);
  });

  it("rejects snapshots missing current required fields", () => {
    const invalid = snapshot();
    delete invalid.items[0]!.stateIntervals;
    expect(() => assertValidAppDataSnapshot(invalid)).toThrow("区间字段");
  });

  it("rejects malformed collections and incomplete current-format fields", () => {
    const missingCollection = snapshot() as unknown as Record<string, unknown>;
    delete missingCollection.usageFacts;
    expect(() => assertValidAppDataSnapshot(missingCollection as unknown as AppDataSnapshot)).toThrow("数据库缺少集合：usageFacts");

    const invalidRecord = snapshot() as unknown as Record<string, unknown>;
    invalidRecord.careEvents = [{}];
    expect(() => assertValidAppDataSnapshot(invalidRecord as unknown as AppDataSnapshot)).toThrow("数据库集合 careEvents 包含无效记录");

    const missingBaseUnit = snapshot() as unknown as Record<string, unknown>;
    delete (missingBaseUnit.profiles as Array<Record<string, unknown>>)[0]!.baseUnit;
    expect(() => assertValidAppDataSnapshot(missingBaseUnit as unknown as AppDataSnapshot)).toThrow("用品配置缺少当前格式必需的 baseUnit");

    const missingProfileLink = snapshot() as unknown as Record<string, unknown>;
    delete (missingProfileLink.products as Array<Record<string, unknown>>)[0]!.itemProfileId;
    expect(() => assertValidAppDataSnapshot(missingProfileLink as unknown as AppDataSnapshot)).toThrow("产品缺少当前格式必需的 itemProfileId");

    const incompleteVoid = snapshot() as unknown as Record<string, unknown>;
    (incompleteVoid.lots as Array<Record<string, unknown>>)[0]!.voidedAt = "2026-09-06";
    expect(() => assertValidAppDataSnapshot(incompleteVoid as unknown as AppDataSnapshot)).toThrow("库存批次作废信息不完整");
  });

  it("rejects future schema versions and invalid foreign keys", () => {
    expect(() =>
      assertValidAppDataSnapshot({ ...snapshot(), schemaVersion: 99 })
    ).toThrow("必须精确等于");
    const broken = snapshot();
    broken.lots[0]!.productId = "missing";
    expect(() => assertValidAppDataSnapshot(broken)).toThrow(
      "数据完整性检查失败"
    );
  });
});
