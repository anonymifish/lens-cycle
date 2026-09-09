import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useInventoryStore } from "../../stores/inventoryStore";
import type { Product, StockLot } from "./inventory.types";
import { setPersistenceCommandAdapterForTests } from "./persistenceGateway";
import { receiveStock, transferStock, updateStockLot } from "./stockRepository";

const product: Product = {
  id: "product-1", itemProfileId: "profile-1", standardType: "soft_reusable",
  brand: "品牌", baseUnit: "片", unitsPerPackage: 6, active: true
};
const lot: StockLot = {
  id: "lot-1", productId: "product-1", internalLotCode: "OLD",
  lotNumber: "OLD-NO", manufacturedDate: "2025-01-01", expiryDate: "2027-01-01",
  expectedUsageDays: 10, receivedDate: "2026-01-01", locationId: "home",
  initialUnitQuantity: 6, initialPackageQuantity: 1, initialLooseUnitQuantity: 0,
  unitsPerPackageAtReceipt: 6, unitPriceMinor: 600, currency: "CNY"
};

describe("stock repository normalization", () => {
  let lastArgs: Record<string, unknown> | undefined;

  beforeEach(() => {
    lastArgs = undefined;
    useInventoryStore.setState({
      products: [product, { ...product, id: "other", brand: "其他" }],
      lots: [lot, { ...lot, id: "other-lot", internalLotCode: "OTHER" }],
      transactions: [], locations: [{ id: "home", name: "家", active: true, order: 0 }]
    });
    setPersistenceCommandAdapterForTests(async <T,>(command: string, args?: Record<string, unknown>) => {
      lastArgs = args;
      if (command === "receive_stock") return structuredClone(args?.lot) as T;
      if (command === "transfer_stock") return structuredClone(args?.inventoryTransaction) as T;
      if (command === "update_stock_lot")
        return { lot: structuredClone(args?.lot), transactions: [{
          id: "replacement", stockLotId: "lot-1", occurredDate: "2026-09-01",
          type: "correction", quantityDelta: 2
        }] } as T;
      return undefined as T;
    });
  });

  afterEach(() => setPersistenceCommandAdapterForTests(null));

  it("receives every optional batch field and updates only the supplied product", async () => {
    const updatedProduct = { ...product, unitsPerPackage: 12 };
    const id = await receiveStock({
      productId: product.id, internalLotCode: " NEW ", lotNumber: " LOT-2 ",
      manufacturedDate: "2026-01-01", expiryDate: "2028-01-01", expectedUsageDays: 30,
      receivedDate: "2026-09-01", locationId: "home", quantity: 14,
      packageQuantity: 1, looseUnitQuantity: 2, unitsPerPackageAtReceipt: 12,
      unitPriceMinor: 1400
    }, updatedProduct);
    expect(useInventoryStore.getState().lots.at(-1)).toMatchObject({
      id, internalLotCode: "NEW", lotNumber: "LOT-2", manufacturedDate: "2026-01-01",
      expiryDate: "2028-01-01", expectedUsageDays: 30,
      initialPackageQuantity: 1, initialLooseUnitQuantity: 2, unitsPerPackageAtReceipt: 12
    });
    expect(useInventoryStore.getState().products).toEqual([
      expect.objectContaining({ id: "product-1", unitsPerPackage: 12 }),
      expect.objectContaining({ id: "other", unitsPerPackage: 6 })
    ]);
  });

  it("clears omitted optional fields when editing and appends replacement ledger entries", async () => {
    await updateStockLot("lot-1", {
      internalLotCode: " NEW ", receivedDate: "2026-09-02", locationId: "home",
      quantity: 8, unitPriceMinor: 800
    });
    const updated = useInventoryStore.getState().lots[0]!;
    expect(updated).toMatchObject({ internalLotCode: "NEW", initialUnitQuantity: 8 });
    for (const field of ["lotNumber", "manufacturedDate", "expiryDate", "expectedUsageDays",
      "initialPackageQuantity", "initialLooseUnitQuantity", "unitsPerPackageAtReceipt"])
      expect(updated).not.toHaveProperty(field);
    expect(useInventoryStore.getState().lots[1]?.internalLotCode).toBe("OTHER");
    expect(useInventoryStore.getState().transactions).toHaveLength(1);
  });

  it("preserves supplied optional fields when editing", async () => {
    await updateStockLot("lot-1", {
      internalLotCode: "NEW", lotNumber: "N2", manufacturedDate: "2026-01-01",
      expiryDate: "2028-01-01", expectedUsageDays: 20,
      receivedDate: "2026-09-02", locationId: "home", quantity: 8,
      packageQuantity: 1, looseUnitQuantity: 2, unitsPerPackageAtReceipt: 6,
      unitPriceMinor: 800
    });
    expect(useInventoryStore.getState().lots[0]).toMatchObject({
      lotNumber: "N2", expectedUsageDays: 20, initialPackageQuantity: 1,
      initialLooseUnitQuantity: 2, unitsPerPackageAtReceipt: 6
    });
  });

  it("rejects an edit for a missing lot", async () => {
    await expect(updateStockLot("missing", {
      internalLotCode: "N", receivedDate: "2026-09-01", locationId: "home",
      quantity: 1, unitPriceMinor: 100
    })).rejects.toThrow("库存批次不存在");
  });

  it("omits a blank transfer reason and stores the returned transaction", async () => {
    await transferStock({
      stockLotId: "lot-1", fromLocationId: "home", toLocationId: "office",
      quantity: 2, occurredDate: "2026-09-02", reason: "   "
    });
    expect(lastArgs?.inventoryTransaction).not.toHaveProperty("reason");
    expect(useInventoryStore.getState().transactions[0]).toMatchObject({
      type: "transfer", quantityDelta: 0, transferQuantity: 2
    });
  });
});
