import { beforeEach, describe, expect, it } from "vitest";
import { useInventoryStore } from "../../stores/inventoryStore";
import { useUsageFactStore } from "../../stores/usageFactStore";
import { useTimelineItemStore } from "../../stores/timelineItemStore";
import { useItemProfileStore } from "../../stores/itemProfileStore";
import { availableUnits } from "./inventory";
import {
  recordUsageFact,
  replaceUsageFact,
  reverseUsageFact,
  usedQuantityForItem
} from "./usageFacts";

describe("usage facts and inventory", () => {
  beforeEach(() => {
    useItemProfileStore.setState({
      profiles: [
        {
          id: "profile-1",
          groupId: "lenses",
          managementTemplate: "soft_daily",
          standardType: "soft_daily",
          name: "日抛",
          side: "R",
          active: true,
          order: 0
        }
      ]
    });
    useInventoryStore.setState({
      products: [
        {
          id: "product-1",
          itemProfileId: "profile-1",
          standardType: "soft_daily",
          brand: "测试",
          baseUnit: "片",
          unitsPerPackage: 30,
          active: true
        }
      ],
      locations: [
        { id: "home", name: "家", active: true, order: 0 },
        { id: "office", name: "办公室", active: true, order: 1 }
      ],
      lots: [
        {
          id: "lot-1",
          productId: "product-1",
          internalLotCode: "20260804-1",
          receivedDate: "2026-08-04",
          locationId: "home",
          initialUnitQuantity: 10,
          unitPriceMinor: 100,
          currency: "CNY"
        }
      ],
      transactions: [
        {
          id: "stock-in-1",
          stockLotId: "lot-1",
          occurredDate: "2026-08-04",
          type: "stock_in",
          quantityDelta: 10,
          locationId: "home"
        }
      ]
    });
    useTimelineItemStore.setState({
      items: [
        {
          id: "item-1",
          categoryId: "profile-1",
          groupId: "lenses",
          categoryName: "日抛",
          productId: "product-1",
          sourceStockLotId: "lot-1",
          label: "测试实例",
          detail: "",
          location: "家",
          locationId: "home",
          startDate: "2026-08-04",
          endDate: null,
          initialUnitQuantity: 10,
          inventorySourceKind: "loose",
          status: "active"
        }
      ]
    });
    useUsageFactStore.setState({ facts: [] });
  });

  it("records and reverses an immutable consumption fact", () => {
    const factId = recordUsageFact({
      itemId: "item-1",
      stockLotId: "lot-1",
      date: "2026-08-04",
      kind: "wear",
      quantity: 1
    });
    expect(availableUnits("lot-1", useInventoryStore.getState().transactions)).toBe(9);
    expect(useUsageFactStore.getState().facts).toHaveLength(1);

    reverseUsageFact(factId, "2026-08-04");
    expect(availableUnits("lot-1", useInventoryStore.getState().transactions)).toBe(10);
    expect(useUsageFactStore.getState().facts).toHaveLength(0);
    expect(useInventoryStore.getState().transactions.at(-1)).not.toHaveProperty("relatedInstanceId");
  });

  it("rejects a consumption larger than the available stock", () => {
    expect(() =>
      recordUsageFact({
        itemId: "item-1",
        stockLotId: "lot-1",
        date: "2026-08-04",
        kind: "extra_loss",
        quantity: 11
      })
    ).toThrow("来源批次库存不足");
  });

  it.each([
    [{ quantity: 0 }, "使用数量必须是正整数"],
    [{ quantity: 1.5 }, "使用数量必须是正整数"],
    [{ itemId: "missing" }, "使用实例不存在"],
    [{ stockLotId: "other" }, "使用实例与来源批次不一致"],
    [{ date: "2026-08-03" }, "使用日期不在实例生命周期内"]
  ])("rejects invalid usage input %#", (overrides, message) => {
    expect(() =>
      recordUsageFact({
        itemId: "item-1",
        stockLotId: "lot-1",
        date: "2026-08-04",
        kind: "wear",
        quantity: 1,
        ...overrides
      })
    ).toThrow(message);
    expect(useUsageFactStore.getState().facts).toEqual([]);
  });

  it("uses the instance location and rejects consumption from an empty location", () => {
    useTimelineItemStore.setState((state) => ({
      items: state.items.map((item) => ({
        ...item,
        location: "办公室",
        locationId: "office"
      }))
    }));
    expect(() =>
      recordUsageFact({
        itemId: "item-1",
        stockLotId: "lot-1",
        date: "2026-08-04",
        kind: "wear",
        quantity: 1
      })
    ).toThrow("来源批次库存不足");
  });

  it("replaces a fact atomically and keeps only the replacement effective", () => {
    const factId = recordUsageFact({
      itemId: "item-1",
      stockLotId: "lot-1",
      date: "2026-08-04",
      kind: "extra_loss",
      quantity: 2,
      reason: "破损"
    });
    replaceUsageFact(factId, {
      date: "2026-08-05",
      quantity: 3,
      reason: "遗失"
    });
    expect(availableUnits("lot-1", useInventoryStore.getState().transactions)).toBe(7);
    expect(useUsageFactStore.getState().facts[0]).toMatchObject({
      date: "2026-08-05",
      quantity: 3,
      reason: "遗失"
    });
  });

  it("rolls back a failed replacement without changing the original fact", () => {
    const factId = recordUsageFact({
      itemId: "item-1",
      stockLotId: "lot-1",
      date: "2026-08-04",
      kind: "wear",
      quantity: 1
    });
    const transactionsBefore = structuredClone(
      useInventoryStore.getState().transactions
    );
    expect(() =>
      replaceUsageFact(factId, {
        date: "2026-08-05",
        quantity: 11
      })
    ).toThrow("来源批次库存不足");
    expect(useInventoryStore.getState().transactions).toEqual(transactionsBefore);
    expect(useUsageFactStore.getState().facts[0]?.quantity).toBe(1);
  });

  it("rejects duplicate daily wear and consumption beyond the allocated instance", () => {
    useTimelineItemStore.setState((state) => ({
      items: state.items.map((item) => ({ ...item, initialUnitQuantity: 5 }))
    }));
    recordUsageFact({
      itemId: "item-1",
      stockLotId: "lot-1",
      date: "2026-08-04",
      kind: "wear",
      quantity: 1
    });
    expect(() =>
      recordUsageFact({
        itemId: "item-1",
        stockLotId: "lot-1",
        date: "2026-08-04",
        kind: "wear",
        quantity: 1
      })
    ).toThrow("同一天只能记录一次正常佩戴");
    expect(() =>
      recordUsageFact({
        itemId: "item-1",
        stockLotId: "lot-1",
        date: "2026-08-05",
        kind: "extra_loss",
        quantity: 5
      })
    ).toThrow("使用与损耗数量超过实例分配数量");
  });

  it("rejects new usage on a completed instance but allows editing its history", () => {
    const factId = recordUsageFact({
      itemId: "item-1",
      stockLotId: "lot-1",
      date: "2026-08-04",
      kind: "wear",
      quantity: 1
    });
    useTimelineItemStore.setState((state) => ({
      items: state.items.map((item) => ({
        ...item,
        status: "completed" as const,
        endDate: "2026-08-06"
      }))
    }));
    expect(() =>
      recordUsageFact({
        itemId: "item-1",
        stockLotId: "lot-1",
        date: "2026-08-05",
        kind: "wear",
        quantity: 1
      })
    ).toThrow("已经结束的实例不能新增使用记录");
    expect(() =>
      replaceUsageFact(factId, { date: "2026-08-05", quantity: 1 })
    ).not.toThrow();
  });

  it("enforces reusable-lens capacity and reports used quantity", () => {
    useItemProfileStore.setState((state) => ({ profiles: state.profiles.map((profile) => ({
      ...profile,
      managementTemplate: "soft_reusable" as const,
      standardType: "soft_reusable" as const
    })) }));
    useTimelineItemStore.setState((state) => ({ items: state.items.map((item) => ({
      ...item,
      initialUnitQuantity: 3,
      reusableLensCycles: [{
        id: "cycle-1", label: "镜片 1", startDate: "2026-08-04",
        endDate: null, predictionDate: "2026-08-18", status: "active" as const
      }]
    })) }));

    recordUsageFact({
      itemId: "item-1", stockLotId: "lot-1", date: "2026-08-04",
      kind: "extra_loss", quantity: 1
    });
    expect(usedQuantityForItem("item-1")).toBe(1);
    expect(usedQuantityForItem("missing")).toBe(0);
    expect(() => recordUsageFact({
      itemId: "item-1", stockLotId: "lot-1", date: "2026-08-05",
      kind: "extra_loss", quantity: 2
    })).toThrow("使用与损耗数量超过实例分配数量");
  });

  it("rejects reversing a fact whose transaction is already reversed", () => {
    const factId = recordUsageFact({
      itemId: "item-1", stockLotId: "lot-1", date: "2026-08-04",
      kind: "wear", quantity: 1
    });
    const fact = useUsageFactStore.getState().facts[0]!;
    useInventoryStore.getState().addTransaction({
      id: "manual-reverse", stockLotId: "lot-1", occurredDate: "2026-08-05",
      type: "reverse", quantityDelta: 1, reversedTransactionId: fact.transactionId
    });
    expect(() => reverseUsageFact(factId, "2026-08-06")).toThrow(
      "消耗记录对应的库存流水不存在或已撤销"
    );
  });

  it("uses lot-wide stock when an instance has no location snapshot", () => {
    useTimelineItemStore.setState((state) => ({ items: state.items.map((item) => {
      const next = { ...item };
      delete next.locationId;
      return next;
    }) }));
    const factId = recordUsageFact({
      itemId: "item-1", stockLotId: "lot-1", date: "2026-08-04",
      kind: "dose", quantity: 1
    });
    expect(useUsageFactStore.getState().facts[0]).toMatchObject({ id: factId, kind: "dose" });
    expect(useInventoryStore.getState().transactions.at(-1)).not.toHaveProperty("locationId");
  });

  it("rejects missing lots and missing facts", () => {
    useTimelineItemStore.setState((state) => ({ items: state.items.map((item) => ({
      ...item, sourceStockLotId: "missing"
    })) }));
    expect(() => recordUsageFact({
      itemId: "item-1", stockLotId: "missing", date: "2026-08-04",
      kind: "wear", quantity: 1
    })).toThrow("来源批次不存在");
    expect(() => reverseUsageFact("missing", "2026-08-04")).toThrow("消耗记录不存在");
    expect(() => replaceUsageFact("missing", { date: "2026-08-04", quantity: 1 }))
      .toThrow("消耗记录不存在");
  });

  it("rejects reversing or replacing facts whose persisted dependencies disappeared", () => {
    const factId = recordUsageFact({
      itemId: "item-1", stockLotId: "lot-1", date: "2026-08-04",
      kind: "wear", quantity: 1
    });
    useInventoryStore.setState({ transactions: [] });
    expect(() => reverseUsageFact(factId, "2026-08-05"))
      .toThrow("消耗记录对应的库存流水不存在或已撤销");
    expect(() => replaceUsageFact(factId, { date: "2026-08-05", quantity: 1 }))
      .toThrow("消耗记录对应的库存流水不存在");

    useInventoryStore.setState({ transactions: [{
      id: useUsageFactStore.getState().facts[0]!.transactionId,
      stockLotId: "lot-1", occurredDate: "2026-08-04", type: "consume",
      quantityDelta: -1, locationId: "home"
    }], lots: [] });
    expect(() => replaceUsageFact(factId, { date: "2026-08-05", quantity: 1 }))
      .toThrow("来源批次不存在");
  });

  it("clears a prior reason when replacing a usage fact", () => {
    const factId = recordUsageFact({
      itemId: "item-1", stockLotId: "lot-1", date: "2026-08-04",
      kind: "extra_loss", quantity: 1, reason: "破损"
    });
    replaceUsageFact(factId, { date: "2026-08-05", quantity: 1 });
    expect(useUsageFactStore.getState().facts[0]).not.toHaveProperty("reason");
  });
});
