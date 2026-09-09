import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createProfile, deleteProfile, moveProfile, profileHasRelations,
  setProfileActive, updateProfile
} from "../catalog/profileRepository";
import {
  createLocation, deleteLocation, setLocationActive, updateLocation
} from "./locationRepository";
import {
  createProduct, deleteProduct, moveProduct, updateProduct,
  updateProductDuration, updateProductUnitsPerPackage
} from "./productRepository";
import {
  receiveStock, transferStock, updateStockLot, voidUnusedStockLot
} from "./stockRepository";
import { collectAppDataSnapshot } from "./appDataSnapshot";
import { invokePersistence, setPersistenceCommandAdapterForTests } from "./persistenceGateway";
import { useInventoryStore } from "../../stores/inventoryStore";
import { useItemProfileStore } from "../../stores/itemProfileStore";
import { useTimelineItemStore } from "../../stores/timelineItemStore";

describe("SQLite repository boundary", () => {
  beforeEach(() => {
    useItemProfileStore.setState({ profiles: [] });
    useInventoryStore.setState({ products: [], locations: [], lots: [], transactions: [] });
    useTimelineItemStore.setState({ items: [] });
  });
  afterEach(() => setPersistenceCommandAdapterForTests(null));

  it("does not fall back to memory outside Tauri", async () => {
    setPersistenceCommandAdapterForTests(null);
    await expect(invokePersistence("load_app_data")).rejects.toBeDefined();
    expect(collectAppDataSnapshot().products).toEqual([]);
  });

  it("does not expose repository writes when Tauri rejects", async () => {
    setPersistenceCommandAdapterForTests(async () => {
      throw new Error("sqlite unavailable");
    });
    const before = collectAppDataSnapshot();
    await expect(createProfile({
      groupId: "periodic", managementTemplate: "lens_case",
      standardType: "lens_case", standardTypeName: "镜盒",
      name: "镜盒", baseUnit: "个", defaultDurationDays: 90
    })).rejects.toThrow("sqlite unavailable");
    await expect(createLocation({ name: "家" })).rejects.toThrow("sqlite unavailable");
    await expect(createProduct({
      itemProfileId: "profile-1", standardType: "lens_case",
      brand: "测试", baseUnit: "个", unitsPerPackage: 1
    })).rejects.toThrow("sqlite unavailable");
    await expect(receiveStock({
      productId: "product-1", internalLotCode: "20260904-1",
      receivedDate: "2026-09-04", locationId: "home",
      quantity: 1, unitPriceMinor: 100
    })).rejects.toThrow("sqlite unavailable");
    expect(collectAppDataSnapshot()).toEqual(before);
  });

  it("applies the returned entity only after a successful commit", async () => {
    setPersistenceCommandAdapterForTests(async <T>(
      _command: string,
      args?: Record<string, unknown>
    ): Promise<T> =>
      structuredClone(args?.product) as T
    );
    const pending = createProduct({
      itemProfileId: "profile-1", standardType: "lens_case",
      brand: "测试", baseUnit: "个", unitsPerPackage: 1
    });
    expect(useInventoryStore.getState().products).toEqual([]);
    await pending;
    expect(useInventoryStore.getState().products).toHaveLength(1);
  });

  it("rejects a second write while the first SQLite commit is pending", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    setPersistenceCommandAdapterForTests(async <T>(
      _command: string,
      args?: Record<string, unknown>
    ): Promise<T> => {
      await gate;
      return structuredClone(args?.location) as T;
    });
    const first = createLocation({ name: "家" });
    await expect(createLocation({ name: "办公室" })).rejects.toThrow("请勿重复操作");
    release();
    await first;
    expect(useInventoryStore.getState().locations.map((entry) => entry.name)).toEqual(["家"]);
  });

  it("keeps the lot and original ledger while a void is pending, then appends the reversal", async () => {
    const lot = {
      id: "lot-1", productId: "product-1", internalLotCode: "20260906-1",
      receivedDate: "2026-09-06" as const, locationId: "home",
      initialUnitQuantity: 2, unitPriceMinor: 100, currency: "CNY" as const
    };
    const stockIn = {
      id: "stock-in", stockLotId: lot.id, occurredDate: "2026-09-06" as const,
      type: "stock_in" as const, quantityDelta: 2, locationId: "home"
    };
    useInventoryStore.setState({ lots: [lot], transactions: [stockIn] });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    setPersistenceCommandAdapterForTests(async <T>() => {
      await gate;
      return {
        lot: { ...lot, voidedAt: "2026-09-06", voidedByTransactionId: "reverse" },
        transactions: [{
          id: "reverse", stockLotId: lot.id, occurredDate: "2026-09-06",
          type: "reverse", quantityDelta: -2, reversedTransactionId: stockIn.id,
          reason: "作废误录批次"
        }]
      } as T;
    });

    const pending = voidUnusedStockLot(lot.id, "2026-09-06");
    expect(useInventoryStore.getState().lots).toEqual([lot]);
    expect(useInventoryStore.getState().transactions).toEqual([stockIn]);
    release();
    await pending;

    expect(useInventoryStore.getState().lots[0]?.voidedAt).toBe("2026-09-06");
    expect(useInventoryStore.getState().transactions.map((entry) => entry.id)).toEqual([
      "stock-in", "reverse"
    ]);
  });

  it("commits the complete profile, location, product, and stock repository lifecycle", async () => {
    setPersistenceCommandAdapterForTests(async <T>(
      command: string,
      args?: Record<string, unknown>
    ): Promise<T> => {
      if (["create_profile", "update_profile"].includes(command)) return structuredClone(args?.profile) as T;
      if (["create_location", "update_location"].includes(command)) return structuredClone(args?.location) as T;
      if (["create_product", "update_product"].includes(command)) return structuredClone(args?.product) as T;
      if (command === "receive_stock") return structuredClone(args?.lot) as T;
      if (command === "transfer_stock") return structuredClone(args?.inventoryTransaction) as T;
      if (command === "update_stock_lot") return { lot: structuredClone(args?.lot), transactions: [] } as T;
      if (command === "void_unused_stock_lot") {
        const lot = useInventoryStore.getState().lots.find((entry) => entry.id === args?.id)!;
        return {
          lot: { ...lot, voidedAt: args?.voidedAt, voidedByTransactionId: "void-tx" },
          transactions: [{
            id: "void-tx", stockLotId: lot.id, occurredDate: args?.voidedAt,
            type: "reverse", quantityDelta: -lot.initialUnitQuantity,
            reversedTransactionId: useInventoryStore.getState().transactions
              .find((entry) => entry.stockLotId === lot.id && entry.type === "stock_in")!.id
          }]
        } as T;
      }
      return undefined as T;
    });

    const profileId = await createProfile({
      groupId: "periodic", managementTemplate: "lens_case",
      standardType: "lens_case", standardTypeName: "镜盒",
      name: " 镜盒 ", baseUnit: "个", defaultDurationDays: 90
    });
    const secondProfileId = await createProfile({
      groupId: "periodic", managementTemplate: "lens_accessory",
      standardType: "lens_applicator", standardTypeName: "吸棒",
      name: "吸棒", baseUnit: "个", defaultDurationDays: 120
    });
    await updateProfile(profileId, {
      name: "旅行镜盒", standardType: "lens_case", standardTypeName: "镜盒",
      baseUnit: "个", defaultDurationDays: 60
    });
    await setProfileActive(secondProfileId, false);
    await moveProfile(secondProfileId, -1);

    const locationId = await createLocation({ name: " 旅行包 ", note: " 随身 " });
    useTimelineItemStore.setState({ items: [{
      id: "item", categoryId: profileId, groupId: "periodic", categoryName: "镜盒",
      label: "镜盒", detail: "", location: "旅行包", locationId,
      startDate: "2026-09-01", endDate: null, status: "active"
    }] });
    await updateLocation(locationId, { name: "行李箱", note: "托运" });
    await setLocationActive(locationId, false);
    expect(useTimelineItemStore.getState().items[0]?.location).toBe("行李箱");

    const productId = await createProduct({
      itemProfileId: profileId, standardType: "lens_case", brand: " 品牌 ",
      model: " M1 ", specification: " 大号 ", baseUnit: "个", unitsPerPackage: 1
    });
    await updateProduct(productId, {
      brand: "新品牌", model: "M2", specification: "小号", unitsPerPackage: 2,
      defaultDurationDays: 80
    });
    await updateProductDuration(productId, 70);
    await updateProductUnitsPerPackage(productId, 3);
    const secondProductId = await createProduct({
      itemProfileId: profileId, standardType: "lens_case", brand: "第二品牌",
      baseUnit: "个", unitsPerPackage: 1
    });
    await moveProduct(secondProductId, -1);
    expect(profileHasRelations(profileId)).toBe(true);

    useInventoryStore.setState((state) => ({
      locations: state.locations.map((entry) => ({ ...entry, active: true }))
    }));
    const lotId = await receiveStock({
      productId, internalLotCode: " 20260906-1 ", receivedDate: "2026-09-06",
      locationId, quantity: 3, unitPriceMinor: 100
    });
    await updateStockLot(lotId, {
      internalLotCode: "20260906-1", receivedDate: "2026-09-06", locationId,
      quantity: 3, unitPriceMinor: 120
    });
    useInventoryStore.setState((state) => ({
      locations: [...state.locations, { id: "office", name: "办公室", active: true, order: 1 }]
    }));
    await transferStock({
      stockLotId: lotId, fromLocationId: locationId, toLocationId: "office",
      quantity: 1, occurredDate: "2026-09-06", reason: " 调拨 "
    });
    await voidUnusedStockLot(lotId, "2026-09-06");
    expect(useInventoryStore.getState().lots.find((entry) => entry.id === lotId)?.voidedAt)
      .toBe("2026-09-06");

    await deleteProduct(secondProductId);
    useTimelineItemStore.setState({ items: [] });
    await deleteProduct(productId);
    await deleteLocation("office");
    await deleteLocation(locationId);
    await deleteProfile(secondProfileId);
    await deleteProfile(profileId);
    expect(useInventoryStore.getState().products).toEqual([]);
    expect(useItemProfileStore.getState().profiles).toEqual([]);
  });
});
