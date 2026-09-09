import { addLocalDays, type LocalDate } from "../../shared/dates/localDate";
import { useInventoryStore } from "../../stores/inventoryStore";
import { useItemProfileStore } from "../../stores/itemProfileStore";
import { useTimelineItemStore } from "../../stores/timelineItemStore";
import {
  availableLooseUnitQuantity,
  availableReusableLooseUnitQuantity,
  availableUnits,
  availableUnitsAtLocation,
  lotUnitsPerPackage,
  productMatchesProfile,
  unopenedPackageCount
} from "./inventory";
import { consumptionPredictionDate, inclusiveCycleEndDate } from "../timeline/domain/forecast";
import { runLocalDataTransaction } from "./localDataTransaction";

interface ActivatePeriodicItemInput {
  profileId: string;
  productId: string;
  stockLotId: string;
  name: string;
  startDate: LocalDate;
  locationId: string;
  expectedEndDate?: LocalDate;
  initialUnitQuantity?: number;
  inventorySourceKind?: "package" | "loose";
  usageRatePerDay?: number;
  eyeSides?: Array<"L" | "R">;
  depletionPredictionDate?: LocalDate;
}

export function activateInventoryItem(input: ActivatePeriodicItemInput) {
  return runLocalDataTransaction(() => activateInventoryItemUnsafe(input));
}

