import type {
  ConsumptionHistoryRange,
  ConsumptionHistoryScope
} from "../../../stores/forecastSettingsStore";
import { addLocalDays, daysBetween, type LocalDate } from "../../../shared/dates/localDate";
import type { ItemProfile } from "../../catalog/catalog.types";
import type { Product } from "../../inventory/inventory.types";
import type { TimelineItem } from "../timeline.types";
import { timelineItemActiveDays } from "./lifecycle";

export interface ConsumptionForecastSettings {
  range: ConsumptionHistoryRange;
  recentProductCount: number;
}

interface ConsumptionHistoryTarget {
  scope: ConsumptionHistoryScope;
  standardType: Product["standardType"];
  profileId: string;
  productId: string;
}

interface ConsumptionRateSample {
  endDate: LocalDate;
  rate: number;
}

function matchesHistoryTarget(
  item: TimelineItem,
  profile: ItemProfile | undefined,
  target?: ConsumptionHistoryTarget
) {
  if (!target) return true;
  if (target.scope === "same_product") return item.productId === target.productId;
  if (target.scope === "same_profile") return item.categoryId === target.profileId;
  return profile?.standardType === target.standardType;
}

function averageRateForRange(
  samples: ConsumptionRateSample[],
  settings: ConsumptionForecastSettings,
  asOfDate: LocalDate
) {
  let selected = samples;
  if (settings.range === "recent_year") {
    selected = selected.filter(
      (sample) =>
        daysBetween(sample.endDate, asOfDate) >= 0 &&
        daysBetween(sample.endDate, asOfDate) <= 365
    );
  } else if (settings.range === "recent_products") {
    selected = [...selected]
      .sort((a, b) => b.endDate.localeCompare(a.endDate))
      .slice(0, Math.max(1, settings.recentProductCount));
  }

  if (!selected.length) return null;
  return selected.reduce((sum, sample) => sum + sample.rate, 0) / selected.length;
}

export function inclusiveCycleEndDate(startDate: LocalDate, durationDays: number) {
  return addLocalDays(startDate, Math.max(1, Math.floor(durationDays)) - 1);
}

export function historicalConsumptionRateMlPerDay(
  items: TimelineItem[],
  profiles: ItemProfile[],
  settings: ConsumptionForecastSettings,
  asOfDate: LocalDate,
  target?: ConsumptionHistoryTarget
) {
  const profileById = new Map(profiles.map((profile) => [profile.id, profile]));
  const samples = items
    .filter(
      (item) =>
        profileById.get(item.categoryId)?.managementTemplate === "opened_container" &&
        matchesHistoryTarget(item, profileById.get(item.categoryId), target) &&
        item.status === "completed" &&
        Boolean(item.endDate) &&
        (item.capacityMl ?? 0) > 0
    )
    .map((item) => ({
      endDate: item.endDate!,
      rate:
        item.capacityMl! /
        Math.max(1, timelineItemActiveDays(item, addLocalDays(item.endDate!, -1)))
    }));

  return averageRateForRange(samples, settings, asOfDate);
}

export function historicalBatchConsumptionRateUnitsPerDay(
  items: TimelineItem[],
  profiles: ItemProfile[],
  settings: ConsumptionForecastSettings,
  asOfDate: LocalDate,
  target?: ConsumptionHistoryTarget
) {
  const profileById = new Map(profiles.map((profile) => [profile.id, profile]));
  const samples = items
    .filter(
      (item) =>
        profileById.get(item.categoryId)?.managementTemplate === "batch_consumable" &&
        matchesHistoryTarget(item, profileById.get(item.categoryId), target) &&
        item.status === "completed" &&
        Boolean(item.endDate) &&
        (item.initialUnitQuantity ?? 0) > 0
    )
    .map((item) => ({
      endDate: item.endDate!,
      rate:
        item.initialUnitQuantity! /
        Math.max(1, timelineItemActiveDays(item, addLocalDays(item.endDate!, -1)))
    }));

  return averageRateForRange(samples, settings, asOfDate);
}

export function consumptionPredictionDate(
  startDate: LocalDate,
  capacityMl: number,
  rateMlPerDay: number
) {
  return inclusiveCycleEndDate(
    startDate,
    Math.ceil(Math.max(0.01, capacityMl) / Math.max(0.01, rateMlPerDay))
  );
}

export function batchConsumptionPredictionDate(
  startDate: LocalDate,
  initialQuantity: number,
  usageRatePerDay: number,
  pausedDays = 0
) {
  const activeDurationDays = Math.ceil(
    Math.max(0, initialQuantity) / Math.max(0.01, usageRatePerDay)
  );
  return addLocalDays(
    startDate,
    Math.max(0, activeDurationDays - 1) + Math.max(0, pausedDays)
  );
}

export function fallbackConsumptionRate(product: Product, profile?: ItemProfile) {
  const capacity = product.capacityMl ?? 0;
  const days = product.defaultDurationDays ?? profile?.defaultDurationDays ?? 90;
  return capacity > 0 ? capacity / Math.max(1, days) : null;
}
