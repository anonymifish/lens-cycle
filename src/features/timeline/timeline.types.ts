import type { LocalDate } from "../../shared/dates/localDate";

export type TimelineStatus = "active" | "paused" | "planned" | "completed";
export type TimelineGroupId = "lenses" | "periodic" | "consumables";

export interface ReusableLensCycle {
  id: string;
  label: string;
  startDate: LocalDate;
  /** Exclusive end boundary; the visible last-use date is one day earlier. */
  endDate: LocalDate | null;
  predictionDate: LocalDate;
  status: "active" | "completed";
  endReason?: string;
}

export interface TimelineItem {
  id: string;
  categoryId: string;
  groupId: TimelineGroupId;
  /** Display snapshot retained when the profile is renamed. */
  categoryName: string;
  productId?: string;
  sourceStockLotId?: string;
  label: string;
  detail: string;
  /** Display snapshot retained with locationId for historical rendering. */
  location: string;
  locationId?: string;
  locationIntervals?: Array<{
    locationId: string;
    startDate: LocalDate;
    endDate: LocalDate | null;
  }>;
  startDate: LocalDate;
  /** Exclusive end boundary; null means the instance is ongoing. */
  endDate: LocalDate | null;
  predictionDate?: LocalDate;
  openedExpiryDate?: LocalDate;
  depletionPredictionDate?: LocalDate;
  initialUnitQuantity?: number;
  capacityMl?: number;
  inventorySourceKind?: "package" | "loose";
  reusableLensCycles?: ReusableLensCycle[];
  usageRatePerDay?: number;
  eyeSides?: Array<"L" | "R">;
  eyeAssignmentIntervals?: Array<{
    startDate: LocalDate;
    endDate: LocalDate | null;
    eyeSides: Array<"L" | "R">;
  }>;
  endReason?: string;
  completionUsageFactId?: string;
  status: TimelineStatus;
  stateIntervals?: Array<{
    startDate: LocalDate;
    /** Exclusive end boundary. */
    endDate: LocalDate | null;
    status: "active" | "paused";
  }>;
}

export type UsageFactKind = "wear" | "extra_loss" | "dose";

export interface UsageFact {
  id: string;
  itemId: string;
  stockLotId: string;
  transactionId: string;
  date: LocalDate;
  kind: UsageFactKind;
  quantity: number;
  reason?: string;
}

export interface TimelineItemDetailsUpdate {
  label: string;
  startDate: LocalDate;
  location: string;
  locationId: string;
  predictionDate?: LocalDate;
  openedExpiryDate?: LocalDate;
  depletionPredictionDate?: LocalDate;
  usageRatePerDay?: number;
}

export type LensCareEventKind = "review" | "protein";

export interface LensCareEvent {
  id: string;
  itemId: string;
  kind: LensCareEventKind;
  plannedDate?: LocalDate;
  completedDate?: LocalDate;
}

export interface TimelineViewport {
  centerDate: LocalDate;
  pixelsPerDay: number;
  viewportWidth: number;
}

export interface VisibleDateRange {
  startDate: LocalDate;
  endDate: LocalDate;
}
