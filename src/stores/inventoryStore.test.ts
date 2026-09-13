import { beforeEach, describe, expect, it } from "vitest";
import { availableUnits, availableUnitsAtLocation } from "../features/inventory/inventory";
import { useInventoryStore } from "./inventoryStore";
import { useTimelineItemStore } from "./timelineItemStore";

const product = {
  id: "product-1",
  itemProfileId: "profile-1",
  standardType: "soft_daily" as const,
  brand: "测试日抛",
  baseUnit: "片",
  unitsPerPackage: 30,
  active: true
};

describe("inventory store invariants", () => {
  beforeEach(() => {
    useInventoryStore.setState({
      products: [product],
      locations: [
        { id: "home", name: "家", active: true, order: 0 },
        { id: "office", name: "办公室", active: true, order: 1 }
      ],
      lots: [],
      transactions: []
    });
    useTimelineItemStore.setState({ items: [] });
  });

  function receive(overrides: Record<string, unknown> = {}) {
    return useInventoryStore.getState().receiveStock({
      productId: "product-1",
      internalLotCode: "20260825-1",
      receivedDate: "2026-08-25",
      locationId: "home",
      quantity: 32,
      packageQuantity: 1,
      looseUnitQuantity: 2,
      unitsPerPackageAtReceipt: 30,
      unitPriceMinor: 500,
      ...overrides
    });
  }

  it("creates one balanced lot and one location-aware stock-in transaction", () => {
    const lotId = receive();
    const state = useInventoryStore.getState();

    expect(state.lots).toHaveLength(1);
    expect(state.transactions).toHaveLength(1);
    expect(state.transactions[0]).toMatchObject({
      stockLotId: lotId,
      type: "stock_in",
      quantityDelta: 32,
      locationId: "home"
    });
    expect(availableUnits(lotId, state.transactions)).toBe(32);
  });

  it.each([
    [{ productId: "missing" }, "入库产品不存在"],
    [{ locationId: "missing" }, "入库地点不可用"],
    [{ quantity: 0 }, "入库数量必须是正整数"],
    [{ quantity: 1.5 }, "入库数量必须是正整数"],
    [{ unitPriceMinor: -1 }, "单位价格必须是非负数"],
    [{ expectedUsageDays: 0 }, "预计使用时长必须是正整数"],
    [
      { manufacturedDate: "2026-09-01", expiryDate: "2026-08-31" },
      "预计到期日期不能早于生产日期"
    ],
    [
      { packageQuantity: 1, looseUnitQuantity: 1, quantity: 32 },
      "盒数、散片数与基础单位总数不一致"
    ]
  ])("rejects invalid stock receipt %#", (overrides, message) => {
    expect(() => receive(overrides)).toThrow(message);
    expect(useInventoryStore.getState().lots).toEqual([]);
    expect(useInventoryStore.getState().transactions).toEqual([]);
  });

  it("preserves prices with four decimal places in yuan", () => {
    receive({ unitPriceMinor: 123456 });
    expect(useInventoryStore.getState().lots[0]?.unitPriceMinor).toBe(123456);
  });

  it("corrects the original receipt location and its stock-in transaction", () => {
    const lotId = receive();
    useInventoryStore.getState().updateStockLot(lotId, {
      internalLotCode: "20260825-1",
      receivedDate: "2026-08-25",
      locationId: "office",
      quantity: 32,
      packageQuantity: 1,
      looseUnitQuantity: 2,
      unitsPerPackageAtReceipt: 30,
      unitPriceMinor: 500
    });

    const state = useInventoryStore.getState();
    const lot = state.lots[0]!;
    expect(lot.locationId).toBe("office");
    expect(availableUnitsAtLocation(lot, "home", state.transactions)).toBe(0);
    expect(availableUnitsAtLocation(lot, "office", state.transactions)).toBe(32);
  });

  it("rejects receipt-location corrections that invalidate later movements", () => {
    const lotId = receive();
    useInventoryStore.getState().transferStock({
      stockLotId: lotId,
      fromLocationId: "home",
      toLocationId: "office",
      quantity: 1,
      occurredDate: "2026-08-26"
    });

    expect(() =>
      useInventoryStore.getState().updateStockLot(lotId, {
        internalLotCode: "20260825-1",
        receivedDate: "2026-08-25",
        locationId: "office",
        quantity: 32,
        packageQuantity: 1,
        looseUnitQuantity: 2,
        unitsPerPackageAtReceipt: 30,
        unitPriceMinor: 500
      })
    ).toThrow("更正入库地点后会使后续库存流水出现负数");
  });

  it("moves products only within the same item profile", () => {
    useInventoryStore.setState({
      products: [
        { ...product, id: "product-b", brand: "B" },
        { ...product, id: "product-a", brand: "A" }
      ]
    });

    useInventoryStore.getState().moveProduct("product-b", -1);
    const products = [...useInventoryStore.getState().products].sort(
      (left, right) => left.sortOrder! - right.sortOrder!
    );

    expect(products.map(({ id }) => id)).toEqual(["product-b", "product-a"]);
    expect(products.map(({ sortOrder }) => sortOrder)).toEqual([0, 1]);
  });

  it("creates, normalizes, updates, and conditionally deletes products", () => {
    useInventoryStore.setState({
      products: [{ ...product, sortOrder: 3 }]
    });
    const store = useInventoryStore.getState();
    const id = store.addProduct({
      itemProfileId: "profile-1",
      standardType: "soft_daily",
      brand: "新增品牌",
      model: "M1",
      specification: "30 片",
      baseUnit: "片",
      unitsPerPackage: 30,
      defaultDurationDays: 1
    });
    expect(useInventoryStore.getState().products.find((entry) => entry.id === id)).toMatchObject({
      active: true,
      sortOrder: 4
    });

    store.updateProduct(id, {
      brand: "  更新品牌  ",
      model: " ",
      specification: " 新规格 ",
      capacityMl: 120,
      unitsPerPackage: 6,
      defaultDurationDays: 14
    });
    store.updateProductsForProfile("profile-1", "soft_reusable", "副");
    store.updateProductDuration(id, 21);
    store.updateProductUnitsPerPackage(id, 12);
    expect(useInventoryStore.getState().products.find((entry) => entry.id === id)).toMatchObject({
      brand: "更新品牌",
      specification: "新规格",
      capacityMl: 120,
      standardType: "soft_reusable",
      baseUnit: "副",
      unitsPerPackage: 12,
      defaultDurationDays: 21
    });
    expect(useInventoryStore.getState().products.find((entry) => entry.id === id)).not.toHaveProperty("model");

    store.updateProduct(id, {
      brand: "保留",
      unitsPerPackage: 1
    });
    expect(useInventoryStore.getState().products.find((entry) => entry.id === id)).not.toHaveProperty("specification");
    expect(useInventoryStore.getState().products.find((entry) => entry.id === id)).not.toHaveProperty("capacityMl");
    expect(useInventoryStore.getState().products.find((entry) => entry.id === id)).not.toHaveProperty("defaultDurationDays");

    useInventoryStore.setState((state) => ({
      lots: [{
        id: "lot-protected", productId: id, internalLotCode: "protected",
        receivedDate: "2026-08-01", locationId: "home", initialUnitQuantity: 1,
        unitPriceMinor: 100, currency: "CNY"
      }],
      products: state.products
    }));
    store.deleteProduct(id);
    expect(useInventoryStore.getState().products.some((entry) => entry.id === id)).toBe(true);
    useInventoryStore.setState({ lots: [] });
    store.deleteProduct(id);
    expect(useInventoryStore.getState().products.some((entry) => entry.id === id)).toBe(false);

    const before = useInventoryStore.getState().products;
    store.moveProduct("missing", 1);
    store.moveProduct("product-1", -1);
    expect(useInventoryStore.getState().products).toEqual(before);
  });

  it("reschedules and reverses only eligible, unreversed activation flows", () => {
    useInventoryStore.setState({
      transactions: [
        { id: "activate", stockLotId: "lot-1", occurredDate: "2026-08-01", type: "activate", quantityDelta: -1, relatedInstanceId: "item-1", reversibleWithInstance: true },
        { id: "open", stockLotId: "lot-1", occurredDate: "2026-08-01", type: "package_open", quantityDelta: -30, relatedInstanceId: "item-1", reversibleWithInstance: true },
        { id: "allocate", stockLotId: "lot-1", occurredDate: "2026-08-01", type: "loose_allocate", quantityDelta: 29, relatedInstanceId: "item-1", reversibleWithInstance: true },
        { id: "fixed", stockLotId: "lot-1", occurredDate: "2026-08-01", type: "activate", quantityDelta: -1, relatedInstanceId: "item-1", reversibleWithInstance: false },
        { id: "old", stockLotId: "lot-1", occurredDate: "2026-07-01", type: "activate", quantityDelta: -1, relatedInstanceId: "item-1", reversibleWithInstance: true },
        { id: "old-reverse", stockLotId: "lot-1", occurredDate: "2026-07-02", type: "reverse", quantityDelta: 1, reversedTransactionId: "old" }
      ]
    });

    const store = useInventoryStore.getState();
    store.rescheduleActivation("item-1", "2026-08-10");
    let transactions = useInventoryStore.getState().transactions;
    expect(transactions).toHaveLength(12);
    expect(transactions.slice(-6).filter((entry) => entry.type === "reverse")).toHaveLength(3);
    expect(transactions.slice(-6).filter((entry) => entry.type !== "reverse").every((entry) => entry.occurredDate === "2026-08-10")).toBe(true);
    const rescheduledIds = transactions
      .slice(-6)
      .filter((entry) => entry.type !== "reverse")
      .map((entry) => entry.id);

    store.rescheduleActivation("item-1", "2026-08-10");
    expect(useInventoryStore.getState().transactions).toHaveLength(12);
    store.reverseActivation("item-1", "2026-08-11");
    transactions = useInventoryStore.getState().transactions;
    expect(transactions.slice(-3).map((entry) => entry.type)).toEqual(["reverse", "reverse", "reverse"]);
    expect(transactions.slice(-3).map((entry) => entry.reversedTransactionId)).toEqual(
      expect.arrayContaining(rescheduledIds)
    );
    expect(transactions.slice(-3).every((entry) => entry.relatedInstanceId === undefined)).toBe(true);
    expect(() => store.reverseActivation("item-1", "2026-08-12")).toThrow(
      "未找到可撤销的实例启用流水"
    );
    expect(() => store.reverseActivation("missing", "2026-08-12")).toThrow(
      "未找到可撤销的实例启用流水"
    );
  });

  it("treats product-local lot codes as case-insensitively unique", () => {
    receive({ internalLotCode: "Lot-A" });
    expect(() => receive({ internalLotCode: "lot-a" })).toThrow(
      "同一产品的系统批号不能重复"
    );
  });

  it("moves only integer quantities and preserves total stock", () => {
    const lotId = receive();
    const store = useInventoryStore.getState();
    store.transferStock({
      stockLotId: lotId,
      fromLocationId: "home",
      toLocationId: "office",
      quantity: 12,
      occurredDate: "2026-08-26"
    });
    const state = useInventoryStore.getState();
    const lot = state.lots[0]!;
    expect(availableUnits(lotId, state.transactions)).toBe(32);
    expect(availableUnitsAtLocation(lot, "home", state.transactions)).toBe(20);
    expect(availableUnitsAtLocation(lot, "office", state.transactions)).toBe(12);
    expect(() =>
      state.transferStock({
        stockLotId: lotId,
        fromLocationId: "home",
        toLocationId: "office",
        quantity: 0.5,
        occurredDate: "2026-08-27"
      })
    ).toThrow("转移数量必须是正整数");
  });

  it("rejects same-location, unavailable-target, and overdrawn transfers", () => {
    const lotId = receive();
    const transfer = useInventoryStore.getState().transferStock;
    const base = {
      stockLotId: lotId,
      fromLocationId: "home",
      toLocationId: "office",
      quantity: 1,
      occurredDate: "2026-08-26" as const
    };
    expect(() => transfer({ ...base, toLocationId: "home" })).toThrow(
      "来源地点和目标地点不能相同"
    );
    useInventoryStore.getState().setLocationActive("office", false);
    expect(() => transfer(base)).toThrow("批次、来源地点或目标地点不可用");
    useInventoryStore.getState().setLocationActive("office", true);
    expect(() => transfer({ ...base, quantity: 33 })).toThrow(
      "来源地点可转移库存不足"
    );
  });

  it("prevents disabling the last location or a location that still has stock", () => {
    receive();
    expect(() =>
      useInventoryStore.getState().setLocationActive("home", false)
    ).toThrow("地点仍有库存或使用中实例，不能停用");
    useInventoryStore.setState({
      locations: [{ id: "home", name: "家", active: true, order: 0 }],
      lots: [],
      transactions: []
    });
    expect(() =>
      useInventoryStore.getState().setLocationActive("home", false)
    ).toThrow("至少需要保留一个启用地点");
  });

  it("prevents disabling a location used by an ongoing instance", () => {
    useTimelineItemStore.setState({
      items: [
        {
          id: "item-1",
          categoryId: "profile-1",
          groupId: "lenses",
          categoryName: "日抛",
          productId: "product-1",
          sourceStockLotId: "lot-1",
          label: "测试",
          detail: "",
          location: "家",
          locationId: "home",
          startDate: "2026-08-25",
          endDate: null,
          status: "active"
        }
      ]
    });
    expect(() =>
      useInventoryStore.getState().setLocationActive("home", false)
    ).toThrow("地点仍有库存或使用中实例，不能停用");
  });

  it("deletes an unreferenced location and compacts location order", () => {
    const locationId = useInventoryStore.getState().addLocation({
      name: "临时地点",
      note: "尚未使用"
    });

    useInventoryStore.getState().deleteLocation(locationId);

    expect(
      useInventoryStore.getState().locations.map((location) => ({
        id: location.id,
        order: location.order
      }))
    ).toEqual([
      { id: "home", order: 0 },
      { id: "office", order: 1 }
    ]);
  });

  it("updates the current location-name snapshot when a location is renamed", () => {
    useTimelineItemStore.setState({
      items: [
        {
          id: "item-1",
          categoryId: "profile-1",
          groupId: "periodic",
          categoryName: "镜盒",
          productId: "product-1",
          sourceStockLotId: "lot-1",
          label: "镜盒 1",
          detail: "使用中",
          location: "家",
          locationId: "home",
          locationIntervals: [
            { locationId: "home", startDate: "2026-08-01", endDate: null }
          ],
          startDate: "2026-08-01",
          endDate: null,
          status: "active"
        }
      ]
    });

    useInventoryStore.getState().updateLocation("home", {
      name: "住所",
      note: "已更名"
    });

    expect(useTimelineItemStore.getState().items[0]?.location).toBe("住所");
  });

  it("normalizes location notes and rejects missing or duplicate names", () => {
    const store = useInventoryStore.getState();
    expect(() => store.addLocation({ name: " " })).toThrow("地点名称不能为空或重复");
    expect(() => store.addLocation({ name: " 家 " })).toThrow("地点名称不能为空或重复");
    expect(() => store.updateLocation("missing", { name: "仓库" })).toThrow("地点不存在");
    expect(() => store.updateLocation("office", { name: "家" })).toThrow("地点名称不能为空或重复");

    store.updateLocation("office", { name: " 公司 ", note: "  工作日使用  " });
    expect(useInventoryStore.getState().locations[1]).toMatchObject({
      name: "公司",
      note: "工作日使用"
    });
    store.updateLocation("office", { name: "公司" });
    expect(useInventoryStore.getState().locations[1]).not.toHaveProperty("note");
  });

  it("rejects deleting locations referenced by inventory or timeline history", () => {
    receive();
    expect(() => useInventoryStore.getState().deleteLocation("home")).toThrow(
      "地点已有库存、流水或使用实例关联，不能删除"
    );

    useTimelineItemStore.setState({
      items: [
        {
          id: "item-history",
          categoryId: "profile-1",
          groupId: "lenses",
          categoryName: "日抛",
          productId: "product-1",
          label: "历史实例",
          detail: "",
          location: "办公室",
          locationId: "home",
          locationIntervals: [
            {
              locationId: "office",
              startDate: "2026-08-01",
              endDate: "2026-08-02"
            }
          ],
          startDate: "2026-08-01",
          endDate: "2026-08-02",
          status: "completed"
        }
      ]
    });
    expect(() => useInventoryStore.getState().deleteLocation("office")).toThrow(
      "地点已有库存、流水或使用实例关联，不能删除"
    );
  });

  it("keeps at least one location and one active location", () => {
    useInventoryStore.setState({
      locations: [{ id: "home", name: "家", active: true, order: 0 }]
    });
    expect(() => useInventoryStore.getState().deleteLocation("home")).toThrow(
      "至少需要保留一个地点"
    );

    useInventoryStore.setState({
      locations: [
        { id: "home", name: "家", active: true, order: 0 },
        { id: "office", name: "办公室", active: false, order: 1 }
      ]
    });
    expect(() => useInventoryStore.getState().deleteLocation("home")).toThrow(
      "至少需要保留一个启用地点"
    );
  });

  it("covers missing mutation targets and stock-lot edit guards", () => {
    const store = useInventoryStore.getState();
    expect(() => store.deleteLocation("missing")).toThrow("地点不存在");
    expect(() => store.setLocationActive("missing", false)).toThrow("地点不存在");
    expect(() => store.transferStock({
      stockLotId: "missing", fromLocationId: "home", toLocationId: "office",
      quantity: 1, occurredDate: "2026-08-26"
    })).toThrow("批次、来源地点或目标地点不可用");

    const lotId = receive();
    const base = {
      internalLotCode: "20260825-1", receivedDate: "2026-08-25" as const,
      locationId: "home", quantity: 32, packageQuantity: 1,
      looseUnitQuantity: 2, unitsPerPackageAtReceipt: 30, unitPriceMinor: 500
    };
    expect(() => store.updateStockLot("missing", base)).toThrow("系统批号不能重复");
    expect(() => store.updateStockLot(lotId, { ...base, locationId: "missing" }))
      .toThrow("系统批号不能重复");
    expect(() => store.updateStockLot(lotId, { ...base, internalLotCode: " " }))
      .toThrow("系统批号不能重复");
  });

  it("sorts products when only one or neither sibling has a custom order", () => {
    const store = useInventoryStore.getState();
    useInventoryStore.setState({ products: [
      { ...product, id: "unordered", brand: "Z" },
      { ...product, id: "ordered", brand: "A", sortOrder: 0 },
      { ...product, id: "unrelated", itemProfileId: "other", brand: "X" }
    ] });
    store.moveProduct("unordered", -1);
    expect(useInventoryStore.getState().products.find((entry) => entry.id === "unordered")?.sortOrder).toBe(0);
    expect(useInventoryStore.getState().products.find((entry) => entry.id === "unrelated")?.sortOrder).toBeUndefined();

    useInventoryStore.setState({ products: [
      { ...product, id: "brand-b", brand: "B" },
      { ...product, id: "brand-a", brand: "A", model: "M", specification: "S" }
    ] });
    store.moveProduct("brand-b", -1);
    expect(useInventoryStore.getState().products.find((entry) => entry.id === "brand-b")?.sortOrder).toBe(0);
  });
});
