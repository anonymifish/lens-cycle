import { beforeEach, describe, expect, it } from "vitest";
import type { ItemProfile, ManagementTemplate, StandardType } from "../catalog/catalog.types";
import { useInventoryStore } from "../../stores/inventoryStore";
import { useItemProfileStore } from "../../stores/itemProfileStore";
import { useTimelineItemStore } from "../../stores/timelineItemStore";
import { activateInventoryItem } from "./activatePeriodicItem";
import {
  availableReusableLooseUnitQuantity,
  availableUnits,
  unopenedPackageCount
} from "./inventory";

function arrange(template: ManagementTemplate, standardType: StandardType) {
  const profile: ItemProfile = {
    id: `profile-${template}`,
    groupId:
      template === "rigid_long_term" || template.startsWith("soft_")
        ? "lenses"
        : template === "lens_case" || template === "lens_accessory"
          ? "periodic"
          : "consumables",
    managementTemplate: template,
    standardType,
    name: "测试配置",
    active: true,
    order: 0,
    defaultDurationDays: 14
  };
  useItemProfileStore.setState({ profiles: [profile] });
  useTimelineItemStore.setState({ items: [] });
  useInventoryStore.setState({
    products: [
      {
        id: "product-1",
        itemProfileId: profile.id,
        standardType,
        brand: "测试品牌",
        baseUnit: template === "discrete_dose" ? "对" : "片",
        unitsPerPackage: 30,
        defaultDurationDays: 14,
        active: true
      }
    ],
    locations: [{ id: "home", name: "家", active: true, order: 0 }],
    lots: [
      {
        id: "lot-1",
        productId: "product-1",
        internalLotCode: "20260804-1",
        receivedDate: "2026-08-04",
        locationId: "home",
        initialUnitQuantity: 120,
        ...(template.startsWith("soft_")
          ? {
              initialPackageQuantity: 4,
              initialLooseUnitQuantity: 0,
              unitsPerPackageAtReceipt: 30
            }
          : {}),
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
        quantityDelta: 120
      }
    ]
  });
  return profile;
}

function activate(extra: Partial<Parameters<typeof activateInventoryItem>[0]> = {}) {
  return activateInventoryItem({
    profileId: String(useItemProfileStore.getState().profiles[0]?.id),
    productId: "product-1",
    stockLotId: "lot-1",
    name: "测试实例",
    startDate: "2026-08-04",
    locationId: "home",
    ...extra
  });
}

