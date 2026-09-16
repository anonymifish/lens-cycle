import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useInventoryStore } from "../../stores/inventoryStore";
import { useTimelineItemStore } from "../../stores/timelineItemStore";
import type { Product } from "./inventory.types";
import { setPersistenceCommandAdapterForTests } from "./persistenceGateway";
import {
  createProduct,
  deleteProduct,
  moveProduct,
  updateProduct,
  updateProductDuration,
  updateProductUnitsPerPackage
} from "./productRepository";

const product = (overrides: Partial<Product> = {}): Product => ({
  id: "p1",
  itemProfileId: "profile-1",
  standardType: "soft_daily",
  brand: "品牌",
  model: "型号",
  specification: "规格",
  baseUnit: "片",
  unitsPerPackage: 6,
  defaultDurationDays: 1,
  sortOrder: 0,
  active: true,
  ...overrides
});

describe("product repository", () => {
  const calls: Array<{ command: string; args: Record<string, unknown> | undefined }> = [];

  beforeEach(() => {
    calls.length = 0;
    useInventoryStore.setState({
      products: [product()],
      lots: [],
      transactions: [],
      locations: []
    });
    useTimelineItemStore.setState({ items: [] });
    setPersistenceCommandAdapterForTests(
      async <T>(command: string, args?: Record<string, unknown>) => {
        calls.push({ command, args });
        if (command === "create_product" || command === "update_product")
          return structuredClone(args?.product) as T;
        return undefined as T;
      }
    );
  });

  afterEach(() => setPersistenceCommandAdapterForTests(null));

  it("cleans optional text and assigns the next integer sibling order", async () => {
    useInventoryStore.setState({
      products: [
        product({ sortOrder: 3 }),
        product({ id: "p2", sortOrder: undefined as never }),
        product({ id: "other", itemProfileId: "other", sortOrder: 9 })
      ],
      lots: [],
      transactions: [],
      locations: []
    });
    const id = await createProduct({
      itemProfileId: "profile-1",
      standardType: "soft_daily",
      brand: " 新品牌 ",
      model: "  ",
      specification: " 新规格 ",
      baseUnit: "片",
      unitsPerPackage: 10
    });
    expect(useInventoryStore.getState().products.at(-1)).toMatchObject({
      id,
      brand: "新品牌",
      specification: "新规格",
      sortOrder: 4,
      active: true
    });
    expect(useInventoryStore.getState().products.at(-1)).not.toHaveProperty("model");
  });

  it("omits ordering when no sibling has an integer order", async () => {
    useInventoryStore.setState({ products: [], lots: [], transactions: [], locations: [] });
    await createProduct({
      itemProfileId: "profile-1",
      standardType: "soft_daily",
      brand: "品牌",
      baseUnit: "片",
      unitsPerPackage: 1
    });
    expect(useInventoryStore.getState().products[0]).not.toHaveProperty("sortOrder");
  });

  it("updates all optional fields and can clear them", async () => {
    await updateProduct("p1", {
      brand: " 新品牌 ",
      model: " 新型号 ",
      specification: " 新规格 ",
      capacityMl: 120,
      unitsPerPackage: 10,
      defaultDurationDays: 30
    });
    expect(useInventoryStore.getState().products[0]).toMatchObject({
      brand: "新品牌",
      model: "新型号",
      specification: "新规格",
      capacityMl: 120,
      unitsPerPackage: 10,
      defaultDurationDays: 30
    });
    await updateProduct("p1", { brand: "品牌", model: "", specification: "", unitsPerPackage: 1 });
    const stored = useInventoryStore.getState().products[0]!;
    expect(stored).not.toHaveProperty("model");
    expect(stored).not.toHaveProperty("specification");
    expect(stored).not.toHaveProperty("capacityMl");
    expect(stored).not.toHaveProperty("defaultDurationDays");
  });

  it("atomically updates opened expiry dates when product duration changes", async () => {
    useInventoryStore.setState((state) => ({
      ...state,
      products: [
        product({ standardType: "care_solution", baseUnit: "瓶", defaultDurationDays: 30 }),
        product({ id: "p2", standardType: "care_solution", baseUnit: "瓶" })
      ]
    }));
    useTimelineItemStore.setState({
      items: [
        {
          id: "item-1",
          categoryId: "profile-1",
          groupId: "consumables",
          categoryName: "护理液",
          productId: "p1",
          sourceStockLotId: "lot-1",
          label: "护理液",
          detail: "使用中",
          location: "家",
          locationId: "home",
          startDate: "2026-08-01",
          endDate: null,
          status: "active",
          openedExpiryDate: "2026-08-30",
          depletionPredictionDate: "2026-10-01",
          predictionDate: "2026-08-30",
          stateIntervals: [{ startDate: "2026-08-01", endDate: null, status: "active" }],
          locationIntervals: [{ locationId: "home", startDate: "2026-08-01", endDate: null }]
        },
        {
          id: "item-2",
          categoryId: "profile-1",
          groupId: "consumables",
          categoryName: "护理液",
          productId: "p1",
          sourceStockLotId: "lot-2",
          label: "护理液 2",
          detail: "使用中",
          location: "家",
          locationId: "home",
          startDate: "2026-08-01",
          endDate: null,
          status: "active",
          openedExpiryDate: "2026-08-30",
          depletionPredictionDate: "2026-09-01",
          predictionDate: "2026-08-30"
        },
        {
          id: "unrelated",
          categoryId: "profile-1",
          groupId: "consumables",
          categoryName: "护理液",
          productId: "p2",
          sourceStockLotId: "lot-3",
          label: "其他产品",
          detail: "使用中",
          location: "家",
          locationId: "home",
          startDate: "2026-08-01",
          endDate: null,
          status: "active"
        }
      ]
    });

    await updateProduct("p1", {
      brand: "品牌",
      unitsPerPackage: 1,
      defaultDurationDays: 60
    });

    expect(calls.at(-1)?.command).toBe("commit_app_data_mutation");
    expect(useInventoryStore.getState().products[0]?.defaultDurationDays).toBe(60);
    expect(useTimelineItemStore.getState().items[0]).toMatchObject({
      openedExpiryDate: "2026-09-29",
      depletionPredictionDate: "2026-10-01",
      predictionDate: "2026-09-29"
    });
    expect(useTimelineItemStore.getState().items[1]).toMatchObject({
      openedExpiryDate: "2026-09-29",
      predictionDate: "2026-09-01"
    });
    expect(useTimelineItemStore.getState().items[2]?.productId).toBe("p2");
    expect(useInventoryStore.getState().products[1]?.id).toBe("p2");
  });

  it("publishes neither product nor expiry changes when their atomic write fails", async () => {
    useInventoryStore.setState((state) => ({
      ...state,
      products: [product({ defaultDurationDays: 30 })]
    }));
    useTimelineItemStore.setState({
      items: [
        {
          id: "item-1",
          categoryId: "profile-1",
          groupId: "consumables",
          categoryName: "护理液",
          productId: "p1",
          sourceStockLotId: "lot-1",
          label: "护理液",
          detail: "使用中",
          location: "家",
          locationId: "home",
          startDate: "2026-08-01",
          endDate: null,
          status: "active",
          openedExpiryDate: "2026-08-30",
          predictionDate: "2026-08-30"
        }
      ]
    });
    setPersistenceCommandAdapterForTests(async () => Promise.reject(new Error("disk full")));

    await expect(
      updateProduct("p1", {
        brand: "品牌",
        unitsPerPackage: 1,
        defaultDurationDays: 60
      })
    ).rejects.toThrow("disk full");
    expect(useInventoryStore.getState().products[0]?.defaultDurationDays).toBe(30);
    expect(useTimelineItemStore.getState().items[0]?.openedExpiryDate).toBe("2026-08-30");
  });

  it("updates duration and package size and rejects missing products", async () => {
    await updateProductDuration("p1", 14);
    await updateProductUnitsPerPackage("p1", 30);
    expect(useInventoryStore.getState().products[0]).toMatchObject({
      defaultDurationDays: 14,
      unitsPerPackage: 30
    });
    await expect(updateProduct("missing", { brand: "B", unitsPerPackage: 1 })).rejects.toThrow(
      "产品不存在"
    );
    await expect(updateProductDuration("missing", 1)).rejects.toThrow("产品不存在");
    await expect(updateProductUnitsPerPackage("missing", 1)).rejects.toThrow("产品不存在");
    await expect(moveProduct("missing", 1)).rejects.toThrow("产品不存在");
  });

  it("deletes products after persistence succeeds", async () => {
    await deleteProduct("p1");
    expect(useInventoryStore.getState().products).toEqual([]);
  });

  it("reorders siblings while preserving unrelated products and handles boundaries", async () => {
    useInventoryStore.setState({
      products: [
        product({ sortOrder: undefined as never }),
        product({ id: "p2", sortOrder: 0 }),
        product({ id: "other", itemProfileId: "other", sortOrder: 0 })
      ],
      lots: [],
      transactions: [],
      locations: []
    });
    await moveProduct("p1", -1);
    expect(
      useInventoryStore.getState().products.find((entry) => entry.id === "p1")?.sortOrder
    ).toBe(0);
    expect(
      useInventoryStore.getState().products.find((entry) => entry.id === "other")?.sortOrder
    ).toBe(0);
    const count = calls.length;
    await moveProduct("p1", -1);
    expect(calls).toHaveLength(count);
  });
});