function activateInventoryItemUnsafe(input: ActivatePeriodicItemInput) {
  const inventory = useInventoryStore.getState();
  const profile = useItemProfileStore
    .getState()
    .profiles.find((item) => item.id === input.profileId);
  const product = inventory.products.find((item) => item.id === input.productId);
  const lot = inventory.lots.find((item) => item.id === input.stockLotId);
  const location = inventory.locations.find((item) => item.id === input.locationId);

  if (!profile || !profile.active) throw new Error("用品配置不可用");
  if (!product || !product.active) throw new Error("产品不存在或已停用");
  if (!productMatchesProfile(product, profile)) {
    throw new Error("产品与用品配置的标准类型不一致");
  }
  if (!lot || lot.productId !== product.id) throw new Error("库存批次不匹配");
  if (lot.voidedAt) throw new Error("库存批次已经作废");
  if (!location || !location.active) throw new Error("启用地点不可用");
  if (availableUnits(lot.id, inventory.transactions) < 1) throw new Error("库存不足");

  if (
    input.initialUnitQuantity !== undefined &&
    (!Number.isInteger(input.initialUnitQuantity) || input.initialUnitQuantity <= 0)
  )
    throw new Error("实例初始数量必须是正整数");
  if (
    input.usageRatePerDay !== undefined &&
    (!Number.isFinite(input.usageRatePerDay) || input.usageRatePerDay <= 0)
  )
    throw new Error("每日用量必须大于零");
  if (input.expectedEndDate && input.expectedEndDate < input.startDate)
    throw new Error("预计结束日期不能早于启用日期");
  if (
    profile.managementTemplate === "lens_case" &&
    (!input.eyeSides?.length ||
      new Set(input.eyeSides).size !== input.eyeSides.length)
  )
    throw new Error("镜盒必须选择不重复的启用眼别");

  const timelineItems = useTimelineItemStore.getState().items;
  if (
    ["batch_consumable", "discrete_dose"].includes(
      profile.managementTemplate
    ) &&
    timelineItems.some(
      (item) =>
        item.sourceStockLotId === lot.id &&
        item.locationId === input.locationId &&
        item.categoryId === profile.id &&
        item.status !== "completed"
    )
  )
    throw new Error("该批次在所选地点已有使用中的实例");
  const packagedLensSourceKind = input.inventorySourceKind ?? "package";
  const dailyInitialQuantity =
    packagedLensSourceKind === "package"
      ? lotUnitsPerPackage(lot, product)
      : Math.max(1, Math.floor(input.initialUnitQuantity ?? 1));
  const requiredSourceQuantity =
    profile.managementTemplate === "soft_daily"
      ? dailyInitialQuantity
      : profile.managementTemplate === "soft_reusable" &&
          packagedLensSourceKind === "package"
        ? lotUnitsPerPackage(lot, product)
        : 1;
  if (
    profile.managementTemplate === "soft_daily" &&
    packagedLensSourceKind === "package" &&
    unopenedPackageCount(
      lot,
      product,
      inventory.transactions,
      timelineItems
    ) < 1
  ) {
    throw new Error("该批次已经没有未开封整盒");
  }
  if (
    profile.managementTemplate === "soft_daily" &&
    packagedLensSourceKind === "loose" &&
    availableLooseUnitQuantity(
      lot,
      product,
      inventory.transactions,
      timelineItems
    ) < dailyInitialQuantity
  ) {
    throw new Error("该批次可分配散片不足");
  }
  if (
    profile.managementTemplate === "soft_reusable" &&
    packagedLensSourceKind === "package" &&
    unopenedPackageCount(
      lot,
      product,
      inventory.transactions,
      timelineItems
    ) < 1
  ) {
    throw new Error("该批次已经没有未开封整盒");
  }
  if (
    profile.managementTemplate === "soft_reusable" &&
    packagedLensSourceKind === "loose" &&
    availableReusableLooseUnitQuantity(
      lot,
      product,
      inventory.transactions,
      timelineItems
    ) < 1
  ) {
    throw new Error("该批次已经没有可启用散片");
  }
  if (
    availableUnitsAtLocation(lot, input.locationId, inventory.transactions) <
    requiredSourceQuantity
  ) {
    throw new Error("所选地点的该批次库存不足");
  }

  const durationDays =
    lot.expectedUsageDays ??
    product.defaultDurationDays ??
    profile.defaultDurationDays ??
    90;
  const instanceId = `${product.standardType}-${input.startDate.replaceAll("-", "")}-${crypto.randomUUID()}`;
  const initialReusableCycleId = `lens-${crypto.randomUUID()}`;
  const expectedEndDate =
    input.expectedEndDate ??
    (profile.managementTemplate === "batch_consumable"
      ? addLocalDays(
          input.startDate,
          Math.max(
            0,
            Math.ceil(
              availableUnitsAtLocation(
                lot,
                input.locationId,
                inventory.transactions
              ) /
                Math.max(0.01, input.usageRatePerDay ?? 1)
            ) - 1
          )
        )
      : inclusiveCycleEndDate(input.startDate, durationDays));
  const depletionPredictionDate =
    profile.managementTemplate === "opened_container" &&
    product.capacityMl &&
    input.usageRatePerDay
      ? consumptionPredictionDate(
          input.startDate,
          product.capacityMl,
          input.usageRatePerDay
        )
      : input.depletionPredictionDate ?? expectedEndDate;

  const reservesWholeUnit = ![
    "soft_daily",
    "discrete_dose",
    "batch_consumable"
  ].includes(profile.managementTemplate);
  if (
    profile.managementTemplate === "soft_reusable" &&
    packagedLensSourceKind === "package"
  ) {
    inventory.addTransaction({
      id: `tx-${crypto.randomUUID()}`,
      stockLotId: lot.id,
      occurredDate: input.startDate,
      type: "package_open",
      quantityDelta: 0,
      locationId: input.locationId,
      allocatedUnitQuantity: lotUnitsPerPackage(lot, product),
      relatedInstanceId: instanceId,
      // Opening a reusable-lens box turns all remaining lenses into loose
      // inventory. Deleting the first lens must not recreate a sealed box.
      reversibleWithInstance: false
    });
  }
  if (reservesWholeUnit) {
    inventory.addTransaction({
      id: `tx-${crypto.randomUUID()}`,
      stockLotId: lot.id,
      occurredDate: input.startDate,
      type: "activate",
      quantityDelta: -1,
      locationId: input.locationId,
      relatedInstanceId: instanceId,
      ...(profile.managementTemplate === "soft_reusable"
        ? { relatedCycleId: initialReusableCycleId }
        : {})
    });
  } else if (profile.managementTemplate === "soft_daily") {
    inventory.addTransaction({
      id: `tx-${crypto.randomUUID()}`,
      stockLotId: lot.id,
      occurredDate: input.startDate,
      type:
        packagedLensSourceKind === "package"
          ? "package_open"
          : "loose_allocate",
      quantityDelta: 0,
      locationId: input.locationId,
      allocatedUnitQuantity: dailyInitialQuantity,
      relatedInstanceId: instanceId
    });
  }

  useTimelineItemStore.getState().addItem({
    id: instanceId,
    categoryId: profile.id,
    groupId: profile.groupId,
    categoryName: profile.name,
    productId: product.id,
    sourceStockLotId: lot.id,
    label: input.name,
    detail: "使用中",
    location: location?.name ?? "未设置",
    locationId: location?.id ?? input.locationId,
    locationIntervals: [
      {
        locationId: location?.id ?? input.locationId,
        startDate: input.startDate,
        endDate: null
      }
    ],
    startDate: input.startDate,
    endDate: null,
    ...(!["soft_daily", "discrete_dose"].includes(profile.managementTemplate)
      ? {
          predictionDate:
            profile.managementTemplate === "opened_container"
              ? depletionPredictionDate < expectedEndDate
                ? depletionPredictionDate
                : expectedEndDate
              : expectedEndDate
        }
      : {}),
    ...(profile.managementTemplate === "opened_container"
      ? {
          openedExpiryDate: expectedEndDate,
          depletionPredictionDate,
          ...(product.capacityMl ? { capacityMl: product.capacityMl } : {}),
          ...(input.usageRatePerDay
            ? { usageRatePerDay: input.usageRatePerDay }
            : {})
        }
      : {}),
    ...(["soft_daily", "soft_reusable"].includes(
      profile.managementTemplate
    )
      ? {
          initialUnitQuantity:
            profile.managementTemplate === "soft_daily"
              ? dailyInitialQuantity
              : packagedLensSourceKind === "package"
                ? lotUnitsPerPackage(lot, product)
                : 1,
          inventorySourceKind: packagedLensSourceKind
        }
      : {}),
    ...(profile.managementTemplate === "soft_reusable"
      ? {
          reusableLensCycles: [
            {
              id: initialReusableCycleId,
              label: "镜片 1",
              startDate: input.startDate,
              endDate: null,
              predictionDate: expectedEndDate,
              status: "active" as const
            }
          ]
        }
      : {}),
    ...(profile.managementTemplate === "batch_consumable"
      ? {
          usageRatePerDay: Math.max(0.01, input.usageRatePerDay ?? 1),
          initialUnitQuantity: availableUnitsAtLocation(
            lot,
            input.locationId,
            inventory.transactions
          )
        }
      : {}),
    ...(profile.managementTemplate === "lens_case" && input.eyeSides
      ? {
          eyeSides: input.eyeSides,
          eyeAssignmentIntervals: [
            {
              startDate: input.startDate,
              endDate: null,
              eyeSides: input.eyeSides
            }
          ]
        }
      : {}),
    status: "active",
    stateIntervals: [
      { startDate: input.startDate, endDate: null, status: "active" }
    ]
  });

  return instanceId;
}

export const activatePeriodicItem = activateInventoryItem;
