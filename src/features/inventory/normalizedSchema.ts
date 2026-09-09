import type { EyeSide, ManagementTemplate } from "../catalog/catalog.types";
import type { LocalDate } from "../../shared/dates/localDate";
import type { TimelineItem } from "../timeline/timeline.types";

export const normalizedSchemaVersion = 1;

export interface UsageInstanceEntity {
  id: string;
  profileId: string;
  productId: string;
  sourceLotId: string;
  label: string;
  locationId?: string;
  startDate: LocalDate;
  /** Half-open boundary: the user-visible last day is one day earlier. */
  endDateExclusive: LocalDate | null;
  status: TimelineItem["status"];
  endReason?: string;
  profileNameSnapshot: string;
  locationNameSnapshot: string;
}

export interface InstanceStateIntervalEntity {
  instanceId: string;
  sequence: number;
  startDate: LocalDate;
  endDateExclusive: LocalDate | null;
  status: "active" | "paused";
}

export interface ReusableLensCycleEntity {
  id: string;
  instanceId: string;
  label: string;
  startDate: LocalDate;
  endDateExclusive: LocalDate | null;
  predictedEndDate: LocalDate;
  status: "active" | "completed";
  endReason?: string;
}

export interface EyeAssignmentIntervalEntity {
  instanceId: string;
  sequence: number;
  startDate: LocalDate;
  endDateExclusive: LocalDate | null;
  eyeSides: EyeSide[];
}

export interface InstanceLocationIntervalEntity {
  instanceId: string;
  sequence: number;
  locationId: string;
  startDate: LocalDate;
  endDateExclusive: LocalDate | null;
}

export interface ConsumableInstanceDetailEntity {
  instanceId: string;
  initialUnitQuantity?: number;
  capacityMlAtActivation?: number;
  inventorySourceKind?: "package" | "loose";
}

export interface ForecastSnapshotEntity {
  instanceId: string;
  predictedReplacementDate: LocalDate;
  predictedDepletionDate?: LocalDate;
  openedExpiryDate?: LocalDate;
  estimatedRatePerDay?: number;
  method: "fixed_cycle" | "historical_rate";
}

export interface NormalizedInstanceData {
  schemaVersion: number;
  instances: UsageInstanceEntity[];
  stateIntervals: InstanceStateIntervalEntity[];
  reusableLensCycles: ReusableLensCycleEntity[];
  eyeAssignmentIntervals: EyeAssignmentIntervalEntity[];
  locationIntervals: InstanceLocationIntervalEntity[];
  consumableDetails: ConsumableInstanceDetailEntity[];
  forecastSnapshots: ForecastSnapshotEntity[];
}

/** Converts the current UI aggregate into database-oriented entities. */
export function normalizeTimelineItems(
  items: TimelineItem[],
  templateByProfileId: Map<string, ManagementTemplate>
): NormalizedInstanceData {
  const invalid = items.find((item) => !item.productId || !item.sourceStockLotId);
  if (invalid)
    throw new Error(`使用实例 ${invalid.id} 缺少现行产品或批次引用`);
  const validItems = items as Array<
    TimelineItem & { productId: string; sourceStockLotId: string }
  >;
  return {
    schemaVersion: normalizedSchemaVersion,
    instances: validItems.map((item) => ({
      id: item.id,
      profileId: item.categoryId,
      productId: item.productId,
      sourceLotId: item.sourceStockLotId,
      label: item.label,
      ...(item.locationId ? { locationId: item.locationId } : {}),
      startDate: item.startDate,
      endDateExclusive: item.endDate,
      status: item.status,
      ...(item.endReason ? { endReason: item.endReason } : {}),
      profileNameSnapshot: item.categoryName,
      locationNameSnapshot: item.location
    })),
    stateIntervals: validItems.flatMap((item) =>
      (item.stateIntervals ?? []).map((interval, sequence) => ({
        instanceId: item.id,
        sequence,
        startDate: interval.startDate,
        endDateExclusive: interval.endDate,
        status: interval.status
      }))
    ),
    reusableLensCycles: validItems.flatMap((item) =>
      (item.reusableLensCycles ?? []).map((cycle) => ({
        id: cycle.id,
        instanceId: item.id,
        label: cycle.label,
        startDate: cycle.startDate,
        endDateExclusive: cycle.endDate,
        predictedEndDate: cycle.predictionDate,
        status: cycle.status,
        ...(cycle.endReason ? { endReason: cycle.endReason } : {})
      }))
    ),
    eyeAssignmentIntervals: validItems.flatMap((item) =>
      (item.eyeAssignmentIntervals ?? []).map((interval, sequence) => ({
        instanceId: item.id,
        sequence,
        startDate: interval.startDate,
        endDateExclusive: interval.endDate,
        eyeSides: interval.eyeSides
      }))
    ),
    locationIntervals: validItems.flatMap((item) =>
      (item.locationIntervals ?? []).map((interval, sequence) => ({
        instanceId: item.id,
        sequence,
        locationId: interval.locationId,
        startDate: interval.startDate,
        endDateExclusive: interval.endDate
      }))
    ),
    consumableDetails: validItems.flatMap((item) => {
      const template = templateByProfileId.get(item.categoryId);
      if (
        !template ||
        !["soft_daily", "soft_reusable", "opened_container", "batch_consumable"].includes(
          template
        )
      )
        return [];
      return [
        {
          instanceId: item.id,
          ...(item.initialUnitQuantity !== undefined
            ? { initialUnitQuantity: item.initialUnitQuantity }
            : {}),
          ...(item.capacityMl !== undefined
            ? { capacityMlAtActivation: item.capacityMl }
            : {}),
          ...(item.inventorySourceKind
            ? { inventorySourceKind: item.inventorySourceKind }
            : {})
        }
      ];
    }),
    forecastSnapshots: validItems.flatMap((item) =>
      item.predictionDate
        ? [
            {
              instanceId: item.id,
              predictedReplacementDate: item.predictionDate,
              ...(item.depletionPredictionDate
                ? { predictedDepletionDate: item.depletionPredictionDate }
                : {}),
              ...(item.openedExpiryDate
                ? { openedExpiryDate: item.openedExpiryDate }
                : {}),
              ...(item.usageRatePerDay
                ? { estimatedRatePerDay: item.usageRatePerDay }
                : {}),
              method: item.usageRatePerDay
                ? ("historical_rate" as const)
                : ("fixed_cycle" as const)
            }
          ]
        : []
    )
  };
}