describe("activateInventoryItem template dispatch", () => {
  beforeEach(() => {
    useTimelineItemStore.setState({ items: [] });
  });

  it("opens a daily box and prevents the same package from opening twice", () => {
    arrange("soft_daily", "soft_daily");
    useInventoryStore.setState((state) => ({
      lots: state.lots.map((lot) => ({
        ...lot,
        initialUnitQuantity: 30,
        initialPackageQuantity: 1,
        initialLooseUnitQuantity: 0,
        unitsPerPackageAtReceipt: 30
      })),
      transactions: state.transactions.map((transaction) => ({
        ...transaction,
        quantityDelta: 30
      }))
    }));
    const instanceId = activate({ inventorySourceKind: "package" });

    const item = useTimelineItemStore.getState().items[0];
    expect(item?.initialUnitQuantity).toBe(30);
    expect(item?.inventorySourceKind).toBe("package");
    expect(item?.predictionDate).toBeUndefined();
    expect(useInventoryStore.getState().transactions.at(-1)).toMatchObject({
      type: "package_open",
      quantityDelta: 0,
      allocatedUnitQuantity: 30
    });
    expect(() => activate({ inventorySourceKind: "package" })).toThrow(
      "该批次已经没有未开封整盒"
    );
    useInventoryStore
      .getState()
      .reverseActivation(instanceId, "2026-08-05");
    useTimelineItemStore.getState().deleteItem(instanceId);
    expect(() => activate({ inventorySourceKind: "package" })).not.toThrow();
  });

  it("allocates only the loose units recorded at stock-in", () => {
    arrange("soft_daily", "soft_daily");
    useInventoryStore.setState((state) => ({
      lots: state.lots.map((lot) => ({
        ...lot,
        initialUnitQuantity: 5,
        initialPackageQuantity: 0,
        initialLooseUnitQuantity: 5,
        unitsPerPackageAtReceipt: 30
      })),
      transactions: state.transactions.map((transaction) => ({
        ...transaction,
        quantityDelta: 5
      }))
    }));

    activate({ inventorySourceKind: "loose", initialUnitQuantity: 3 });
    expect(useTimelineItemStore.getState().items[0]).toMatchObject({
      initialUnitQuantity: 3,
      inventorySourceKind: "loose"
    });
    expect(() =>
      activate({ inventorySourceKind: "loose", initialUnitQuantity: 3 })
    ).toThrow("该批次可分配散片不足");
  });

  it("starts a reusable lens and reserves one lens", () => {
    arrange("soft_reusable", "soft_reusable");
    activate();

    const item = useTimelineItemStore.getState().items[0];
    expect(item?.predictionDate).toBe("2026-08-17");
    expect(useInventoryStore.getState().transactions.at(-1)).toMatchObject({
      type: "activate",
      quantityDelta: -1
    });
  });

  it("opens one reusable-lens box, keeps its remnants bound to the box, and never reseals it on undo", () => {
    arrange("soft_reusable", "soft_reusable");
    useInventoryStore.setState((state) => ({
      products: state.products.map((product) => ({
        ...product,
        unitsPerPackage: 6
      })),
      lots: state.lots.map((lot) => ({
        ...lot,
        initialUnitQuantity: 6,
        initialPackageQuantity: 1,
        initialLooseUnitQuantity: 0,
        unitsPerPackageAtReceipt: 6
      })),
      transactions: state.transactions.map((transaction) => ({
        ...transaction,
        quantityDelta: 6
      }))
    }));

    const firstId = activate({ inventorySourceKind: "package" });
    const inventoryAfterOpen = useInventoryStore.getState();
    const lot = inventoryAfterOpen.lots[0]!;
    const product = inventoryAfterOpen.products[0]!;

    expect(
      unopenedPackageCount(
        lot,
        product,
        inventoryAfterOpen.transactions,
        useTimelineItemStore.getState().items
      )
    ).toBe(0);
    expect(
      availableReusableLooseUnitQuantity(
        lot,
        product,
        inventoryAfterOpen.transactions,
        useTimelineItemStore.getState().items
      )
    ).toBe(0);
    expect(() => activate({ inventorySourceKind: "package" })).toThrow(
      "该批次已经没有未开封整盒"
    );
    expect(() => activate({ inventorySourceKind: "loose" })).toThrow(
      "该批次已经没有可启用散片"
    );

    useInventoryStore.getState().reverseActivation(firstId, "2026-08-05");
    useTimelineItemStore.getState().deleteItem(firstId);
    const inventoryAfterUndo = useInventoryStore.getState();
    expect(
      unopenedPackageCount(
        lot,
        product,
        inventoryAfterUndo.transactions,
        useTimelineItemStore.getState().items
      )
    ).toBe(0);
    expect(availableUnits(lot.id, inventoryAfterUndo.transactions)).toBe(6);
  });

  it("keeps opened-container depletion and expiry dates separate", () => {
    arrange("opened_container", "care_solution");
    activate({
      expectedEndDate: "2026-09-02",
      depletionPredictionDate: "2026-08-25"
    });

    const item = useTimelineItemStore.getState().items[0];
    expect(item?.openedExpiryDate).toBe("2026-09-02");
    expect(item?.depletionPredictionDate).toBe("2026-08-25");
    expect(item?.predictionDate).toBe("2026-08-25");
  });

  it("uses the earlier of predicted depletion and opened expiry for replacement", () => {
    arrange("opened_container", "care_solution");
    activate({
      expectedEndDate: "2026-08-20",
      depletionPredictionDate: "2026-08-25"
    });

    const item = useTimelineItemStore.getState().items[0];
    expect(item?.openedExpiryDate).toBe("2026-08-20");
    expect(item?.depletionPredictionDate).toBe("2026-08-25");
    expect(item?.predictionDate).toBe("2026-08-20");
  });

  it("predicts batch depletion without writing predicted consumption", () => {
    arrange("batch_consumable", "saline");
    activate({ usageRatePerDay: 2 });

    const item = useTimelineItemStore.getState().items[0];
    expect(item?.initialUnitQuantity).toBe(120);
    expect(item?.usageRatePerDay).toBe(2);
    expect(item?.predictionDate).toBe("2026-10-02");
    expect(useInventoryStore.getState().transactions).toHaveLength(1);
  });

  it("records the initial lens-case eye assignment interval", () => {
    arrange("lens_case", "lens_case");
    activate({ eyeSides: ["L", "R"] });

    const item = useTimelineItemStore.getState().items[0];
    expect(item?.eyeSides).toEqual(["L", "R"]);
    expect(item?.eyeAssignmentIntervals).toEqual([
      {
        startDate: "2026-08-04",
        endDate: null,
        eyeSides: ["L", "R"]
      }
    ]);
  });

  it("records discrete doses individually instead of reserving inventory", () => {
    arrange("discrete_dose", "protein_removal_solution");
    activate();

    expect(useInventoryStore.getState().transactions).toHaveLength(1);
    expect(useTimelineItemStore.getState().items[0]?.status).toBe("active");
  });

  it("rejects inactive products and inactive or missing locations", () => {
    arrange("rigid_long_term", "scleral");
    useInventoryStore.setState((state) => ({
      products: state.products.map((product) => ({ ...product, active: false }))
    }));
    expect(() => activate()).toThrow("产品不存在或已停用");

    arrange("rigid_long_term", "scleral");
    useInventoryStore.setState((state) => ({
      locations: state.locations.map((location) => ({
        ...location,
        active: false
      }))
    }));
    expect(() => activate()).toThrow("启用地点不可用");
    expect(() => activate({ locationId: "missing" })).toThrow("启用地点不可用");
  });

  it("rejects malformed quantities, rates, dates, and lens-case eye sides", () => {
    arrange("soft_daily", "soft_daily");
    expect(() =>
      activate({ inventorySourceKind: "loose", initialUnitQuantity: 1.5 })
    ).toThrow("实例初始数量必须是正整数");

    arrange("batch_consumable", "saline");
    expect(() => activate({ usageRatePerDay: 0 })).toThrow(
      "每日用量必须大于零"
    );
    expect(() => activate({ expectedEndDate: "2026-08-03" })).toThrow(
      "预计结束日期不能早于启用日期"
    );

    arrange("lens_case", "lens_case");
    expect(() => activate()).toThrow("镜盒必须选择不重复的启用眼别");
    expect(() => activate({ eyeSides: ["L", "L"] })).toThrow(
      "镜盒必须选择不重复的启用眼别"
    );
  });

  it("uses only stock at the selected location for batch predictions", () => {
    arrange("batch_consumable", "saline");
    useInventoryStore.setState((state) => ({
      locations: [
        ...state.locations,
        { id: "office", name: "办公室", active: true, order: 1 }
      ],
      transactions: [
        { ...state.transactions[0]!, locationId: "home" },
        {
          id: "transfer-1",
          stockLotId: "lot-1",
          occurredDate: "2026-08-04",
          type: "transfer",
          quantityDelta: 0,
          fromLocationId: "home",
          toLocationId: "office",
          transferQuantity: 80
        }
      ]
    }));

    activate({ usageRatePerDay: 2 });
    expect(useTimelineItemStore.getState().items[0]).toMatchObject({
      initialUnitQuantity: 40,
      predictionDate: "2026-08-23"
    });
    expect(() => activate({ usageRatePerDay: 2 })).toThrow(
      "该批次在所选地点已有使用中的实例"
    );
  });
});
