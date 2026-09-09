import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useInventoryStore } from "../../stores/inventoryStore";
import type { Product } from "./inventory.types";
import { setPersistenceCommandAdapterForTests } from "./persistenceGateway";
import {
  createProduct, deleteProduct, moveProduct, updateProduct,
  updateProductDuration, updateProductUnitsPerPackage
} from "./productRepository";

const product = (overrides: Partial<Product> = {}): Product => ({
  id: "p1", itemProfileId: "profile-1", standardType: "soft_daily",
  brand: "品牌", model: "型号", specification: "规格", baseUnit: "片",
  unitsPerPackage: 6, defaultDurationDays: 1, sortOrder: 0, active: true,
  ...overrides
});

describe("product repository", () => {
  const calls: Array<{ command: string; args: Record<string, unknown> | undefined }> = [];

  beforeEach(() => {
    calls.length = 0;
    useInventoryStore.setState({ products: [product()], lots: [], transactions: [], locations: [] });
    setPersistenceCommandAdapterForTests(async <T,>(command: string, args?: Record<string, unknown>) => {
      calls.push({ command, args });
      if (command === "create_product" || command === "update_product")
        return structuredClone(args?.product) as T;
      return undefined as T;
    });
  });

  afterEach(() => setPersistenceCommandAdapterForTests(null));

  it("cleans optional text and assigns the next integer sibling order", async () => {
    useInventoryStore.setState({ products: [
      product({ sortOrder: 3 }), product({ id: "p2", sortOrder: undefined as never }),
      product({ id: "other", itemProfileId: "other", sortOrder: 9 })
    ], lots: [], transactions: [], locations: [] });
    const id = await createProduct({
      itemProfileId: "profile-1", standardType: "soft_daily", brand: " 新品牌 ",
      model: "  ", specification: " 新规格 ", baseUnit: "片", unitsPerPackage: 10
    });
    expect(useInventoryStore.getState().products.at(-1)).toMatchObject({
      id, brand: "新品牌", specification: "新规格", sortOrder: 4, active: true
    });
    expect(useInventoryStore.getState().products.at(-1)).not.toHaveProperty("model");
  });

  it("omits ordering when no sibling has an integer order", async () => {
    useInventoryStore.setState({ products: [], lots: [], transactions: [], locations: [] });
    await createProduct({
      itemProfileId: "profile-1", standardType: "soft_daily", brand: "品牌",
      baseUnit: "片", unitsPerPackage: 1
    });
    expect(useInventoryStore.getState().products[0]).not.toHaveProperty("sortOrder");
  });

  it("updates all optional fields and can clear them", async () => {
    await updateProduct("p1", {
      brand: " 新品牌 ", model: " 新型号 ", specification: " 新规格 ",
      capacityMl: 120, unitsPerPackage: 10, defaultDurationDays: 30
    });
    expect(useInventoryStore.getState().products[0]).toMatchObject({
      brand: "新品牌", model: "新型号", specification: "新规格",
      capacityMl: 120, unitsPerPackage: 10, defaultDurationDays: 30
    });
    await updateProduct("p1", { brand: "品牌", model: "", specification: "", unitsPerPackage: 1 });
    const stored = useInventoryStore.getState().products[0]!;
    expect(stored).not.toHaveProperty("model");
    expect(stored).not.toHaveProperty("specification");
    expect(stored).not.toHaveProperty("capacityMl");
    expect(stored).not.toHaveProperty("defaultDurationDays");
  });

  it("updates duration and package size and rejects missing products", async () => {
    await updateProductDuration("p1", 14);
    await updateProductUnitsPerPackage("p1", 30);
    expect(useInventoryStore.getState().products[0]).toMatchObject({ defaultDurationDays: 14, unitsPerPackage: 30 });
    await expect(updateProduct("missing", { brand: "B", unitsPerPackage: 1 })).rejects.toThrow("产品不存在");
    await expect(updateProductDuration("missing", 1)).rejects.toThrow("产品不存在");
    await expect(updateProductUnitsPerPackage("missing", 1)).rejects.toThrow("产品不存在");
    await expect(moveProduct("missing", 1)).rejects.toThrow("产品不存在");
  });

  it("deletes products after persistence succeeds", async () => {
    await deleteProduct("p1");
    expect(useInventoryStore.getState().products).toEqual([]);
  });

  it("reorders siblings while preserving unrelated products and handles boundaries", async () => {
    useInventoryStore.setState({ products: [
      product({ sortOrder: undefined as never }), product({ id: "p2", sortOrder: 0 }),
      product({ id: "other", itemProfileId: "other", sortOrder: 0 })
    ], lots: [], transactions: [], locations: [] });
    await moveProduct("p1", -1);
    expect(useInventoryStore.getState().products.find((entry) => entry.id === "p1")?.sortOrder).toBe(0);
    expect(useInventoryStore.getState().products.find((entry) => entry.id === "other")?.sortOrder).toBe(0);
    const count = calls.length;
    await moveProduct("p1", -1);
    expect(calls).toHaveLength(count);
  });
});
