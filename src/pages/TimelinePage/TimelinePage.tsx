import { format } from "date-fns";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent
} from "react";
import { ManageItemsDialog } from "../../features/catalog/components/ManageItemsDialog";
import { itemProfileBaseUnit } from "../../features/catalog/catalog";
import type { EyeSide, ItemProfile } from "../../features/catalog/catalog.types";
import { activateInventoryItem } from "../../features/inventory/activatePeriodicItem";
import type {
  InventoryTransaction,
  Product,
  StockLot
} from "../../features/inventory/inventory.types";
import {
  availableLooseUnitQuantity,
  availableReusableLooseUnitQuantity,
  availableLotsByExpiry,
  availableUnits,
  availableUnitsAtLocation,
  effectiveInventoryTransactions,
  lotUnitsPerPackage,
  productMatchesProfile,
  productAvailableUnits,
  unopenedPackageCount
} from "../../features/inventory/inventory";
import { useItemProfileStore } from "../../stores/itemProfileStore";
import { useInventoryStore } from "../../stores/inventoryStore";
import { useTimelineItemStore } from "../../stores/timelineItemStore";
import { useTimelineCareEventStore } from "../../stores/timelineCareEventStore";
import { useUsageFactStore } from "../../stores/usageFactStore";
import {
  recordUsageFact,
  replaceUsageFact,
  reverseUsageFact
} from "../../features/inventory/usageFacts";
import {
  completeBatchConsumableTimelineItem,
  commitTimelineItemInventoryUpdate,
  commitTimelineItemUpdates,
  commitDataMutation,
  deleteMistakenTimelineItem,
  reopenDiscardedTimelineItems
} from "../../features/inventory/dataMutationRepository";
import { assignGroupedLanes } from "../../features/timeline/domain/intervals";
import {
  careEventDate,
  careEventLabel,
  careEventState
} from "../../features/timeline/domain/careEvents";
import {
  deletePausedInterval,
  editPausedInterval,
  endTimelineItem,
  pauseTimelineItem,
  reopenTimelineItem,
  replacementCountdownText,
  resumeTimelineItem,
  timelineItemActiveDays,
  timelineItemUsageSummary,
  timelineItemUsedDays
} from "../../features/timeline/domain/lifecycle";
import { buildTimelineTicks } from "../../features/timeline/domain/ticks";
import {
  reusableCycleActualEndDate,
  reusableCycleEndIsValid,
  reusableCycleStartIsValid
} from "../../features/timeline/domain/reusableCycle";
import {
  applyLensCaseEyeSwitch,
  lensCasePredictionDate
} from "../../features/timeline/domain/lensCase";
import {
  editTimelineLocationInterval,
  timelineLocationIdAtDate
} from "../../features/timeline/domain/locationHistory";
import {
  dateToX,
  panViewport,
  pixelsPerDayForSpan,
  visibleDateRange,
  xToDayCellDate,
  zoomAtX
} from "../../features/timeline/domain/viewport";
import type {
  TimelineGroupId,
  TimelineItem,
  LensCareEventKind,
  TimelineStatus
} from "../../features/timeline/timeline.types";
import {
  addLocalDays,
  daysBetween,
  displayLocalDate,
  parseLocalDate,
  todayLocalDate,
  type LocalDate
} from "../../shared/dates/localDate";
import { Icon } from "../../shared/components/Icon";
import { EmptyState } from "../../shared/components/EmptyState";
import { LocalDateInput } from "../../shared/components/LocalDateInput";
import { useTimelineViewportStore } from "../../stores/timelineViewportStore";
import { useForecastSettingsStore } from "../../stores/forecastSettingsStore";
import {
  batchConsumptionPredictionDate,
  consumptionPredictionDate,
  fallbackConsumptionRate,
  historicalConsumptionRateMlPerDay,
  inclusiveCycleEndDate
} from "../../features/timeline/domain/forecast";
import { LifecycleHistorySection, type LifecycleHistoryEntry } from "./LifecycleHistorySection";
import styles from "./TimelinePage.module.css";

const LEFT_PANEL_WIDTH = 270;
const GROUP_ROW_HEIGHT = 44;
const CATEGORY_BASE_HEIGHT = 54;
const LANE_HEIGHT = 30;

function productSummaryName(product: Product) {
  return [product.brand, product.model].filter(Boolean).join(" · ");
}

function usesPackagedLensInventory(profile?: ItemProfile) {
  return (
    profile?.managementTemplate === "soft_daily" || profile?.managementTemplate === "soft_reusable"
  );
}

function initialAddInventorySource(
  profile: ItemProfile | undefined,
  lot: StockLot | undefined,
  product: Product | undefined,
  transactions: InventoryTransaction[],
  items: TimelineItem[]
): "package" | "loose" {
  if (!usesPackagedLensInventory(profile) || !lot || !product) return "package";
  return unopenedPackageCount(lot, product, transactions, items) < 1 ? "loose" : "package";
}

function reusableLensCyclesFor(item: TimelineItem) {
  return item.reusableLensCycles ?? [];
}

function eyeAssignmentIntervalsFor(item: TimelineItem) {
  return item.eyeAssignmentIntervals ?? [];
}

function eyeUsageTotals(
  intervals: ReturnType<typeof eyeAssignmentIntervalsFor>,
  asOfDate: LocalDate
) {
  return intervals.reduce((totals, interval) => {
    const intervalEnd = interval.endDate ?? asOfDate;
    const days = Math.max(
      0,
      daysBetween(interval.startDate, intervalEnd) + (interval.endDate ? 0 : 1)
    );
    interval.eyeSides.forEach((side) => totals.set(side, (totals.get(side) ?? 0) + days));
    return totals;
  }, new Map<EyeSide, number>());
}

const groupMeta: Record<TimelineGroupId, { title: string }> = {
  lenses: { title: "镜片" },
  periodic: { title: "周期更换用品" },
  consumables: { title: "消耗品" }
};

const statusMeta: Record<TimelineStatus, string> = {
  active: "使用中",
  paused: "暂停使用",
  planned: "计划",
  completed: "结束使用"
};

type StatusFilter = "all" | TimelineStatus;

interface RowLayout {
  key: string;
  type: "group" | "category";
  groupId: TimelineGroupId;
  categoryId?: string;
  categoryName?: string;
  y: number;
  height: number;
  laneByItem: Map<string, number>;
}

interface PendingMove {
  itemId: string;
  days: number;
}

interface UndoMove {
  itemId: string;
  oldStart: LocalDate;
  oldEnd: LocalDate | null;
  oldPredictionDate: LocalDate | undefined;
  oldOpenedExpiryDate: LocalDate | undefined;
  oldDepletionPredictionDate: LocalDate | undefined;
  oldStateIntervals: TimelineItem["stateIntervals"];
  oldLocationIntervals: TimelineItem["locationIntervals"];
  oldEyeAssignmentIntervals: TimelineItem["eyeAssignmentIntervals"];
  oldReusableLensCycles: TimelineItem["reusableLensCycles"];
}

type CareEventDialog = { mode: "create" } | { mode: "edit"; eventId: string } | null;

type UsageAction = "wear" | "loss" | "dose" | "discard" | null;

function TimelineLegend() {
  const eventLegend = [
    { kind: "review", completed: true, label: "复查" },
    { kind: "review", completed: false, label: "计划复查" },
    { kind: "protein", completed: true, label: "除蛋白" },
    { kind: "protein", completed: false, label: "计划除蛋白" }
  ] as const;

  return (
    <div className={styles.legend}>
      {(["active", "paused"] as TimelineStatus[]).map((status) => (
        <span key={status}>
          <i className={styles[`legend_${status}`]} />
          {statusMeta[status]}
        </span>
      ))}
      <span>
        <i className={styles.legendHistoricalPaused} />
        历史暂停
      </span>
      <span>
        <i className={styles.legend_completed} />
        {statusMeta.completed}
      </span>
      <span>
        <svg aria-hidden="true" className={styles.legendLoss} viewBox="-8 -8 16 16">
          <path d="M0-7 5 0 0 7-5 0Z" />
        </svg>
        额外损耗
      </span>
      {eventLegend.map((event) => (
        <span key={event.label}>
          <svg
            aria-hidden="true"
            className={`${styles.legendEvent} ${
              event.kind === "review" ? styles.legendReview : styles.legendProtein
            } ${event.completed ? styles.legendEventCompleted : styles.legendEventPlanned}`}
            viewBox="-8 -8 16 16"
          >
            {event.kind === "review" ? (
              <circle r="5" />
            ) : (
              <path d="M0-7C0-7-5-1-5 2.5a5 5 0 0 0 10 0C5-1 0-7 0-7Z" />
            )}
          </svg>
          {event.label}
        </span>
      ))}
      <span>
        <i className={styles.legend_forecast} />
        计划／预测
      </span>
      <span className={styles.legendHint}>拖动空白区域平移 · Ctrl + 滚轮缩放</span>
    </div>
  );
}

export function TimelinePage({ onNavigateToInventory }: { onNavigateToInventory?: () => void }) {
  const plotRef = useRef<HTMLDivElement>(null);
  const viewport = useTimelineViewportStore((state) => state.viewport);
  const setViewport = useTimelineViewportStore((state) => state.setViewport);
  const setViewportWidth = useTimelineViewportStore((state) => state.setViewportWidth);
  const expandedGroups = useTimelineViewportStore((state) => state.expandedGroups);
  const toggleGroup = useTimelineViewportStore((state) => state.toggleGroup);
  const profiles = useItemProfileStore((state) => state.profiles);
  const products = useInventoryStore((state) => state.products);
  const lots = useInventoryStore((state) => state.lots);
  const transactions = useInventoryStore((state) => state.transactions);
  const locations = useInventoryStore((state) => state.locations);

  const items = useTimelineItemStore((state) => state.items);
  const setItems = useTimelineItemStore((state) => state.setItems);
  const careEvents = useTimelineCareEventStore((state) => state.events);
  const addCareEvent = useTimelineCareEventStore((state) => state.addEvent);
  const updateCareEvent = useTimelineCareEventStore((state) => state.updateEvent);
  const completeCareEvent = useTimelineCareEventStore((state) => state.completeEvent);
  const deleteCareEvent = useTimelineCareEventStore((state) => state.deleteEvent);
  const usageFacts = useUsageFactStore((state) => state.facts);
  const rescheduleActivation = useInventoryStore((state) => state.rescheduleActivation);
  const consumptionHistoryRange = useForecastSettingsStore(
    (state) => state.consumptionHistoryRange
  );
  const recentProductCount = useForecastSettingsStore((state) => state.recentProductCount);
  const consumptionHistoryScope = useForecastSettingsStore(
    (state) => state.consumptionHistoryScope
  );
  const [search, setSearch] = useState("");
  const [showSearch, setShowSearch] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [showManageItems, setShowManageItems] = useState(false);
  const [addProfileId, setAddProfileId] = useState("");
  const [addProductId, setAddProductId] = useState("");
  const [addLotId, setAddLotId] = useState("");
  const [addDailySource, setAddDailySource] = useState<"package" | "loose">("package");
  const [addStartDate, setAddStartDate] = useState<LocalDate>(todayLocalDate());
  const [addExpectedEndDate, setAddExpectedEndDate] = useState<LocalDate>(todayLocalDate());
  const [addDepletionDate, setAddDepletionDate] = useState<LocalDate>(todayLocalDate());
  const [addNotice, setAddNotice] = useState<string | null>(null);
  const [editingDetails, setEditingDetails] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [lifecycleAction, setLifecycleAction] = useState<
    "pause" | "resume" | "end" | "reopen" | "next" | null
  >(null);
  const [editingPauseIndex, setEditingPauseIndex] = useState<number | null>(null);
  const [lifecycleError, setLifecycleError] = useState<string | null>(null);
  const [careEventDialog, setCareEventDialog] = useState<CareEventDialog>(null);
  const [confirmCareEventId, setConfirmCareEventId] = useState<string | null>(null);
  const [careEventError, setCareEventError] = useState<string | null>(null);
  const [showAllCareEvents, setShowAllCareEvents] = useState(false);
  const [showDeleteItemDialog, setShowDeleteItemDialog] = useState(false);
  const [deleteItemError, setDeleteItemError] = useState<string | null>(null);
  const [actionSubmitting, setActionSubmitting] = useState(false);
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const [usageAction, setUsageAction] = useState<UsageAction>(null);
  const [usageError, setUsageError] = useState<string | null>(null);
  const [showAllUsageFacts, setShowAllUsageFacts] = useState(false);
  const [showAssignmentDialog, setShowAssignmentDialog] = useState(false);
  const [assignmentError, setAssignmentError] = useState<string | null>(null);
  const [editingEyeIntervalIndex, setEditingEyeIntervalIndex] = useState<number | null>(null);
  const [editingLocationIntervalIndex, setEditingLocationIntervalIndex] = useState<number | null>(
    null
  );
  const [locationHistoryError, setLocationHistoryError] = useState<string | null>(null);
  const [editingUsageFactId, setEditingUsageFactId] = useState<string | null>(null);
  const [editingReusableCycleId, setEditingReusableCycleId] = useState<string | null>(null);
  const [reusableCycleError, setReusableCycleError] = useState<string | null>(null);
  const [usageDefaultDate, setUsageDefaultDate] = useState<LocalDate>(todayLocalDate());
  const [pendingMove, setPendingMove] = useState<PendingMove | null>(null);
  const [undoMove, setUndoMove] = useState<UndoMove | null>(null);
  const [dragPreview, setDragPreview] = useState<{ itemId: string; days: number } | null>(null);
  const pointerAction = useRef<
    | { type: "pan"; startX: number; initialViewport: typeof viewport }
    | { type: "bar"; startX: number; itemId: string }
    | null
  >(null);

  useEffect(() => {
    const element = plotRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setViewportWidth(Math.max(320, entry.contentRect.width));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [setViewportWidth]);

  const range = useMemo(() => visibleDateRange(viewport), [viewport]);
  const profileById = useMemo(
    () => new Map(profiles.map((profile) => [profile.id, profile])),
    [profiles]
  );

  useEffect(() => {
    const asOfDate = todayLocalDate();
    let changed = false;
    const nextItems = items.map((item) => {
      const profile = profileById.get(item.categoryId);
      const product = products.find((entry) => entry.id === item.productId);
      if (
        item.status === "completed" ||
        profile?.managementTemplate !== "opened_container" ||
        !product?.capacityMl
      ) {
        return item;
      }
      const rate =
        historicalConsumptionRateMlPerDay(
          items,
          profiles,
          { range: consumptionHistoryRange, recentProductCount },
          asOfDate,
          {
            scope: consumptionHistoryScope,
            standardType: profile.standardType,
            profileId: profile.id,
            productId: product.id
          }
        ) ?? fallbackConsumptionRate(product, profile);
      if (!rate) return item;
      const elapsedCalendarDays = Math.max(0, daysBetween(item.startDate, asOfDate) + 1);
      const pausedDays = Math.max(0, elapsedCalendarDays - timelineItemActiveDays(item, asOfDate));
      const depletionPredictionDate = addLocalDays(
        consumptionPredictionDate(item.startDate, product.capacityMl, rate),
        pausedDays
      );
      const predictionDate =
        item.openedExpiryDate && item.openedExpiryDate < depletionPredictionDate
          ? item.openedExpiryDate
          : depletionPredictionDate;
      if (
        item.capacityMl === product.capacityMl &&
        item.usageRatePerDay === rate &&
        item.predictionDate === predictionDate &&
        item.depletionPredictionDate === depletionPredictionDate
      ) {
        return item;
      }
      changed = true;
      return {
        ...item,
        capacityMl: product.capacityMl,
        usageRatePerDay: rate,
        predictionDate,
        depletionPredictionDate
      };
    });
    if (changed) {
      void commitTimelineItemUpdates(() => nextItems);
    }
  }, [
    consumptionHistoryRange,
    consumptionHistoryScope,
    items,
    products,
    profileById,
    profiles,
    recentProductCount,
    setItems
  ]);
  const addProfile = profileById.get(addProfileId);
  const addProducts = addProfile
    ? products.filter((product) => productMatchesProfile(product, addProfile))
    : [];
  const selectedAddProduct =
    addProducts.find((product) => product.id === addProductId) ?? addProducts[0];
  const addBaseUnit = selectedAddProduct?.baseUnit ?? itemProfileBaseUnit(addProfile);
  const addLots = selectedAddProduct
    ? availableLotsByExpiry(selectedAddProduct, lots, transactions, items)
    : [];
  const selectedAddLot = addLots.find((lot) => lot.id === addLotId) ?? addLots[0];
  const addSourceLocations = selectedAddLot
    ? locations.filter(
        (location) =>
          location.active && availableUnitsAtLocation(selectedAddLot, location.id, transactions) > 0
      )
    : [];
  const selectedAddConsumptionRate =
    addProfile?.managementTemplate === "opened_container" && selectedAddProduct
      ? (historicalConsumptionRateMlPerDay(
          items,
          profiles,
          {
            range: consumptionHistoryRange,
            recentProductCount
          },
          todayLocalDate(),
          {
            scope: consumptionHistoryScope,
            standardType: addProfile.standardType,
            profileId: addProfile.id,
            productId: selectedAddProduct.id
          }
        ) ?? fallbackConsumptionRate(selectedAddProduct, addProfile))
      : null;
  const selectedUsesPackagedLensInventory = usesPackagedLensInventory(addProfile);
  const selectedPackagedUnopenedPackages =
    selectedUsesPackagedLensInventory && selectedAddLot && selectedAddProduct
      ? unopenedPackageCount(selectedAddLot, selectedAddProduct, transactions, items)
      : 0;
  const selectedPackagedLooseUnits =
    selectedUsesPackagedLensInventory && selectedAddLot && selectedAddProduct
      ? addProfile?.managementTemplate === "soft_reusable"
        ? availableReusableLooseUnitQuantity(
            selectedAddLot,
            selectedAddProduct,
            transactions,
            items
          )
        : availableLooseUnitQuantity(selectedAddLot, selectedAddProduct, transactions, items)
      : 0;
  const addTemplateSupported = Boolean(addProfile);
  const addNeedsExpectedEnd =
    addProfile?.managementTemplate === "rigid_long_term" ||
    addProfile?.managementTemplate === "soft_reusable" ||
    addProfile?.managementTemplate === "lens_case" ||
    addProfile?.managementTemplate === "lens_accessory" ||
    addProfile?.managementTemplate === "opened_container";

  const filteredItems = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return items.filter(
      (item) =>
        (statusFilter === "all" || item.status === statusFilter) &&
        (!query ||
          item.label.toLocaleLowerCase().includes(query) ||
          (profileById.get(item.categoryId)?.name ?? item.categoryName)
            .toLocaleLowerCase()
            .includes(query) ||
          item.location.toLocaleLowerCase().includes(query))
    );
  }, [items, profileById, search, statusFilter]);
  const activeProfiles = profiles.filter((profile) => profile.active);
  const hasConfiguredProducts = products.some((product) =>
    activeProfiles.some((profile) => profile.id === product.itemProfileId)
  );
  const hasUsableInventory = lots.some((lot) => {
    const product = products.find((entry) => entry.id === lot.productId);
    return (
      Boolean(product && activeProfiles.some((profile) => profile.id === product.itemProfileId)) &&
      availableUnits(lot.id, transactions) > 0
    );
  });
  const hasEmptyFilterResult =
    items.length > 0 &&
    filteredItems.length === 0 &&
    (Boolean(search.trim()) || statusFilter !== "all");

  const { rows, totalHeight } = useMemo(() => {
    const nextRows: RowLayout[] = [];
    let y = 0;
    for (const groupId of Object.keys(groupMeta) as TimelineGroupId[]) {
      nextRows.push({
        key: `group-${groupId}`,
        type: "group",
        groupId,
        y,
        height: GROUP_ROW_HEIGHT,
        laneByItem: new Map()
      });
      y += GROUP_ROW_HEIGHT;
      if (!expandedGroups[groupId]) continue;

      const normalizedQuery = search.trim().toLocaleLowerCase();
      const categories = profiles
        .filter((profile) => profile.groupId === groupId)
        .filter((profile) => profile.active || items.some((item) => item.categoryId === profile.id))
        .filter((profile) => {
          const hasMatchingItem = filteredItems.some((item) => item.categoryId === profile.id);
          const matchesSearch =
            !normalizedQuery ||
            profile.name.toLocaleLowerCase().includes(normalizedQuery) ||
            hasMatchingItem;
          const matchesStatus = statusFilter === "all" || hasMatchingItem;
          return matchesSearch && matchesStatus;
        })
        .sort((a, b) => a.order - b.order);

      for (const profile of categories) {
        const categoryId = profile.id;
        const categoryItems = filteredItems.filter((item) => item.categoryId === categoryId);
        const productOrder = new Map(
          products
            .filter((product) => productMatchesProfile(product, profile))
            .sort(
              (left, right) =>
                (left.sortOrder ?? Number.MAX_SAFE_INTEGER) -
                  (right.sortOrder ?? Number.MAX_SAFE_INTEGER) ||
                productSummaryName(left).localeCompare(productSummaryName(right)) ||
                left.id.localeCompare(right.id)
            )
            .map((product, index) => [product.id, index])
        );
        const laneLayout = assignGroupedLanes(
          categoryItems.map((item) => ({
            instanceId: item.id,
            startDate: item.startDate,
            endDate: item.endDate,
            laneGroupId: item.productId ?? item.id,
            laneGroupOrder:
              (item.productId ? productOrder.get(item.productId) : undefined) ??
              Number.MAX_SAFE_INTEGER
          })),
          range.startDate,
          range.endDate
        );
        const laneByItem = new Map(
          laneLayout.assignments.map((assignment) => [assignment.instanceId, assignment.laneIndex])
        );
        const laneCount = Math.max(1, laneLayout.laneCount);
        const profileProductCount = products.filter((product) =>
          productMatchesProfile(product, profile)
        ).length;
        const runningBatchProductCount = new Set(
          categoryItems.filter((item) => item.status !== "completed").map((item) => item.productId)
        ).size;
        const replacementSummaryCount =
          profile.managementTemplate === "rigid_long_term"
            ? categoryItems.filter((item) => item.status !== "completed").length
            : profile.managementTemplate === "batch_consumable" && runningBatchProductCount > 0
              ? runningBatchProductCount
              : profileProductCount;
        const contentRows = Math.max(laneCount, replacementSummaryCount, 1);
        const height = CATEGORY_BASE_HEIGHT + (contentRows - 1) * LANE_HEIGHT;
        nextRows.push({
          key: `category-${categoryId}`,
          type: "category",
          groupId,
          categoryId,
          categoryName: profile.name,
          y,
          height,
          laneByItem
        });
        y += height;
      }
    }
    return { rows: nextRows, totalHeight: y };
  }, [
    expandedGroups,
    filteredItems,
    items,
    profiles,
    products,
    range.endDate,
    range.startDate,
    search,
    statusFilter
  ]);

  const timelineTicks = useMemo(
    () => buildTimelineTicks(range.startDate, range.endDate, viewport.pixelsPerDay),
    [range.endDate, range.startDate, viewport.pixelsPerDay]
  );

  const selectedItem = items.find((item) => item.id === selectedItemId) ?? null;
  const selectedProfile = selectedItem ? profileById.get(selectedItem.categoryId) : undefined;
  const selectedProduct = selectedItem
    ? products.find((product) => product.id === selectedItem.productId)
    : undefined;
  const selectedBaseUnit = selectedProduct?.baseUnit ?? itemProfileBaseUnit(selectedProfile);
  const selectedLot = selectedItem
    ? lots.find((lot) => lot.id === selectedItem.sourceStockLotId)
    : undefined;
  const selectedSourceAvailableUnits = selectedLot
    ? availableUnits(selectedLot.id, transactions)
    : 0;
  const selectedLocationAvailableUnits =
    selectedLot && selectedItem?.locationId
      ? availableUnitsAtLocation(selectedLot, selectedItem.locationId, transactions)
      : 0;
  const selectedLocation = selectedItem
    ? (locations.find((location) => location.id === selectedItem.locationId) ??
      locations.find((location) => location.name === selectedItem.location))
    : undefined;
  const selectedCareEvents = selectedItem
    ? careEvents
        .filter((event) => event.itemId === selectedItem.id)
        .sort((a, b) => {
          const aCompleted = Boolean(a.completedDate);
          const bCompleted = Boolean(b.completedDate);
          if (aCompleted !== bCompleted) return aCompleted ? 1 : -1;
          const aDate = careEventDate(a) ?? "9999-12-31";
          const bDate = careEventDate(b) ?? "9999-12-31";
          return aCompleted ? bDate.localeCompare(aDate) : aDate.localeCompare(bDate);
        })
    : [];
  const visibleCareEvents = showAllCareEvents ? selectedCareEvents : selectedCareEvents.slice(0, 3);
  const lifecycleHistory: LifecycleHistoryEntry[] = selectedItem
    ? [
        {
          date: selectedItem.startDate,
          label: "启用",
          detail: "实例开始使用"
        },
        ...(selectedItem.stateIntervals ?? []).flatMap((interval, index) => {
          if (interval.status !== "paused") return [];
          const entries: LifecycleHistoryEntry[] = [
            {
              date: interval.startDate,
              label: "暂停使用",
              detail: interval.endDate ? "历史暂停阶段" : "当前仍在暂停",
              pauseIndex: index
            }
          ];
          if (interval.endDate && index < (selectedItem.stateIntervals?.length ?? 0) - 1) {
            entries.push({
              date: interval.endDate,
              label: "恢复使用",
              detail: "结束暂停阶段"
            });
          }
          return entries;
        }),
        ...(selectedItem.status === "completed" && selectedItem.endDate
          ? [
              {
                date: addLocalDays(selectedItem.endDate, -1),
                label: "结束使用",
                detail: `共使用 ${timelineItemUsedDays(selectedItem, todayLocalDate())} 天`
              }
            ]
          : [])
      ].sort((a, b) => a.date.localeCompare(b.date))
    : [];
  const editingCareEvent =
    careEventDialog?.mode === "edit"
      ? careEvents.find((event) => event.id === careEventDialog.eventId)
      : undefined;
  const confirmingCareEvent = confirmCareEventId
    ? careEvents.find((event) => event.id === confirmCareEventId)
    : undefined;
  const selectedItemUsedDays = selectedItem
    ? timelineItemUsedDays(selectedItem, todayLocalDate())
    : 0;
  const selectedUsageFacts = selectedItem
    ? usageFacts
        .filter((fact) => fact.itemId === selectedItem.id)
        .sort((a, b) => b.date.localeCompare(a.date))
    : [];
  const visibleUsageFacts = showAllUsageFacts ? selectedUsageFacts : selectedUsageFacts.slice(0, 3);
  const selectedUsedQuantity = selectedUsageFacts.reduce((total, fact) => total + fact.quantity, 0);
  const selectedReusableCycles =
    selectedItem && selectedProfile?.managementTemplate === "soft_reusable"
      ? reusableLensCyclesFor(selectedItem)
      : [];
  const selectedReusableCapacity =
    selectedProfile?.managementTemplate === "soft_reusable" && selectedItem
      ? (selectedItem.initialUnitQuantity ??
        (selectedLot && selectedProduct ? lotUnitsPerPackage(selectedLot, selectedProduct) : 1))
      : selectedItem?.initialUnitQuantity;
  const selectedReusableLossQuantity = selectedUsageFacts
    .filter((fact) => fact.kind === "extra_loss")
    .reduce((total, fact) => total + fact.quantity, 0);
  const editingReusableCycle = editingReusableCycleId
    ? selectedReusableCycles.find((cycle) => cycle.id === editingReusableCycleId)
    : undefined;
  const selectedReusableRecords = [
    ...selectedReusableCycles.map((cycle) => ({
      type: "cycle" as const,
      date: cycle.startDate,
      cycle
    })),
    ...selectedUsageFacts.map((fact) => ({
      type: "loss" as const,
      date: fact.date,
      fact
    }))
  ].sort((a, b) => b.date.localeCompare(a.date));
  const visibleReusableRecords = showAllUsageFacts
    ? selectedReusableRecords
    : selectedReusableRecords.slice(0, 3);
  const selectedRemainingQuantity = selectedReusableCapacity
    ? Math.max(
        0,
        selectedReusableCapacity -
          (selectedProfile?.managementTemplate === "soft_reusable"
            ? selectedReusableCycles.length + selectedReusableLossQuantity
            : selectedUsedQuantity)
      )
    : null;
  const selectedEyeAssignmentIntervals = selectedItem
    ? eyeAssignmentIntervalsFor(selectedItem)
    : [];
  const selectedEyeSides = selectedEyeAssignmentIntervals.at(-1)?.eyeSides ?? [];
  const selectedAssignmentUsage = selectedEyeAssignmentIntervals.length
    ? Array.from(eyeUsageTotals(selectedEyeAssignmentIntervals, todayLocalDate()))
    : [];
  const selectedLensCaseDurationDays =
    selectedProduct?.defaultDurationDays ?? selectedProfile?.defaultDurationDays ?? 90;
  const selectedEyeExpectedDates =
    selectedProfile?.managementTemplate === "lens_case"
      ? selectedEyeSides.map((side) => {
          const usedDays =
            selectedAssignmentUsage.find(([entrySide]) => entrySide === side)?.[1] ?? 0;
          return {
            side,
            date: addLocalDays(
              todayLocalDate(),
              Math.max(0, selectedLensCaseDurationDays - usedDays)
            )
          };
        })
      : [];
  const editingEyeInterval =
    editingEyeIntervalIndex === null
      ? undefined
      : selectedEyeAssignmentIntervals[editingEyeIntervalIndex];
  const selectedHasActivation = selectedItem
    ? effectiveInventoryTransactions(transactions).some(
        (transaction) =>
          (transaction.type === "activate" ||
            transaction.type === "package_open" ||
            transaction.type === "loose_allocate") &&
          transaction.relatedInstanceId === selectedItem.id
      )
    : false;
  const selectedPredictedQuantity =
    selectedProfile?.managementTemplate === "batch_consumable" && selectedItem
      ? Math.max(
          0,
          (selectedItem.initialUnitQuantity ?? 0) -
            timelineItemActiveDays(selectedItem, todayLocalDate()) *
              (selectedItem.usageRatePerDay ?? 1)
        )
      : null;
  const editingUsageFact = editingUsageFactId
    ? usageFacts.find((fact) => fact.id === editingUsageFactId)
    : undefined;

  function applyPreset(days: number) {
    setViewport({
      ...viewport,
      pixelsPerDay: pixelsPerDayForSpan(viewport.viewportWidth, days)
    });
  }

  function estimatedConsumptionDate(
    profile: ItemProfile,
    product: (typeof products)[number],
    startDate: LocalDate
  ) {
    const rate =
      historicalConsumptionRateMlPerDay(
        items,
        profiles,
        { range: consumptionHistoryRange, recentProductCount },
        todayLocalDate(),
        {
          scope: consumptionHistoryScope,
          standardType: profile.standardType,
          profileId: profile.id,
          productId: product.id
        }
      ) ?? fallbackConsumptionRate(product, profile);
    return product.capacityMl && rate
      ? consumptionPredictionDate(startDate, product.capacityMl, rate)
      : inclusiveCycleEndDate(
          startDate,
          product.defaultDurationDays ?? profile.defaultDurationDays ?? 90
        );
  }

  function renderCategorySummary(categoryId: string) {
    const profile = profileById.get(categoryId);
    const categoryItems = filteredItems.filter((item) => item.categoryId === categoryId);
    if (profile?.managementTemplate === "rigid_long_term") {
      const currentItems = categoryItems.filter((item) => item.status !== "completed");
      if (currentItems.length === 0) return <small>暂无待更换实例</small>;
      const showNames = currentItems.length > 1;
      return (
        <div className={styles.replacementSummaries}>
          {currentItems.map((item) => (
            <small key={item.id} title={item.label}>
              {showNames ? `${item.label} · ` : ""}
              {item.predictionDate
                ? replacementCountdownText(item.predictionDate, todayLocalDate())
                : "未设置预计更换日期"}
            </small>
          ))}
        </div>
      );
    }
    const profileProducts = products.filter(
      (product) => profile && productMatchesProfile(product, profile)
    );
    if (
      profile?.managementTemplate === "soft_daily" ||
      profile?.managementTemplate === "soft_reusable"
    ) {
      const stocks = profileProducts.map((product) => ({
        product,
        quantity: productAvailableUnits(product.id, lots, transactions)
      }));
      if (stocks.length === 0) return <small>暂无产品库存</small>;
      if (stocks.length === 1) {
        return (
          <small>
            剩余 {stocks[0]!.quantity} {stocks[0]!.product.baseUnit}
          </small>
        );
      }
      return (
        <div className={styles.replacementSummaries}>
          {stocks.map(({ product, quantity }) => (
            <small key={product.id}>
              {productSummaryName(product)} · 剩余 {quantity} {product.baseUnit}
            </small>
          ))}
        </div>
      );
    }
    if (profile?.managementTemplate === "batch_consumable") {
      const runningItems = categoryItems.filter((item) => item.status !== "completed");
      if (runningItems.length > 0) {
        const predictedStocks = profileProducts
          .map((product) => {
            const productItems = runningItems.filter((item) => item.productId === product.id);
            return {
              product,
              quantity: productItems.reduce(
                (total, item) =>
                  total +
                  Math.max(
                    0,
                    (item.initialUnitQuantity ?? 0) -
                      timelineItemActiveDays(item, todayLocalDate()) * (item.usageRatePerDay ?? 1)
                  ),
                0
              )
            };
          })
          .filter(({ product }) => runningItems.some((item) => item.productId === product.id));
        if (predictedStocks.length === 1) {
          const stock = predictedStocks[0]!;
          return (
            <small>
              预计剩余 {Math.round(stock.quantity)} {stock.product.baseUnit}
            </small>
          );
        }
        return (
          <div className={styles.replacementSummaries}>
            {predictedStocks.map(({ product, quantity }) => (
              <small key={product.id}>
                {productSummaryName(product)} · 预计剩余 {Math.round(quantity)} {product.baseUnit}
              </small>
            ))}
          </div>
        );
      }
      const actualStocks = profileProducts.map((product) => ({
        product,
        quantity: productAvailableUnits(product.id, lots, transactions)
      }));
      if (actualStocks.length === 1) {
        return (
          <small>
            实际库存 {actualStocks[0]!.quantity} {actualStocks[0]!.product.baseUnit}
          </small>
        );
      }
      return (
        <div className={styles.replacementSummaries}>
          {actualStocks.map(({ product, quantity }) => (
            <small key={product.id}>
              {productSummaryName(product)} · 实际库存 {quantity} {product.baseUnit}
            </small>
          ))}
        </div>
      );
    }
    if (profileProducts.length > 0) {
      const stocks = profileProducts.map((product) => ({
        product,
        quantity: productAvailableUnits(product.id, lots, transactions)
      }));
      if (stocks.length === 1) {
        return (
          <small>
            剩余 {stocks[0]!.quantity} {stocks[0]!.product.baseUnit}
          </small>
        );
      }
      return (
        <div className={styles.replacementSummaries}>
          {stocks.map(({ product, quantity }) => (
            <small key={product.id}>
              {productSummaryName(product)} · 剩余 {quantity} {product.baseUnit}
            </small>
          ))}
        </div>
      );
    }
    return (
      <small>{categoryItems.length === 0 ? "暂无记录" : `${categoryItems.length} 个实例`}</small>
    );
  }

  function handleWheel(event: WheelEvent<HTMLDivElement>) {
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    if (event.ctrlKey || event.metaKey) {
      const factor = Math.exp(-event.deltaY * 0.0025);
      setViewport(zoomAtX(viewport, event.clientX - rect.left, factor));
      return;
    }
    const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
    if (event.shiftKey || Math.abs(event.deltaX) > 0) {
      setViewport(panViewport(viewport, -delta));
    }
  }

  function handlePlotPointerDown(event: ReactPointerEvent<SVGSVGElement>) {
    if (event.button !== 0 || event.target !== event.currentTarget) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    pointerAction.current = { type: "pan", startX: event.clientX, initialViewport: viewport };
  }

  function handleBarPointerDown(event: ReactPointerEvent<SVGGElement>, itemId: string) {
    if (event.button !== 0) return;
    if (usageFacts.some((fact) => fact.itemId === itemId)) return;
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    pointerAction.current = { type: "bar", startX: event.clientX, itemId };
    setDragPreview({ itemId, days: 0 });
  }

  function handlePointerMove(event: ReactPointerEvent<SVGSVGElement>) {
    const action = pointerAction.current;
    if (!action) return;
    if (action.type === "pan") {
      setViewport(panViewport(action.initialViewport, event.clientX - action.startX));
    } else {
      setDragPreview({
        itemId: action.itemId,
        days: Math.round((event.clientX - action.startX) / viewport.pixelsPerDay)
      });
    }
  }

  function finishPointerAction() {
    const action = pointerAction.current;
    if (action?.type === "bar" && dragPreview && dragPreview.days !== 0) {
      setPendingMove({ itemId: action.itemId, days: dragPreview.days });
    }
    pointerAction.current = null;
    setDragPreview(null);
  }

  async function confirmMove() {
    if (!pendingMove) return;
    const source = items.find((item) => item.id === pendingMove.itemId);
    if (!source) return;
    const undo = {
      itemId: source.id,
      oldStart: source.startDate,
      oldEnd: source.endDate,
      oldPredictionDate: source.predictionDate,
      oldOpenedExpiryDate: source.openedExpiryDate,
      oldDepletionPredictionDate: source.depletionPredictionDate,
      oldStateIntervals: source.stateIntervals,
      oldLocationIntervals: source.locationIntervals,
      oldEyeAssignmentIntervals: source.eyeAssignmentIntervals,
      oldReusableLensCycles: source.reusableLensCycles
    };
    try {
      await commitDataMutation(() => {
        rescheduleActivation(source.id, addLocalDays(source.startDate, pendingMove.days));
        setItems((current) =>
          current.map((item) =>
            item.id === pendingMove.itemId
              ? {
                  ...item,
                  startDate: addLocalDays(item.startDate, pendingMove.days),
                  endDate: item.endDate ? addLocalDays(item.endDate, pendingMove.days) : null,
                  ...(item.predictionDate
                    ? { predictionDate: addLocalDays(item.predictionDate, pendingMove.days) }
                    : {}),
                  ...(item.openedExpiryDate
                    ? {
                        openedExpiryDate: addLocalDays(item.openedExpiryDate, pendingMove.days)
                      }
                    : {}),
                  ...(item.depletionPredictionDate
                    ? {
                        depletionPredictionDate: addLocalDays(
                          item.depletionPredictionDate,
                          pendingMove.days
                        )
                      }
                    : {}),
                  ...(item.stateIntervals
                    ? {
                        stateIntervals: item.stateIntervals.map((interval) => ({
                          ...interval,
                          startDate: addLocalDays(interval.startDate, pendingMove.days),
                          endDate: interval.endDate
                            ? addLocalDays(interval.endDate, pendingMove.days)
                            : null
                        }))
                      }
                    : {}),
                  ...(item.locationIntervals
                    ? {
                        locationIntervals: item.locationIntervals.map((interval) => ({
                          ...interval,
                          startDate: addLocalDays(interval.startDate, pendingMove.days),
                          endDate: interval.endDate
                            ? addLocalDays(interval.endDate, pendingMove.days)
                            : null
                        }))
                      }
                    : {}),
                  ...(item.eyeAssignmentIntervals
                    ? {
                        eyeAssignmentIntervals: item.eyeAssignmentIntervals.map((interval) => ({
                          ...interval,
                          startDate: addLocalDays(interval.startDate, pendingMove.days),
                          endDate: interval.endDate
                            ? addLocalDays(interval.endDate, pendingMove.days)
                            : null
                        }))
                      }
                    : {}),
                  ...(item.reusableLensCycles
                    ? {
                        reusableLensCycles: item.reusableLensCycles.map((cycle) => ({
                          ...cycle,
                          startDate: addLocalDays(cycle.startDate, pendingMove.days),
                          endDate: cycle.endDate
                            ? addLocalDays(cycle.endDate, pendingMove.days)
                            : null,
                          predictionDate: addLocalDays(cycle.predictionDate, pendingMove.days)
                        }))
                      }
                    : {})
                }
              : item
          )
        );
      });
      setUndoMove(undo);
      setPendingMove(null);
      setDetailError(null);
    } catch (error) {
      setDetailError(error instanceof Error ? error.message : "时间调整保存失败");
    }
  }

  async function undoLastMove() {
    if (!undoMove) return;
    try {
      await commitDataMutation(() => {
        rescheduleActivation(undoMove.itemId, undoMove.oldStart);
        setItems((current) =>
          current.map((item) =>
            item.id === undoMove.itemId
              ? {
                  ...item,
                  startDate: undoMove.oldStart,
                  endDate: undoMove.oldEnd,
                  ...(undoMove.oldPredictionDate
                    ? { predictionDate: undoMove.oldPredictionDate }
                    : {}),
                  ...(undoMove.oldOpenedExpiryDate
                    ? { openedExpiryDate: undoMove.oldOpenedExpiryDate }
                    : {}),
                  ...(undoMove.oldDepletionPredictionDate
                    ? {
                        depletionPredictionDate: undoMove.oldDepletionPredictionDate
                      }
                    : {}),
                  ...(undoMove.oldStateIntervals
                    ? { stateIntervals: undoMove.oldStateIntervals }
                    : {}),
                  ...(undoMove.oldLocationIntervals
                    ? { locationIntervals: undoMove.oldLocationIntervals }
                    : {}),
                  ...(undoMove.oldEyeAssignmentIntervals
                    ? { eyeAssignmentIntervals: undoMove.oldEyeAssignmentIntervals }
                    : {}),
                  ...(undoMove.oldReusableLensCycles
                    ? { reusableLensCycles: undoMove.oldReusableLensCycles }
                    : {})
                }
              : item
          )
        );
      });
      setUndoMove(null);
      setDetailError(null);
    } catch (error) {
      setDetailError(error instanceof Error ? error.message : "撤销时间调整失败");
    }
  }

  function openLifecycleAction(action: "pause" | "resume" | "end" | "reopen" | "next") {
    setLifecycleAction(action);
    setLifecycleError(null);
  }

  async function handleLifecycleAction(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedItem || !lifecycleAction || actionSubmitting) return;
    const submittedAction = lifecycleAction;
    const formData = new FormData(event.currentTarget);
    const date = String(formData.get("date") ?? "") as LocalDate;

    setActionSubmitting(true);
    try {
      if (lifecycleAction === "end" && selectedProfile?.managementTemplate === "batch_consumable") {
        const rawActualRemaining = String(formData.get("actualRemainingQuantity") ?? "");
        if (!rawActualRemaining.trim()) {
          throw new Error("请填写实际剩余数量");
        }
        const actualRemainingQuantity = Number(rawActualRemaining);
        await completeBatchConsumableTimelineItem(selectedItem.id, date, actualRemainingQuantity);
        setLifecycleAction(null);
        setLifecycleError(null);
        setActionNotice(
          `${selectedItem.label} 已结束使用，实际剩余 ${actualRemainingQuantity} ${selectedBaseUnit}`
        );
        return;
      }
      if (lifecycleAction === "next" && selectedProfile?.managementTemplate === "soft_reusable") {
        const sourceStockLotId = selectedItem.sourceStockLotId;
        const cycles = reusableLensCyclesFor(selectedItem);
        if (cycles.some((cycle) => cycle.status === "active")) {
          throw new Error("请先结束当前镜片，再启用下一片");
        }
        if ((selectedRemainingQuantity ?? 0) < 1 || !sourceStockLotId) {
          throw new Error("该盒已经没有可启用的镜片");
        }
        const previousEnd = cycles.at(-1)?.endDate;
        if (!reusableCycleStartIsValid(previousEnd, date)) {
          throw new Error("下一片启用日期不能早于上一片的实际结束日期");
        }
        const durationDays =
          products.find((product) => product.id === selectedItem.productId)?.defaultDurationDays ??
          selectedProfile.defaultDurationDays ??
          14;
        const predictionDate = addLocalDays(date, durationDays - 1);
        const newCycleId = `lens-${crypto.randomUUID()}`;
        const activationLocationId = timelineLocationIdAtDate(selectedItem, date);
        if (!activationLocationId) throw new Error("无法确定镜片启用地点");
        if (
          !selectedLot ||
          availableUnitsAtLocation(selectedLot, activationLocationId, transactions) < 1
        ) {
          throw new Error("启用地点的该批次库存不足");
        }
        await commitDataMutation(() => {
          useInventoryStore.getState().addTransaction({
            id: `tx-${crypto.randomUUID()}`,
            stockLotId: sourceStockLotId,
            occurredDate: date,
            type: "activate",
            quantityDelta: -1,
            locationId: activationLocationId,
            relatedInstanceId: selectedItem.id,
            relatedCycleId: newCycleId,
            reason: `启用盒内镜片 ${cycles.length + 1}`
          });
          setItems((current) =>
            current.map((item) =>
              item.id === selectedItem.id
                ? {
                    ...item,
                    predictionDate,
                    reusableLensCycles: [
                      ...cycles,
                      {
                        id: newCycleId,
                        label: `镜片 ${cycles.length + 1}`,
                        startDate: date,
                        endDate: null,
                        predictionDate,
                        status: "active" as const
                      }
                    ]
                  }
                : item
            )
          );
        });
        setLifecycleAction(null);
        setLifecycleError(null);
        setActionNotice(`${selectedItem.label} 已启用下一片镜片`);
        return;
      }
      if (
        lifecycleAction === "reopen" &&
        (selectedProfile?.managementTemplate === "soft_daily" ||
          selectedProfile?.managementTemplate === "discrete_dose") &&
        selectedItem.endReason === "提前结束/丢弃"
      ) {
        const reopened = reopenTimelineItem(selectedItem);
        const actualEndDate = selectedItem.endDate ? addLocalDays(selectedItem.endDate, -1) : null;
        const discardFact =
          usageFacts.find((fact) => fact.id === selectedItem.completionUsageFactId) ??
          [...usageFacts]
            .reverse()
            .find(
              (fact) =>
                fact.itemId === selectedItem.id &&
                fact.kind === "extra_loss" &&
                fact.date === actualEndDate
            );
        if (!discardFact) {
          throw new Error("没有找到本次丢弃对应的库存损耗记录，无法安全撤销");
        }
        const reopenedItems = items
          .map((item) => {
            if (item.id === selectedItem.id) return reopened;
            if (
              selectedProfile.managementTemplate === "discrete_dose" &&
              item.sourceStockLotId === selectedItem.sourceStockLotId &&
              item.status === "completed" &&
              item.endReason === "提前结束/丢弃"
            ) {
              return reopenTimelineItem(item);
            }
            return item;
          })
          .filter((item, index) => item !== items[index]);
        await reopenDiscardedTimelineItems(discardFact.id, todayLocalDate(), reopenedItems);
        setLifecycleAction(null);
        setLifecycleError(null);
        setActionNotice(`${selectedItem.label} 已撤销丢弃并恢复使用`);
        return;
      }
      await commitTimelineItemUpdates((current) =>
        current.map((item) => {
          if (item.id !== selectedItem.id) return item;
          if (
            selectedProfile?.managementTemplate === "soft_reusable" &&
            lifecycleAction === "end"
          ) {
            const cycles = reusableLensCyclesFor(item);
            const activeIndex = cycles.findIndex((cycle) => cycle.status === "active");
            if (activeIndex < 0) throw new Error("当前没有正在使用的镜片");
            if (date < cycles[activeIndex]!.startDate) {
              throw new Error("结束日期不能早于当前镜片启用日期");
            }
            const nextCycles = cycles.map((cycle, index) =>
              index === activeIndex
                ? {
                    ...cycle,
                    endDate: addLocalDays(date, 1),
                    status: "completed" as const
                  }
                : cycle
            );
            const boxIsEmpty = (selectedRemainingQuantity ?? 0) === 0;
            if (boxIsEmpty) {
              return {
                ...endTimelineItem(item, date),
                reusableLensCycles: nextCycles
              };
            }
            const nextItem = { ...item, reusableLensCycles: nextCycles };
            delete nextItem.predictionDate;
            return nextItem;
          }
          if (
            selectedProfile?.managementTemplate === "soft_reusable" &&
            lifecycleAction === "reopen"
          ) {
            const reopened = reopenTimelineItem(item);
            const cycles = reusableLensCyclesFor(item);
            const lastIndex = cycles.length - 1;
            const nextCycles = cycles.map((cycle, index) =>
              index === lastIndex ? { ...cycle, endDate: null, status: "active" as const } : cycle
            );
            return {
              ...reopened,
              predictionDate: nextCycles[lastIndex]!.predictionDate,
              reusableLensCycles: nextCycles
            };
          }
          if (lifecycleAction === "reopen") return reopenTimelineItem(item);
          if (lifecycleAction === "pause") return pauseTimelineItem(item, date);
          if (lifecycleAction === "resume") {
            const resumed = resumeTimelineItem(item, date);
            const template = profileById.get(item.categoryId)?.managementTemplate;
            const pausedStart = item.stateIntervals?.at(-1)?.startDate;
            if (
              pausedStart &&
              (template === "opened_container" || template === "batch_consumable")
            ) {
              const delayDays = daysBetween(pausedStart, date);
              return {
                ...resumed,
                ...(resumed.predictionDate
                  ? {
                      predictionDate: addLocalDays(resumed.predictionDate, delayDays)
                    }
                  : {}),
                ...(resumed.depletionPredictionDate
                  ? {
                      depletionPredictionDate: addLocalDays(
                        resumed.depletionPredictionDate,
                        delayDays
                      )
                    }
                  : {})
              };
            }
            return resumed;
          }
          return endTimelineItem(item, date);
        })
      );
      setLifecycleAction(null);
      setLifecycleError(null);
      setActionNotice(
        submittedAction === "pause"
          ? `${selectedItem.label} 已暂停使用`
          : submittedAction === "resume"
            ? `${selectedItem.label} 已恢复使用`
            : submittedAction === "reopen"
              ? `${selectedItem.label} 已撤销结束并恢复使用`
              : selectedProfile?.managementTemplate === "soft_reusable"
                ? `${selectedItem.label} 的当前镜片已结束使用`
                : `${selectedItem.label} 已结束使用`
      );
    } catch (error) {
      setLifecycleError(error instanceof Error ? error.message : "状态修改失败");
    } finally {
      setActionSubmitting(false);
    }
  }

  async function handlePauseEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedItem || editingPauseIndex === null) return;
    const formData = new FormData(event.currentTarget);
    const startDate = String(formData.get("startDate")) as LocalDate;
    const rawEndDate = String(formData.get("endDate") ?? "");
    const isFinalCompletedPause =
      selectedItem.status === "completed" &&
      editingPauseIndex === (selectedItem.stateIntervals?.length ?? 0) - 1;
    const endDate = rawEndDate
      ? isFinalCompletedPause
        ? addLocalDays(rawEndDate as LocalDate, 1)
        : (rawEndDate as LocalDate)
      : null;

    try {
      await commitTimelineItemUpdates((current) =>
        current.map((item) => {
          if (item.id !== selectedItem.id) return item;
          const sourcePause = item.stateIntervals?.[editingPauseIndex];
          const edited = editPausedInterval(item, editingPauseIndex, startDate, endDate);
          const template = profileById.get(item.categoryId)?.managementTemplate;
          if (
            !sourcePause ||
            (template !== "opened_container" && template !== "batch_consumable")
          ) {
            return edited;
          }
          const oldPauseDays = daysBetween(
            sourcePause.startDate,
            sourcePause.endDate ?? todayLocalDate()
          );
          const newPauseDays = daysBetween(startDate, endDate ?? todayLocalDate());
          const delta = newPauseDays - oldPauseDays;
          return {
            ...edited,
            ...(edited.predictionDate
              ? { predictionDate: addLocalDays(edited.predictionDate, delta) }
              : {}),
            ...(edited.depletionPredictionDate
              ? {
                  depletionPredictionDate: addLocalDays(edited.depletionPredictionDate, delta)
                }
              : {})
          };
        })
      );
      setEditingPauseIndex(null);
      setLifecycleError(null);
    } catch (error) {
      setLifecycleError(error instanceof Error ? error.message : "暂停记录修改失败");
    }
  }

  async function handlePauseDelete(pauseIndex: number) {
    if (!selectedItem) return;
    const pause = selectedItem.stateIntervals?.[pauseIndex];
    if (!pause?.endDate) {
      setLifecycleError("当前暂停阶段不能删除，请先恢复使用");
      return;
    }
    if (!globalThis.confirm("确定删除这段历史暂停记录吗？相邻的使用阶段将自动合并。")) {
      return;
    }
    setActionSubmitting(true);
    try {
      await commitTimelineItemUpdates((current) =>
        current.map((item) => {
          if (item.id !== selectedItem.id) return item;
          const sourcePause = item.stateIntervals?.[pauseIndex];
          const deleted = deletePausedInterval(item, pauseIndex);
          const template = profileById.get(item.categoryId)?.managementTemplate;
          if (
            !sourcePause?.endDate ||
            (template !== "opened_container" && template !== "batch_consumable")
          ) {
            return deleted;
          }
          const removedPauseDays = daysBetween(sourcePause.startDate, sourcePause.endDate);
          if (template === "opened_container") {
            const depletionPredictionDate = item.depletionPredictionDate
              ? addLocalDays(item.depletionPredictionDate, -removedPauseDays)
              : item.predictionDate
                ? addLocalDays(item.predictionDate, -removedPauseDays)
                : undefined;
            const predictionDate = [depletionPredictionDate, item.openedExpiryDate]
              .filter((date): date is LocalDate => Boolean(date))
              .sort()[0];
            return {
              ...deleted,
              ...(depletionPredictionDate ? { depletionPredictionDate } : {}),
              ...(predictionDate ? { predictionDate } : {})
            };
          }
          return {
            ...deleted,
            ...(deleted.predictionDate
              ? {
                  predictionDate: addLocalDays(deleted.predictionDate, -removedPauseDays)
                }
              : {}),
            ...(deleted.depletionPredictionDate
              ? {
                  depletionPredictionDate: addLocalDays(
                    deleted.depletionPredictionDate,
                    -removedPauseDays
                  )
                }
              : {})
          };
        })
      );
      setLifecycleError(null);
      setActionNotice("历史暂停记录已删除");
    } catch (error) {
      setLifecycleError(error instanceof Error ? error.message : "暂停记录删除失败");
    } finally {
      setActionSubmitting(false);
    }
  }

  async function handleReusableCycleEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedItem || !editingReusableCycle) return;
    const formData = new FormData(event.currentTarget);
    const cycles = reusableLensCyclesFor(selectedItem);
    const cycleIndex = cycles.findIndex((cycle) => cycle.id === editingReusableCycle.id);
    if (cycleIndex < 0) return;
    const label = String(formData.get("label") || "").trim();
    const startDate = String(formData.get("startDate")) as LocalDate;
    const predictionDate = String(formData.get("predictionDate")) as LocalDate;
    const rawEndDate = String(formData.get("endDate") || "");
    const endBoundary = rawEndDate ? addLocalDays(rawEndDate as LocalDate, 1) : null;
    const previous = cycles[cycleIndex - 1];
    const next = cycles[cycleIndex + 1];

    try {
      if (!label || !startDate || !predictionDate) {
        throw new Error("请填写完整的镜片信息");
      }
      if (startDate > todayLocalDate()) {
        throw new Error("启用日期不能晚于今天");
      }
      if (predictionDate < startDate) {
        throw new Error("预计更换日期不能早于启用日期");
      }
      if (!reusableCycleStartIsValid(previous?.endDate, startDate)) {
        throw new Error("启用日期不能早于上一片的实际结束日期");
      }
      if (editingReusableCycle.status === "completed" && !endBoundary) {
        throw new Error("已结束镜片必须填写结束日期");
      }
      if (endBoundary && endBoundary <= startDate) {
        throw new Error("结束日期不能早于启用日期");
      }
      if (!reusableCycleEndIsValid(endBoundary, next?.startDate)) {
        throw new Error("结束日期不能晚于下一片启用日期");
      }

      await commitDataMutation(() => {
        if (startDate !== editingReusableCycle.startDate && selectedItem.sourceStockLotId) {
          const effectiveActivations = effectiveInventoryTransactions(transactions).filter(
            (transaction) =>
              transaction.type === "activate" && transaction.relatedInstanceId === selectedItem.id
          );
          const original =
            effectiveActivations.find(
              (transaction) => transaction.relatedCycleId === editingReusableCycle.id
            ) ?? effectiveActivations[cycleIndex];
          if (original) {
            const replacementLocationId = timelineLocationIdAtDate(selectedItem, startDate);
            useInventoryStore.getState().addTransaction({
              id: `tx-${crypto.randomUUID()}`,
              stockLotId: original.stockLotId,
              occurredDate: todayLocalDate(),
              type: "reverse",
              quantityDelta: -original.quantityDelta,
              ...(original.locationId ? { locationId: original.locationId } : {}),
              relatedInstanceId: selectedItem.id,
              relatedCycleId: editingReusableCycle.id,
              reversedTransactionId: original.id,
              reason: "修改盒内镜片启用日期"
            });
            useInventoryStore.getState().addTransaction({
              ...original,
              id: `tx-${crypto.randomUUID()}`,
              occurredDate: startDate,
              ...(replacementLocationId ? { locationId: replacementLocationId } : {}),
              relatedCycleId: editingReusableCycle.id
            });
          }
        }

        const nextCycles = cycles.map((cycle) =>
          cycle.id === editingReusableCycle.id
            ? {
                ...cycle,
                label,
                startDate,
                predictionDate,
                endDate: cycle.status === "completed" ? endBoundary : null
              }
            : cycle
        );
        setItems((current) =>
          current.map((item) => {
            if (item.id !== selectedItem.id) return item;
            const isFirst = cycleIndex === 0;
            const isLast = cycleIndex === nextCycles.length - 1;
            return {
              ...item,
              ...(isFirst
                ? {
                    startDate,
                    ...(item.stateIntervals
                      ? {
                          stateIntervals: item.stateIntervals.map((interval, index) =>
                            index === 0 ? { ...interval, startDate } : interval
                          )
                        }
                      : {}),
                    ...(item.locationIntervals
                      ? {
                          locationIntervals: item.locationIntervals.map((interval, index) =>
                            index === 0 ? { ...interval, startDate } : interval
                          )
                        }
                      : {}),
                    ...(item.eyeAssignmentIntervals
                      ? {
                          eyeAssignmentIntervals: item.eyeAssignmentIntervals.map(
                            (interval, index) =>
                              index === 0 ? { ...interval, startDate } : interval
                          )
                        }
                      : {})
                  }
                : {}),
              ...(editingReusableCycle.status === "active" ? { predictionDate } : {}),
              ...(item.status === "completed" && isLast && endBoundary
                ? {
                    endDate: endBoundary,
                    ...(item.stateIntervals
                      ? {
                          stateIntervals: item.stateIntervals.map((interval, index, all) =>
                            index === all.length - 1
                              ? { ...interval, endDate: endBoundary }
                              : interval
                          )
                        }
                      : {})
                  }
                : {}),
              reusableLensCycles: nextCycles
            };
          })
        );
      });
      setEditingReusableCycleId(null);
      setReusableCycleError(null);
    } catch (error) {
      setReusableCycleError(error instanceof Error ? error.message : "镜片信息修改失败");
    }
  }

  async function undoReusableCycleEnd(cycleId: string) {
    if (!selectedItem) return;
    const cycles = reusableLensCyclesFor(selectedItem);
    const cycleIndex = cycles.findIndex((cycle) => cycle.id === cycleId);
    const cycle = cycles[cycleIndex];
    if (!cycle || cycle.status !== "completed") return;
    if (cycleIndex !== cycles.length - 1) {
      setReusableCycleError("已有后续镜片，不能撤销这一片的结束状态");
      return;
    }
    try {
      await commitDataMutation(() => {
        setItems((current) =>
          current.map((item) => {
            if (item.id !== selectedItem.id) return item;
            const reopened = item.status === "completed" ? reopenTimelineItem(item) : item;
            return {
              ...reopened,
              predictionDate: cycle.predictionDate,
              reusableLensCycles: cycles.map((entry) =>
                entry.id === cycleId
                  ? { ...entry, endDate: null, status: "active" as const }
                  : entry
              )
            };
          })
        );
      });
      setReusableCycleError(null);
    } catch (error) {
      setReusableCycleError(error instanceof Error ? error.message : "撤销镜片结束失败");
    }
  }

  async function deleteReusableCycle(cycleId: string) {
    if (!selectedItem) return;
    const cycles = reusableLensCyclesFor(selectedItem);
    const cycleIndex = cycles.findIndex((cycle) => cycle.id === cycleId);
    if (cycleIndex < 0) return;

    try {
      const effectiveActivations = effectiveInventoryTransactions(transactions).filter(
        (transaction) =>
          transaction.type === "activate" && transaction.relatedInstanceId === selectedItem.id
      );
      const activation =
        effectiveActivations.find((transaction) => transaction.relatedCycleId === cycleId) ??
        effectiveActivations[cycleIndex];
      if (!activation) {
        throw new Error("没有找到该镜片对应的库存启用记录");
      }
      await commitDataMutation(() => {
        useInventoryStore.getState().addTransaction({
          id: `tx-${crypto.randomUUID()}`,
          stockLotId: activation.stockLotId,
          occurredDate: todayLocalDate(),
          type: "reverse",
          quantityDelta: -activation.quantityDelta,
          ...(activation.locationId ? { locationId: activation.locationId } : {}),
          relatedInstanceId: selectedItem.id,
          relatedCycleId: cycleId,
          reversedTransactionId: activation.id,
          reason: "删除误录的盒内镜片使用"
        });

        const nextCycles = cycles.filter((cycle) => cycle.id !== cycleId);
        const activeCycle = nextCycles.find((cycle) => cycle.status === "active");
        setItems((current) =>
          current.map((item) => {
            if (item.id !== selectedItem.id) return item;
            const opened = item.status === "completed" ? reopenTimelineItem(item) : item;
            const nextItem: TimelineItem = {
              ...opened,
              reusableLensCycles: nextCycles
            };
            if (activeCycle) {
              nextItem.predictionDate = activeCycle.predictionDate;
            } else {
              delete nextItem.predictionDate;
            }
            return nextItem;
          })
        );
      });
      if (editingReusableCycleId === cycleId) {
        setEditingReusableCycleId(null);
      }
      setReusableCycleError(null);
    } catch (error) {
      setReusableCycleError(error instanceof Error ? error.message : "删除镜片使用失败");
    }
  }

  async function handleCareEventSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedItem || !careEventDialog) return;
    const formData = new FormData(event.currentTarget);
    const kind = String(formData.get("kind")) as LensCareEventKind;
    const recordType = String(formData.get("recordType"));
    const date = String(formData.get("date")) as LocalDate;
    if (!date || !["review", "protein"].includes(kind)) {
      setCareEventError("请填写完整的护理事件信息");
      return;
    }
    if (date < selectedItem.startDate) {
      setCareEventError("护理事件日期不能早于镜片启用日期");
      return;
    }
    if (recordType === "completed" && date > todayLocalDate()) {
      setCareEventError("实际完成日期不能晚于今天");
      return;
    }
    if (selectedItem.status === "completed" && recordType === "planned") {
      setCareEventError("已经结束使用的镜片不能新增护理计划，可补录已完成事件");
      return;
    }
    if (
      selectedItem.status === "completed" &&
      selectedItem.endDate &&
      date >= selectedItem.endDate
    ) {
      setCareEventError("护理事件日期不能晚于镜片的实际结束日期");
      return;
    }
    const changes = {
      kind,
      ...(recordType === "completed" ? { completedDate: date } : { plannedDate: date })
    };
    try {
      await commitDataMutation(() => {
        if (careEventDialog.mode === "edit" && editingCareEvent) {
          updateCareEvent(editingCareEvent.id, {
            kind,
            plannedDate: recordType === "planned" ? date : undefined,
            completedDate: recordType === "completed" ? date : undefined
          });
        } else {
          addCareEvent({ itemId: selectedItem.id, ...changes });
        }
      });
    } catch (error) {
      setCareEventError(error instanceof Error ? error.message : "护理事件保存失败");
      return;
    }
    setCareEventDialog(null);
    setCareEventError(null);
    setShowAllCareEvents(false);
  }

  async function handleCareEventConfirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!confirmingCareEvent) return;
    const completedDate = String(
      new FormData(event.currentTarget).get("completedDate")
    ) as LocalDate;
    if (!completedDate) {
      setCareEventError("请填写实际完成日期");
      return;
    }
    if (selectedItem && completedDate < selectedItem.startDate) {
      setCareEventError("实际完成日期不能早于镜片启用日期");
      return;
    }
    if (completedDate > todayLocalDate()) {
      setCareEventError("实际完成日期不能晚于今天");
      return;
    }
    if (
      selectedItem?.status === "completed" &&
      selectedItem.endDate &&
      completedDate >= selectedItem.endDate
    ) {
      setCareEventError("实际完成日期不能晚于镜片的实际结束日期");
      return;
    }
    try {
      await commitDataMutation(() => {
        completeCareEvent(confirmingCareEvent.id, completedDate);
      });
    } catch (error) {
      setCareEventError(error instanceof Error ? error.message : "护理事件确认失败");
      return;
    }
    setConfirmCareEventId(null);
    setCareEventError(null);
    setShowAllCareEvents(false);
  }

  async function handleDeleteSelectedItem() {
    if (!selectedItem || actionSubmitting) return;
    const deletedLabel = selectedItem.label;
    setActionSubmitting(true);
    try {
      await deleteMistakenTimelineItem(selectedItem.id, todayLocalDate());
      setShowDeleteItemDialog(false);
      setDeleteItemError(null);
      closeItemDetails();
      setActionNotice(`${deletedLabel} 的误录实例已删除，关联库存已同步恢复`);
    } catch (error) {
      setDeleteItemError(error instanceof Error ? error.message : "删除实例失败");
    } finally {
      setActionSubmitting(false);
    }
  }

  async function handleUsageAction(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedItem || !selectedItem.sourceStockLotId || !usageAction || actionSubmitting) return;
    const sourceStockLotId = selectedItem.sourceStockLotId;
    if (selectedItem.status === "completed") {
      setUsageError("已经结束的实例不能继续记录消耗");
      return;
    }
    const formData = new FormData(event.currentTarget);
    const date = String(formData.get("date")) as LocalDate;
    const profile = profileById.get(selectedItem.categoryId);
    if (date < selectedItem.startDate || date > todayLocalDate()) {
      setUsageError("记录日期必须在启用日期和今天之间");
      return;
    }
    if (
      usageAction === "wear" &&
      selectedUsageFacts.some((fact) => fact.kind === "wear" && fact.date === date)
    ) {
      setUsageError("这一天已经记录过正常佩戴，同日第二片请记为额外消耗");
      return;
    }
    const requestedQuantity =
      usageAction === "wear" || usageAction === "dose"
        ? 1
        : usageAction === "discard"
          ? profile?.managementTemplate === "discrete_dose"
            ? selectedSourceAvailableUnits
            : Math.max(0, selectedRemainingQuantity ?? 0)
          : Math.max(1, Number(formData.get("quantity")));
    if (
      (profile?.managementTemplate === "soft_daily" ||
        profile?.managementTemplate === "soft_reusable") &&
      requestedQuantity > (selectedRemainingQuantity ?? 0)
    ) {
      setUsageError(`盒内只剩 ${selectedRemainingQuantity ?? 0} ${selectedBaseUnit}`);
      return;
    }
    const submittedAction = usageAction;
    setActionSubmitting(true);
    try {
      await commitDataMutation(() => {
        let recordedFactId: string | undefined;
        if (requestedQuantity > 0) {
          recordedFactId = recordUsageFact({
            itemId: selectedItem.id,
            stockLotId: sourceStockLotId,
            date,
            kind: usageAction === "wear" ? "wear" : usageAction === "dose" ? "dose" : "extra_loss",
            quantity: requestedQuantity,
            ...(selectedItem.locationId ? { locationId: selectedItem.locationId } : {}),
            ...(usageAction === "loss" || usageAction === "discard"
              ? {
                  reason:
                    String(formData.get("reason") || "").trim() ||
                    (usageAction === "discard" ? "提前结束/丢弃" : "额外消耗")
                }
              : {})
          });
        }
        const shouldEndDaily =
          profile?.managementTemplate === "soft_daily" &&
          selectedItem.initialUnitQuantity !== undefined &&
          selectedUsedQuantity + requestedQuantity >= selectedItem.initialUnitQuantity;
        const shouldEndDiscreteLot =
          profile?.managementTemplate === "discrete_dose" &&
          availableUnits(sourceStockLotId, useInventoryStore.getState().transactions) === 0;
        if (shouldEndDaily || shouldEndDiscreteLot || usageAction === "discard") {
          setItems((current) =>
            current.map((item) => {
              const isDiscreteLotItem =
                profile?.managementTemplate === "discrete_dose" &&
                item.sourceStockLotId === sourceStockLotId &&
                profileById.get(item.categoryId)?.managementTemplate === "discrete_dose";
              if (
                (item.id !== selectedItem.id && !isDiscreteLotItem) ||
                item.status === "completed"
              ) {
                return item;
              }
              return {
                ...endTimelineItem(item, date),
                ...(usageAction === "discard"
                  ? {
                      endReason: "提前结束/丢弃",
                      ...(recordedFactId && item.id === selectedItem.id
                        ? { completionUsageFactId: recordedFactId }
                        : {})
                    }
                  : shouldEndDiscreteLot
                    ? { endReason: "库存耗尽自动结束" }
                    : {})
              };
            })
          );
        }
      });
      setUsageAction(null);
      setUsageError(null);
      setActionNotice(
        submittedAction === "discard"
          ? `${selectedItem.label} 已提前结束，剩余库存已记为损耗`
          : submittedAction === "wear"
            ? `${selectedItem.label} 已记录当天佩戴`
            : submittedAction === "dose"
              ? `${selectedItem.label} 已记录使用一对`
              : `${selectedItem.label} 已记录额外消耗`
      );
    } catch (error) {
      setUsageError(error instanceof Error ? error.message : "记录失败");
    } finally {
      setActionSubmitting(false);
    }
  }

  function openUsageAction(action: Exclude<UsageAction, null>) {
    setUsageDefaultDate(todayLocalDate());
    setUsageAction(action);
    setUsageError(null);
  }

  async function undoUsageFact(factId: string) {
    if (!selectedItem) return;
    try {
      await commitDataMutation(() => {
        reverseUsageFact(factId, todayLocalDate());
        const profile = profileById.get(selectedItem.categoryId);
        if (
          (profile?.managementTemplate === "soft_daily" ||
            profile?.managementTemplate === "discrete_dose") &&
          selectedItem.status === "completed"
        ) {
          setItems((current) =>
            current.map((item) => {
              const shouldReopen =
                item.status === "completed" &&
                (item.id === selectedItem.id ||
                  (profile.managementTemplate === "discrete_dose" &&
                    item.sourceStockLotId === selectedItem.sourceStockLotId &&
                    (item.endReason === "库存耗尽自动结束" || item.endReason === "提前结束/丢弃")));
              return shouldReopen ? reopenTimelineItem(item) : item;
            })
          );
        }
      });
      setUsageError(null);
    } catch (error) {
      setUsageError(error instanceof Error ? error.message : "撤销记录失败");
    }
  }

  async function handleUsageFactEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedItem || !editingUsageFact) return;
    const formData = new FormData(event.currentTarget);
    const date = String(formData.get("date")) as LocalDate;
    const quantity = Math.max(1, Number(formData.get("quantity") || 1));
    if (date < selectedItem.startDate || date > todayLocalDate()) {
      setUsageError("记录日期必须在启用日期和今天之间");
      return;
    }
    if (
      editingUsageFact.kind === "wear" &&
      selectedUsageFacts.some(
        (fact) => fact.id !== editingUsageFact.id && fact.kind === "wear" && fact.date === date
      )
    ) {
      setUsageError("这一天已经存在正常佩戴记录");
      return;
    }
    try {
      await commitDataMutation(() => {
        replaceUsageFact(editingUsageFact.id, {
          date,
          quantity: editingUsageFact.kind === "extra_loss" ? quantity : 1,
          ...(editingUsageFact.kind === "extra_loss"
            ? { reason: String(formData.get("reason") || "").trim() }
            : {})
        });
        if (
          selectedProfile?.managementTemplate === "soft_daily" &&
          selectedItem.initialUnitQuantity
        ) {
          const nextTotal =
            selectedUsedQuantity -
            editingUsageFact.quantity +
            (editingUsageFact.kind === "extra_loss" ? quantity : 1);
          const lastDate =
            selectedUsageFacts
              .map((fact) => (fact.id === editingUsageFact.id ? date : fact.date))
              .sort()
              .at(-1) ?? date;
          setItems((items) =>
            items.map((item) => {
              if (item.id !== selectedItem.id) return item;
              const openItem = item.status === "completed" ? reopenTimelineItem(item) : item;
              return nextTotal >= selectedItem.initialUnitQuantity!
                ? endTimelineItem(openItem, lastDate)
                : openItem;
            })
          );
        }
        if (
          selectedProfile?.managementTemplate === "discrete_dose" &&
          selectedItem.sourceStockLotId
        ) {
          const lotId = selectedItem.sourceStockLotId;
          const lotIsEmpty = availableUnits(lotId, useInventoryStore.getState().transactions) === 0;
          const lastFactDate =
            useUsageFactStore
              .getState()
              .facts.filter((fact) => fact.stockLotId === lotId)
              .map((fact) => fact.date)
              .sort()
              .at(-1) ?? date;
          setItems((items) =>
            items.map((item) => {
              if (
                item.sourceStockLotId !== lotId ||
                profileById.get(item.categoryId)?.managementTemplate !== "discrete_dose"
              ) {
                return item;
              }
              if (!lotIsEmpty) {
                return item.status === "completed" ? reopenTimelineItem(item) : item;
              }
              const openItem = item.status === "completed" ? reopenTimelineItem(item) : item;
              return {
                ...endTimelineItem(
                  openItem,
                  lastFactDate < item.startDate ? item.startDate : lastFactDate
                ),
                endReason: item.endReason === "提前结束/丢弃" ? "提前结束/丢弃" : "库存耗尽自动结束"
              };
            })
          );
        }
      });
      setEditingUsageFactId(null);
      setUsageError(null);
    } catch (error) {
      setUsageError(error instanceof Error ? error.message : "修改记录失败");
    }
  }

  async function handleAssignmentChange(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedItem) return;
    const formData = new FormData(event.currentTarget);
    const date = String(formData.get("date")) as LocalDate;
    const eyeSides = formData
      .getAll("eyeSides")
      .map(String)
      .filter((side): side is "L" | "R" => side === "L" || side === "R");
    const intervals = selectedEyeAssignmentIntervals.map((interval) => ({
      ...interval,
      eyeSides: [...interval.eyeSides]
    }));
    if (intervals.length === 0) {
      intervals.push({
        startDate: selectedItem.startDate,
        endDate: null,
        eyeSides: [...selectedEyeSides]
      });
    }
    const current = intervals.at(-1);
    if (!current || date < current.startDate || date > todayLocalDate()) {
      setAssignmentError("切换日期必须在当前眼别阶段开始日期和今天之间");
      return;
    }
    if (eyeSides.length === 0) {
      setAssignmentError("请至少选择左眼或右眼");
      return;
    }
    const nextIntervals = applyLensCaseEyeSwitch(intervals, date, eyeSides);
    const totals = nextIntervals.reduce((usage, interval) => {
      const intervalEnd = interval.endDate ?? date;
      const days = Math.max(0, daysBetween(interval.startDate, intervalEnd));
      interval.eyeSides.forEach((eyeSide) => usage.set(eyeSide, (usage.get(eyeSide) ?? 0) + days));
      return usage;
    }, new Map<string, number>());
    const durationDays =
      selectedProduct?.defaultDurationDays ?? selectedProfile?.defaultDurationDays ?? 90;
    const remainingDays = Math.max(
      1,
      Math.min(...eyeSides.map((eyeSide) => Math.max(0, durationDays - (totals.get(eyeSide) ?? 0))))
    );
    try {
      await commitDataMutation(() => {
        setItems((items) =>
          items.map((item) =>
            item.id === selectedItem.id
              ? (() => {
                  const nextItem: TimelineItem = {
                    ...item,
                    eyeSides,
                    eyeAssignmentIntervals: nextIntervals,
                    predictionDate: addLocalDays(date, remainingDays - 1)
                  };
                  return nextItem;
                })()
              : item
          )
        );
      });
    } catch (error) {
      setAssignmentError(error instanceof Error ? error.message : "眼别切换失败");
      return;
    }
    setShowAssignmentDialog(false);
    setAssignmentError(null);
    setEditingUsageFactId(null);
  }

  async function handleEyeIntervalEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedItem || editingEyeIntervalIndex === null) return;
    const formData = new FormData(event.currentTarget);
    const startDate = String(formData.get("startDate")) as LocalDate;
    const rawEndDate = String(formData.get("endDate") || "");
    const endDate = rawEndDate ? addLocalDays(rawEndDate as LocalDate, 1) : null;
    const eyeSides = formData
      .getAll("eyeSides")
      .map(String)
      .filter((side): side is EyeSide => side === "L" || side === "R");
    const intervals = selectedEyeAssignmentIntervals.map((interval) => ({
      ...interval,
      eyeSides: [...interval.eyeSides]
    }));
    const current = intervals[editingEyeIntervalIndex];
    const previous = intervals[editingEyeIntervalIndex - 1];
    const next = intervals[editingEyeIntervalIndex + 1];

    if (!current) return;
    if (eyeSides.length === 0) {
      setAssignmentError("请至少选择左眼或右眼");
      return;
    }
    if (endDate && endDate <= startDate) {
      setAssignmentError("结束日期必须晚于开始日期");
      return;
    }
    if (previous?.endDate && startDate < previous.endDate) {
      setAssignmentError("开始日期不能早于上一段结束日期");
      return;
    }
    if (next && !endDate) {
      setAssignmentError("历史眼别记录必须填写结束日期");
      return;
    }
    if (next && endDate && endDate > next.startDate) {
      setAssignmentError("结束日期不能晚于下一段开始日期");
      return;
    }
    if (!next && selectedItem.status !== "completed" && endDate) {
      setAssignmentError("当前使用阶段不填写结束日期，请使用切换眼别创建下一段");
      return;
    }

    intervals[editingEyeIntervalIndex] = {
      startDate,
      endDate,
      eyeSides
    };
    const currentEyeSides = intervals.at(-1)?.eyeSides ?? [];
    const durationDays =
      selectedProduct?.defaultDurationDays ?? selectedProfile?.defaultDurationDays ?? 90;
    const totals = eyeUsageTotals(intervals, todayLocalDate());
    const remainingDays = Math.max(
      0,
      Math.min(
        ...currentEyeSides.map((side) => Math.max(0, durationDays - (totals.get(side) ?? 0)))
      )
    );
    try {
      await commitDataMutation(() => {
        setItems((items) =>
          items.map((item) => {
            if (item.id !== selectedItem.id) return item;
            const nextItem: TimelineItem = {
              ...item,
              eyeSides: currentEyeSides,
              eyeAssignmentIntervals: intervals,
              ...(item.status !== "completed" && currentEyeSides.length
                ? {
                    predictionDate: addLocalDays(todayLocalDate(), remainingDays)
                  }
                : {})
            };
            return nextItem;
          })
        );
      });
    } catch (error) {
      setAssignmentError(error instanceof Error ? error.message : "眼别记录保存失败");
      return;
    }
    setEditingEyeIntervalIndex(null);
    setAssignmentError(null);
  }

  async function handleLocationHistoryEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedItem || editingLocationIntervalIndex === null) return;
    const formData = new FormData(event.currentTarget);
    const locationId = String(formData.get("locationId"));
    const location = locations.find((entry) => entry.id === locationId);
    const startDate = String(formData.get("startDate")) as LocalDate;
    if (!location) {
      setLocationHistoryError("请选择有效地点");
      return;
    }
    try {
      await commitDataMutation(() => {
        setItems((current) =>
          current.map((item) =>
            item.id === selectedItem.id
              ? editTimelineLocationInterval(
                  item,
                  editingLocationIntervalIndex,
                  location.id,
                  location.name,
                  startDate
                )
              : item
          )
        );
      });
      setEditingLocationIntervalIndex(null);
      setLocationHistoryError(null);
    } catch (error) {
      setLocationHistoryError(error instanceof Error ? error.message : "保存地点历史失败");
    }
  }

  function openItemDetails(itemId: string) {
    setSelectedItemId(itemId);
    setEditingDetails(false);
    setDetailError(null);
    setLifecycleAction(null);
    setEditingPauseIndex(null);
    setEditingEyeIntervalIndex(null);
    setEditingLocationIntervalIndex(null);
    setLocationHistoryError(null);
    setLifecycleError(null);
    setCareEventDialog(null);
    setConfirmCareEventId(null);
    setCareEventError(null);
    setShowAllCareEvents(false);
    setShowDeleteItemDialog(false);
    setDeleteItemError(null);
    setUsageAction(null);
    setUsageError(null);
    setShowAllUsageFacts(false);
    setShowAssignmentDialog(false);
    setAssignmentError(null);
    setEditingUsageFactId(null);
  }

  function closeItemDetails() {
    setSelectedItemId(null);
    setEditingDetails(false);
    setDetailError(null);
    setLifecycleAction(null);
    setEditingPauseIndex(null);
    setEditingLocationIntervalIndex(null);
    setLocationHistoryError(null);
    setLifecycleError(null);
    setCareEventDialog(null);
    setConfirmCareEventId(null);
    setCareEventError(null);
    setShowAllCareEvents(false);
    setShowDeleteItemDialog(false);
    setDeleteItemError(null);
    setUsageAction(null);
    setUsageError(null);
    setShowAllUsageFacts(false);
    setShowAssignmentDialog(false);
    setAssignmentError(null);
  }

  async function handleDetailSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedItem) return;
    const formData = new FormData(event.currentTarget);
    const label = String(formData.get("label")).trim();
    const startDate = String(formData.get("startDate")) as LocalDate;
    const predictionDate = String(formData.get("predictionDate") || "") as LocalDate;
    const openedExpiryDate = String(formData.get("openedExpiryDate") || "") as LocalDate;
    const usageRatePerDay = Number(formData.get("usageRatePerDay") || 0);
    const locationId = String(formData.get("locationId"));
    const location = locations.find((item) => item.id === locationId);

    if (!label || !location) {
      setDetailError("请填写完整的实例名称和地点");
      return;
    }
    if (predictionDate && predictionDate < startDate) {
      setDetailError("预计更换日期不能早于启用日期");
      return;
    }
    if (openedExpiryDate && openedExpiryDate < startDate) {
      setDetailError("开封失效日期不能早于启用日期");
      return;
    }
    if (selectedUsageFacts.some((fact) => fact.date < startDate)) {
      setDetailError("启用日期不能晚于已有的使用或损耗记录");
      return;
    }
    if (
      selectedCareEvents.some(
        (careEvent) =>
          (careEvent.plannedDate && careEvent.plannedDate < startDate) ||
          (careEvent.completedDate && careEvent.completedDate < startDate)
      )
    ) {
      setDetailError("启用日期不能晚于已有的护理事件");
      return;
    }
    const firstIntervalEnd = selectedItem.stateIntervals?.[0]?.endDate;
    if (firstIntervalEnd && startDate >= firstIntervalEnd) {
      setDetailError("启用日期必须早于第一个状态区间的结束日期");
      return;
    }
    if (
      selectedItem.status === "completed" &&
      selectedItem.endDate &&
      startDate >= selectedItem.endDate
    ) {
      setDetailError("启用日期必须早于实际结束日期");
      return;
    }

    const adjustedStateIntervals = selectedItem.stateIntervals?.map((interval, index) =>
      index === 0 ? { ...interval, startDate } : { ...interval }
    );
    const adjustedItem = {
      ...selectedItem,
      startDate,
      ...(adjustedStateIntervals ? { stateIntervals: adjustedStateIntervals } : {})
    };
    const elapsedCalendarDays = Math.max(0, daysBetween(startDate, todayLocalDate()) + 1);
    const pausedDays = Math.max(
      0,
      elapsedCalendarDays - timelineItemActiveDays(adjustedItem, todayLocalDate())
    );
    const recalculatedBatchPredictionDate =
      selectedProfile?.managementTemplate === "batch_consumable" && usageRatePerDay > 0
        ? batchConsumptionPredictionDate(
            startDate,
            selectedItem.initialUnitQuantity ?? 0,
            usageRatePerDay,
            pausedDays
          )
        : null;
    const calculatedPredictionDate = recalculatedBatchPredictionDate ?? predictionDate;
    const adjustedEyeIntervals = selectedEyeAssignmentIntervals.map((interval, index) =>
      index === 0 ? { ...interval, startDate } : { ...interval }
    );
    const recalculatedCasePredictionDate =
      selectedProfile?.managementTemplate === "lens_case"
        ? lensCasePredictionDate(
            selectedEyeSides,
            eyeUsageTotals(adjustedEyeIntervals, todayLocalDate()),
            selectedLensCaseDurationDays,
            todayLocalDate()
          )
        : null;
    const nextPredictionDate =
      selectedProfile?.managementTemplate === "lens_case"
        ? (recalculatedCasePredictionDate ?? predictionDate)
        : selectedProfile?.managementTemplate === "opened_container"
          ? [
              selectedItem.depletionPredictionDate ?? calculatedPredictionDate,
              openedExpiryDate || selectedItem.openedExpiryDate
            ]
              .filter((date): date is LocalDate => Boolean(date))
              .sort()[0]
          : calculatedPredictionDate;
    const movedLocation = selectedItem.locationId && selectedItem.locationId !== location.id;
    const nextLocationIntervals =
      selectedItem.locationIntervals?.map((entry) => ({
        ...entry
      })) ??
      (selectedItem.locationId
        ? [
            {
              locationId: selectedItem.locationId,
              startDate: selectedItem.startDate,
              endDate: null
            }
          ]
        : []);
    if (movedLocation) {
      const last = nextLocationIntervals.at(-1);
      if (last?.startDate === todayLocalDate()) {
        last.locationId = location.id;
      } else {
        if (last) last.endDate = todayLocalDate();
        nextLocationIntervals.push({
          locationId: location.id,
          startDate: todayLocalDate(),
          endDate: null
        });
      }
    }
    if (nextLocationIntervals[0]) {
      nextLocationIntervals[0].startDate = startDate;
    }
    const nextItem: TimelineItem = {
      ...selectedItem,
      label,
      startDate,
      locationId: location.id,
      location: location.name,
      ...(selectedItem.stateIntervals
        ? {
            stateIntervals: selectedItem.stateIntervals.map((interval, index) =>
              index === 0 ? { ...interval, startDate } : { ...interval }
            )
          }
        : {}),
      ...(nextLocationIntervals.length > 0 ? { locationIntervals: nextLocationIntervals } : {}),
      ...(selectedItem.eyeAssignmentIntervals
        ? {
            eyeAssignmentIntervals: selectedItem.eyeAssignmentIntervals.map((interval, index) =>
              index === 0 ? { ...interval, startDate } : { ...interval }
            )
          }
        : {}),
      ...(nextPredictionDate ? { predictionDate: nextPredictionDate } : {}),
      ...(openedExpiryDate ? { openedExpiryDate } : {}),
      ...(usageRatePerDay > 0 ? { usageRatePerDay } : {})
    };
    const rescheduledTransactions: InventoryTransaction[] =
      startDate === selectedItem.startDate
        ? []
        : effectiveInventoryTransactions(transactions)
            .filter(
              (transaction) =>
                ["activate", "package_open", "loose_allocate"].includes(transaction.type) &&
                transaction.reversibleWithInstance !== false &&
                transaction.relatedInstanceId === selectedItem.id &&
                transaction.occurredDate !== startDate
            )
            .flatMap((original) => [
              {
                id: `tx-${crypto.randomUUID()}`,
                stockLotId: original.stockLotId,
                occurredDate: todayLocalDate(),
                type: "reverse" as const,
                quantityDelta: -original.quantityDelta,
                reversedTransactionId: original.id,
                ...(original.locationId ? { locationId: original.locationId } : {}),
                reason: "修改实例启用日期"
              },
              {
                ...original,
                id: `tx-${crypto.randomUUID()}`,
                occurredDate: startDate
              }
            ]);
    const remainingAtSource =
      movedLocation && selectedLot && selectedItem.locationId
        ? Math.max(0, availableUnitsAtLocation(selectedLot, selectedItem.locationId, transactions))
        : 0;
    const transferTransactions: InventoryTransaction[] =
      remainingAtSource > 0 && selectedItem.sourceStockLotId && selectedItem.locationId
        ? [
            {
              id: `tx-${crypto.randomUUID()}`,
              stockLotId: selectedItem.sourceStockLotId,
              occurredDate: todayLocalDate(),
              type: "transfer",
              quantityDelta: 0,
              fromLocationId: selectedItem.locationId,
              toLocationId: location.id,
              transferQuantity: remainingAtSource,
              reason: `时间轴实例“${selectedItem.label}”移动地点并转移全部剩余库存`
            }
          ]
        : [];
    try {
      await commitTimelineItemInventoryUpdate(nextItem, [
        ...rescheduledTransactions,
        ...transferTransactions
      ]);
    } catch (error) {
      setDetailError(error instanceof Error ? error.message : "地点或实例资料更新失败");
      return;
    }
    setEditingDetails(false);
    setDetailError(null);
  }

  function openAddDialog(profileId: string) {
    const profile = profileById.get(profileId);
    if (!profile?.active) return;
    const firstProduct = products.find((product) => productMatchesProfile(product, profile));
    const firstLot = firstProduct
      ? availableLotsByExpiry(firstProduct, lots, transactions, items)[0]
      : undefined;
    setAddProfileId(profile.id);
    setAddProductId(firstProduct?.id ?? "");
    setAddLotId(firstLot?.id ?? "");
    setAddDailySource(
      initialAddInventorySource(profile, firstLot, firstProduct, transactions, items)
    );
    const startDate = todayLocalDate();
    const durationDays =
      firstLot?.expectedUsageDays ??
      firstProduct?.defaultDurationDays ??
      profile.defaultDurationDays ??
      90;
    setAddStartDate(startDate);
    setAddExpectedEndDate(addLocalDays(startDate, durationDays - 1));
    setAddDepletionDate(
      profile.managementTemplate === "opened_container" && firstProduct
        ? estimatedConsumptionDate(profile, firstProduct, startDate)
        : inclusiveCycleEndDate(startDate, durationDays)
    );
    setAddNotice(null);
    setShowAddDialog(true);
  }

  function selectAddProduct(productId: string) {
    const product = products.find((item) => item.id === productId);
    const firstLot = product
      ? availableLotsByExpiry(product, lots, transactions, items)[0]
      : undefined;
    setAddProductId(productId);
    setAddLotId(firstLot?.id ?? "");
    setAddDailySource(
      initialAddInventorySource(addProfile, firstLot, product, transactions, items)
    );
    const durationDays =
      firstLot?.expectedUsageDays ??
      product?.defaultDurationDays ??
      addProfile?.defaultDurationDays ??
      90;
    setAddExpectedEndDate(addLocalDays(addStartDate, durationDays - 1));
    setAddDepletionDate(
      addProfile?.managementTemplate === "opened_container" && product
        ? estimatedConsumptionDate(addProfile, product, addStartDate)
        : inclusiveCycleEndDate(addStartDate, durationDays)
    );
  }

  function selectAddLot(lotId: string) {
    const lot = lots.find((item) => item.id === lotId);
    setAddLotId(lotId);
    setAddDailySource(
      initialAddInventorySource(addProfile, lot, selectedAddProduct, transactions, items)
    );
    const durationDays =
      lot?.expectedUsageDays ??
      selectedAddProduct?.defaultDurationDays ??
      addProfile?.defaultDurationDays ??
      90;
    setAddExpectedEndDate(addLocalDays(addStartDate, durationDays - 1));
    setAddDepletionDate(
      addProfile?.managementTemplate === "opened_container" && selectedAddProduct
        ? estimatedConsumptionDate(addProfile, selectedAddProduct, addStartDate)
        : inclusiveCycleEndDate(addStartDate, durationDays)
    );
  }

  function changeAddStartDate(startDate: LocalDate) {
    setAddStartDate(startDate);
    const durationDays =
      selectedAddLot?.expectedUsageDays ??
      selectedAddProduct?.defaultDurationDays ??
      addProfile?.defaultDurationDays ??
      90;
    setAddExpectedEndDate(addLocalDays(startDate, durationDays - 1));
    setAddDepletionDate(
      addProfile?.managementTemplate === "opened_container" && selectedAddProduct
        ? estimatedConsumptionDate(addProfile, selectedAddProduct, startDate)
        : inclusiveCycleEndDate(startDate, durationDays)
    );
  }

  async function handleAdd(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!addProfile || !addTemplateSupported || !selectedAddProduct || !selectedAddLot) {
      return;
    }
    const formData = new FormData(event.currentTarget);
    if (addProfile.managementTemplate === "lens_case" && formData.getAll("eyeSides").length === 0) {
      setAddNotice("镜盒启用时请至少选择左眼或右眼");
      return;
    }
    try {
      const name = String(formData.get("name"));
      const expectedEndDate = String(formData.get("expectedEndDate") || "");
      await commitDataMutation(() => {
        activateInventoryItem({
          profileId: addProfile.id,
          productId: selectedAddProduct.id,
          stockLotId: selectedAddLot.id,
          name,
          startDate: String(formData.get("startDate")) as LocalDate,
          locationId: String(formData.get("locationId")),
          ...(expectedEndDate ? { expectedEndDate: expectedEndDate as LocalDate } : {}),
          ...(["soft_daily", "soft_reusable"].includes(addProfile.managementTemplate)
            ? {
                inventorySourceKind: addDailySource,
                ...(addProfile.managementTemplate === "soft_daily"
                  ? {
                      initialUnitQuantity: Math.max(1, Number(formData.get("initialUnitQuantity")))
                    }
                  : {})
              }
            : {}),
          ...(addProfile.managementTemplate === "batch_consumable"
            ? {
                usageRatePerDay: Math.max(0.01, Number(formData.get("usageRatePerDay")))
              }
            : {}),
          ...(addProfile.managementTemplate === "lens_case"
            ? {
                eyeSides: formData
                  .getAll("eyeSides")
                  .map(String)
                  .filter((side): side is "L" | "R" => side === "L" || side === "R")
              }
            : {}),
          ...(addProfile.managementTemplate === "opened_container"
            ? {
                ...(selectedAddConsumptionRate
                  ? { usageRatePerDay: selectedAddConsumptionRate }
                  : {}),
                depletionPredictionDate: String(
                  formData.get("depletionPredictionDate")
                ) as LocalDate
              }
            : {})
        });
      });
      setShowAddDialog(false);
      setAddNotice(`${name} 已启用并添加到${addProfile.name}`);
    } catch (error) {
      setAddNotice(error instanceof Error ? error.message : "添加记录失败");
    }
  }

  return (
    <section className={styles.page}>
      <header className={styles.header}>
        <div>
          <span className={styles.eyebrow}>LENS CYCLE</span>
          <h1>时间轴</h1>
        </div>
        <div className={styles.toolbar}>
          {showSearch && (
            <label className={styles.searchField}>
              <Icon name="search" size={17} />
              <input
                autoFocus
                onChange={(event) => setSearch(event.target.value)}
                placeholder="搜索用品、位置"
                value={search}
              />
            </label>
          )}
          <button
            aria-label="搜索"
            className={styles.iconButton}
            onClick={() => setShowSearch((value) => !value)}
            type="button"
          >
            <Icon name="search" />
          </button>
          <div className={styles.filterWrap}>
            <button
              className={
                showFilters || statusFilter !== "all" ? styles.controlActive : styles.control
              }
              onClick={() => setShowFilters((value) => !value)}
              type="button"
            >
              <Icon name="filter" size={18} />
              筛选
            </button>
            {showFilters && (
              <div className={styles.filterMenu}>
                <strong>按状态显示</strong>
                {(["all", "active", "paused", "completed", "planned"] as StatusFilter[]).map(
                  (status) => (
                    <button
                      className={statusFilter === status ? styles.filterSelected : undefined}
                      key={status}
                      onClick={() => {
                        setStatusFilter(status);
                        setShowFilters(false);
                      }}
                      type="button"
                    >
                      {status === "all" ? "全部状态" : statusMeta[status]}
                      {statusFilter === status && <span>✓</span>}
                    </button>
                  )
                )}
              </div>
            )}
          </div>
        </div>
      </header>

      <div className={styles.controlRow}>
        <div className={styles.presetGroup} aria-label="快捷时间尺度">
          {[
            ["月", 31],
            ["季度", 92],
            ["半年", 183],
            ["一年", 366],
            ["全部", 1095]
          ].map(([label, days]) => (
            <button key={label} onClick={() => applyPreset(Number(days))} type="button">
              {label}
            </button>
          ))}
        </div>
        <button
          className={styles.todayButton}
          onClick={() => setViewport({ ...viewport, centerDate: todayLocalDate() })}
          type="button"
        >
          <Icon name="calendar" size={17} />
          今天
        </button>
        <div className={styles.zoomControl}>
          <button
            aria-label="缩小"
            onClick={() => setViewport(zoomAtX(viewport, viewport.viewportWidth / 2, 0.72))}
            type="button"
          >
            −
          </button>
          <span>{Math.round(viewport.pixelsPerDay * 100)}%</span>
          <button
            aria-label="放大"
            onClick={() => setViewport(zoomAtX(viewport, viewport.viewportWidth / 2, 1.38))}
            type="button"
          >
            +
          </button>
        </div>
      </div>

      <TimelineLegend />

      <div className={styles.timelineCard}>
        <div className={styles.timelineHeader}>
          <div className={styles.leftHeader}>
            <span>用品与状态</span>
            <button onClick={() => setShowManageItems(true)} type="button">
              管理
            </button>
          </div>
          <div className={styles.plotHeader}>
            <svg aria-hidden="true" height="54" width={viewport.viewportWidth}>
              {timelineTicks.contextBands.map((band, index) => {
                const rawX1 = dateToX(band.startDate, viewport);
                const rawX2 = dateToX(band.endDate, viewport);
                const x1 = Math.max(0, rawX1);
                const x2 = Math.min(viewport.viewportWidth, rawX2);
                const width = Math.max(0, x2 - x1);
                if (width === 0) return null;
                return (
                  <g
                    className={index % 2 === 0 ? styles.contextBand : styles.contextBandAlternate}
                    key={`${band.startDate}-${band.endDate}`}
                  >
                    <rect height="25" width={width} x={x1} y="0" />
                    <line x1={x1} x2={x1} y1="0" y2="54" />
                    {width >= 44 && (
                      <text className={styles.contextBandLabel} x={x1 + width / 2} y="17">
                        {band.label}
                      </text>
                    )}
                  </g>
                );
              })}
              {timelineTicks.ticks.map((tick) => {
                const x = dateToX(tick.date, viewport);
                const hasContextBands = timelineTicks.contextBands.length > 0;
                const labelEndX = tick.labelEndDate ? dateToX(tick.labelEndDate, viewport) : null;
                const labelX = labelEndX !== null ? (labelEndX - x) / 2 : 7;
                const labelIsVisible =
                  tick.showLabel &&
                  (labelEndX === null
                    ? x >= 0 && x <= viewport.viewportWidth - 18
                    : x >= 0 &&
                      labelEndX <= viewport.viewportWidth &&
                      labelEndX - x >= (tick.minimumLabelWidth ?? 0));
                return (
                  <g
                    className={tick.major ? styles.headerTickMajor : styles.headerTickMinor}
                    key={tick.date}
                    transform={`translate(${x}, 0)`}
                  >
                    <line
                      y1={hasContextBands ? (tick.major ? "25" : "36") : tick.major ? "27" : "38"}
                      y2="54"
                    />
                    {labelIsVisible && (
                      <text
                        textAnchor={labelEndX !== null ? "middle" : "start"}
                        x={labelX}
                        y={hasContextBands ? "46" : "20"}
                      >
                        {tick.label}
                      </text>
                    )}
                  </g>
                );
              })}
            </svg>
          </div>
        </div>

        {(items.length === 0 || hasEmptyFilterResult) && (
          <div className={styles.timelineOnboarding}>
            {hasEmptyFilterResult ? (
              <EmptyState
                compact
                description="当前关键词或状态条件下没有匹配记录，现有数据不会受到影响。"
                eyebrow="筛选结果为空"
                icon="search"
                primaryAction={{
                  label: "清除筛选",
                  onClick: () => {
                    setSearch("");
                    setStatusFilter("all");
                  }
                }}
                title="没有找到时间轴记录"
              />
            ) : activeProfiles.length === 0 ? (
              <EmptyState
                compact
                description="用品配置决定左侧显示哪些行，以及每一行采用哪种生命周期管理方式。"
                eyebrow="第 1 步"
                icon="settings"
                primaryAction={{
                  label: "管理用品配置",
                  onClick: () => setShowManageItems(true)
                }}
                steps={["选择管理模板", "命名用品行", "创建关联产品"]}
                title="先建立第一条用品配置"
              />
            ) : !hasConfiguredProducts ? (
              <EmptyState
                compact
                description="用品行已经准备好。时间轴实例必须来源于库存产品，请先创建与这些行关联的产品。"
                eyebrow="第 2 步"
                icon="inventory"
                primaryAction={
                  onNavigateToInventory
                    ? { label: "前往库存创建产品", onClick: onNavigateToInventory }
                    : undefined
                }
                title="为用品配置创建产品"
              />
            ) : !hasUsableInventory ? (
              <EmptyState
                compact
                description="产品资料已经建立，但当前没有可启用库存。完成一次入库后即可创建时间轴实例。"
                eyebrow="第 3 步"
                icon="inventory"
                primaryAction={
                  onNavigateToInventory
                    ? { label: "前往库存入库", onClick: onNavigateToInventory }
                    : undefined
                }
                title="录入首批可用库存"
              />
            ) : (
              <EmptyState
                compact
                description="产品和库存都已准备好。点击左侧用品行末尾的“添加”，选择产品批次并填写启用日期。"
                eyebrow="第 4 步"
                icon="timeline"
                title="添加第一条时间轴记录"
              />
            )}
          </div>
        )}

        <div className={styles.timelineScroll}>
          <div className={styles.timelineBody} style={{ height: totalHeight }}>
            <div className={styles.leftPanel} style={{ width: LEFT_PANEL_WIDTH }}>
              {rows.map((row) =>
                row.type === "group" ? (
                  <button
                    className={styles.groupRow}
                    key={row.key}
                    onClick={() => toggleGroup(row.groupId)}
                    style={{ top: row.y, height: row.height }}
                    type="button"
                  >
                    <span
                      className={expandedGroups[row.groupId] ? styles.chevronOpen : styles.chevron}
                    >
                      <Icon name="chevron" size={17} />
                    </span>
                    <strong>{groupMeta[row.groupId].title}</strong>
                    <small>
                      {
                        profiles.filter(
                          (profile) => profile.groupId === row.groupId && profile.active
                        ).length
                      }{" "}
                      个配置
                    </small>
                  </button>
                ) : (
                  <div
                    className={styles.categoryRow}
                    key={row.key}
                    style={{ top: row.y, height: row.height }}
                  >
                    <div>
                      <strong>{row.categoryName}</strong>
                      {row.categoryId && renderCategorySummary(row.categoryId)}
                    </div>
                    {row.categoryId && profileById.get(row.categoryId)?.active && (
                      <button
                        aria-label={`向${row.categoryName}添加记录`}
                        className={styles.rowAddButton}
                        onClick={() => openAddDialog(row.categoryId!)}
                        title="添加记录"
                        type="button"
                      >
                        <Icon name="plus" size={15} />
                        <span>添加</span>
                      </button>
                    )}
                  </div>
                )
              )}
            </div>

            <div
              className={styles.plot}
              onWheel={handleWheel}
              ref={plotRef}
              style={{ left: LEFT_PANEL_WIDTH }}
            >
              <svg
                aria-label="用品生命周期时间轴"
                className={styles.plotSvg}
                height={totalHeight}
                onPointerCancel={finishPointerAction}
                onPointerDown={handlePlotPointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={finishPointerAction}
                width={viewport.viewportWidth}
              >
                <defs>
                  <pattern
                    height="7"
                    id="pausedPattern"
                    patternTransform="rotate(35)"
                    patternUnits="userSpaceOnUse"
                    width="7"
                  >
                    <rect fill="var(--color-paused)" height="7" width="7" />
                    <line stroke="#ffffff" strokeOpacity=".3" strokeWidth="2" y2="7" />
                  </pattern>
                </defs>

                {timelineTicks.ticks.map((tick) => {
                  const x = dateToX(tick.date, viewport);
                  return (
                    <line
                      className={tick.major ? styles.yearGrid : styles.monthGrid}
                      key={tick.date}
                      x1={x}
                      x2={x}
                      y1={0}
                      y2={totalHeight}
                    />
                  );
                })}

                {rows.map((row) => (
                  <g key={`grid-${row.key}`}>
                    {row.type === "group" && (
                      <rect
                        className={styles.groupBand}
                        height={row.height}
                        width={viewport.viewportWidth}
                        x={0}
                        y={row.y}
                      />
                    )}
                    <line
                      className={styles.rowLine}
                      x1={0}
                      x2={viewport.viewportWidth}
                      y1={row.y + row.height}
                      y2={row.y + row.height}
                    />
                  </g>
                ))}

                {dateToX(todayLocalDate(), viewport) >= 0 &&
                  dateToX(todayLocalDate(), viewport) <= viewport.viewportWidth && (
                    <g className={styles.todayLine}>
                      <line
                        x1={dateToX(todayLocalDate(), viewport)}
                        x2={dateToX(todayLocalDate(), viewport)}
                        y1={0}
                        y2={totalHeight}
                      />
                      <circle cx={dateToX(todayLocalDate(), viewport)} cy={7} r={4} />
                    </g>
                  )}

                {rows
                  .filter((row) => row.type === "category")
                  .flatMap((row) =>
                    filteredItems
                      .filter(
                        (item) => item.categoryId === row.categoryId && row.laneByItem.has(item.id)
                      )
                      .map((item) => {
                        const itemProfile = profileById.get(item.categoryId);
                        const itemFacts = usageFacts.filter((fact) => fact.itemId === item.id);
                        const itemUsedQuantity = itemFacts.reduce(
                          (total, fact) => total + fact.quantity,
                          0
                        );
                        const itemReusableCycles =
                          itemProfile?.managementTemplate === "soft_reusable"
                            ? reusableLensCyclesFor(item)
                            : [];
                        const itemProduct = products.find(
                          (product) => product.id === item.productId
                        );
                        const itemBaseUnit =
                          itemProduct?.baseUnit ?? itemProfileBaseUnit(itemProfile);
                        const itemLot = lots.find((lot) => lot.id === item.sourceStockLotId);
                        const itemReusableCapacity =
                          item.initialUnitQuantity ??
                          (itemLot && itemProduct
                            ? lotUnitsPerPackage(itemLot, itemProduct)
                            : itemReusableCycles.length);
                        const itemReusableLosses = itemFacts
                          .filter((fact) => fact.kind === "extra_loss")
                          .reduce((total, fact) => total + fact.quantity, 0);
                        const itemReusableRemaining = Math.max(
                          0,
                          itemReusableCapacity - itemReusableCycles.length - itemReusableLosses
                        );
                        const previewDays = dragPreview?.itemId === item.id ? dragPreview.days : 0;
                        const x1 = dateToX(addLocalDays(item.startDate, previewDays), viewport);
                        const actualEnd = item.endDate ?? addLocalDays(todayLocalDate(), 1);
                        const x2 = dateToX(addLocalDays(actualEnd, previewDays), viewport);
                        const lane = row.laneByItem.get(item.id) ?? 0;
                        const y = row.y + 12 + lane * LANE_HEIGHT;
                        const width = Math.max(8, x2 - x1);
                        const plans = careEvents.filter(
                          (event) => event.itemId === item.id && careEventDate(event)
                        );
                        const segments = item.stateIntervals ?? [
                          {
                            startDate: item.startDate,
                            endDate: item.endDate ?? todayLocalDate(),
                            status:
                              item.status === "paused" ? ("paused" as const) : ("active" as const)
                          }
                        ];
                        const displayedPredictionDate = item.predictionDate
                          ? addLocalDays(item.predictionDate, previewDays)
                          : null;
                        const predictionX = displayedPredictionDate
                          ? dateToX(displayedPredictionDate, viewport)
                          : null;
                        const displayedOpenedExpiry = item.openedExpiryDate
                          ? addLocalDays(item.openedExpiryDate, previewDays)
                          : null;
                        const openedExpiryX = displayedOpenedExpiry
                          ? dateToX(displayedOpenedExpiry, viewport)
                          : null;
                        const replacementLimitedByOpenedExpiry =
                          itemProfile?.managementTemplate === "opened_container" &&
                          displayedPredictionDate !== null &&
                          displayedOpenedExpiry !== null &&
                          displayedPredictionDate === displayedOpenedExpiry;
                        const replacementForecastVisible =
                          item.status !== "completed" && predictionX !== null && predictionX > x2;
                        const itemEyeUsage =
                          itemProfile?.managementTemplate === "lens_case"
                            ? Array.from(
                                eyeUsageTotals(eyeAssignmentIntervalsFor(item), todayLocalDate())
                              )
                            : [];
                        const dynamicUsageSummary = timelineItemUsageSummary(
                          item,
                          itemProfile?.managementTemplate,
                          todayLocalDate()
                        );
                        const itemDetail =
                          dynamicUsageSummary ??
                          (itemProfile?.managementTemplate === "soft_daily"
                            ? `剩余 ${Math.max(
                                0,
                                (item.initialUnitQuantity ?? 0) - itemUsedQuantity
                              )} ${itemBaseUnit}`
                            : itemProfile?.managementTemplate === "soft_reusable"
                              ? `盒内剩余 ${itemReusableRemaining} ${itemBaseUnit}`
                              : itemProfile?.managementTemplate === "lens_case"
                                ? itemEyeUsage.length
                                  ? itemEyeUsage
                                      .map(
                                        ([side, days]) => `${side === "L" ? "左" : "右"} ${days}天`
                                      )
                                      .join(" · ")
                                  : "未设置眼别"
                                : itemProfile?.managementTemplate === "discrete_dose"
                                  ? `已使用 ${itemUsedQuantity} ${itemBaseUnit}`
                                  : item.detail);
                        const clipId = `lifecycle-clip-${item.id}`;
                        return (
                          <g key={item.id}>
                            <clipPath id={clipId}>
                              <rect height="26" rx="7" width={width} x={x1} y={y} />
                            </clipPath>
                            <g
                              className={styles.lifecycleBar}
                              onClick={(event) => {
                                event.stopPropagation();
                                if (pointerAction.current) return;
                                openItemDetails(item.id);
                                if (
                                  (itemProfile?.managementTemplate === "soft_daily" ||
                                    itemProfile?.managementTemplate === "discrete_dose") &&
                                  viewport.pixelsPerDay >= 7 &&
                                  plotRef.current
                                ) {
                                  const clickedDate = xToDayCellDate(
                                    event.clientX - plotRef.current.getBoundingClientRect().left,
                                    viewport
                                  );
                                  if (
                                    clickedDate >= item.startDate &&
                                    clickedDate <= todayLocalDate() &&
                                    item.status !== "completed"
                                  ) {
                                    const existing = itemFacts.find(
                                      (fact) =>
                                        fact.kind ===
                                          (itemProfile.managementTemplate === "soft_daily"
                                            ? "wear"
                                            : "dose") && fact.date === clickedDate
                                    );
                                    if (existing) {
                                      setEditingUsageFactId(existing.id);
                                    } else {
                                      setUsageDefaultDate(clickedDate);
                                      setUsageAction(
                                        itemProfile.managementTemplate === "soft_daily"
                                          ? "wear"
                                          : "dose"
                                      );
                                    }
                                  }
                                }
                              }}
                              onPointerDown={(event) => handleBarPointerDown(event, item.id)}
                              role="button"
                              tabIndex={0}
                            >
                              <rect
                                className={styles.barHitArea}
                                height="26"
                                rx="7"
                                width={width}
                                x={x1}
                                y={y}
                              />
                              {segments.map((segment, segmentIndex) => {
                                const segmentStart = dateToX(
                                  addLocalDays(segment.startDate, previewDays),
                                  viewport
                                );
                                const segmentEnd = dateToX(
                                  addLocalDays(segment.endDate ?? actualEnd, previewDays),
                                  viewport
                                );
                                const isCurrentPause =
                                  segment.status === "paused" &&
                                  segment.endDate === null &&
                                  item.status === "paused";
                                const segmentClass =
                                  itemProfile?.managementTemplate === "soft_daily" ||
                                  itemProfile?.managementTemplate === "soft_reusable" ||
                                  itemProfile?.managementTemplate === "discrete_dose"
                                    ? styles.segmentTracking
                                    : segment.status === "paused"
                                      ? isCurrentPause
                                        ? styles.segmentPausedCurrent
                                        : styles.segmentPausedHistory
                                      : item.status === "completed"
                                        ? styles.segmentCompleted
                                        : styles.segmentActive;
                                return (
                                  <rect
                                    className={segmentClass}
                                    clipPath={`url(#${clipId})`}
                                    fill={isCurrentPause ? "url(#pausedPattern)" : undefined}
                                    height="26"
                                    key={`${item.id}-segment-${segmentIndex}`}
                                    width={Math.max(2, segmentEnd - segmentStart)}
                                    x={segmentStart}
                                    y={y}
                                  />
                                );
                              })}
                              {itemReusableCycles.map((cycle) => {
                                const cycleX1 = dateToX(
                                  addLocalDays(cycle.startDate, previewDays),
                                  viewport
                                );
                                const cycleX2 = dateToX(
                                  addLocalDays(cycle.endDate ?? actualEnd, previewDays),
                                  viewport
                                );
                                return (
                                  <rect
                                    className={
                                      cycle.status === "active"
                                        ? styles.reusableLensCycleActive
                                        : styles.reusableLensCycleCompleted
                                    }
                                    clipPath={`url(#${clipId})`}
                                    height="22"
                                    key={cycle.id}
                                    rx="5"
                                    width={Math.max(2, cycleX2 - cycleX1)}
                                    x={cycleX1}
                                    y={y + 2}
                                  />
                                );
                              })}
                              {width > 48 && (
                                <text x={x1 + 10} y={y + 17}>
                                  {width > 150 ? `${item.label} · ${itemDetail}` : item.label}
                                </text>
                              )}
                            </g>
                            {itemFacts.map((fact) => {
                              const factX = dateToX(addLocalDays(fact.date, previewDays), viewport);
                              return fact.kind === "extra_loss" ? (
                                <path
                                  className={styles.usageLossMarker}
                                  d={`M${factX} ${y + 5} l5 8 -5 8 -5 -8Z`}
                                  key={fact.id}
                                />
                              ) : (
                                <rect
                                  className={`${styles.usageDayBlock} ${
                                    (itemProfile?.managementTemplate === "soft_daily" ||
                                      itemProfile?.managementTemplate === "discrete_dose") &&
                                    item.status === "completed"
                                      ? styles.usageDayBlockCompleted
                                      : ""
                                  }`}
                                  height="22"
                                  key={fact.id}
                                  rx="2"
                                  width={Math.max(2, viewport.pixelsPerDay)}
                                  x={factX}
                                  y={y + 2}
                                />
                              );
                            })}
                            {replacementForecastVisible && (
                              <g className={styles.forecast}>
                                <line x1={x2} x2={predictionX} y1={y + 13} y2={y + 13} />
                                {replacementLimitedByOpenedExpiry ? (
                                  <path
                                    className={styles.forecastExpiryNode}
                                    d={`M${predictionX} ${y + 8} L${predictionX + 5} ${
                                      y + 13
                                    } L${predictionX} ${y + 18} L${predictionX - 5} ${y + 13} Z`}
                                  />
                                ) : (
                                  <circle cx={predictionX} cy={y + 13} r="5" />
                                )}
                                {viewport.pixelsPerDay > 2 && displayedPredictionDate && (
                                  <text x={predictionX + 9} y={y + 5}>
                                    {replacementLimitedByOpenedExpiry ? "失效 " : ""}
                                    {format(parseLocalDate(displayedPredictionDate), "M月d日")}
                                  </text>
                                )}
                              </g>
                            )}
                            {item.status !== "completed" &&
                              openedExpiryX !== null &&
                              !(replacementLimitedByOpenedExpiry && replacementForecastVisible) && (
                                <g className={styles.expiryMarker}>
                                  <line
                                    x1={openedExpiryX}
                                    x2={openedExpiryX}
                                    y1={y + 3}
                                    y2={y + 23}
                                  />
                                  <path
                                    d={`M${openedExpiryX} ${y + 8} L${openedExpiryX + 5} ${
                                      y + 13
                                    } L${openedExpiryX} ${y + 18} L${openedExpiryX - 5} ${
                                      y + 13
                                    } Z`}
                                  />
                                  {viewport.pixelsPerDay > 2.5 && displayedOpenedExpiry && (
                                    <text x={openedExpiryX + 6} y={y + 25}>
                                      失效 {format(parseLocalDate(displayedOpenedExpiry), "M月d日")}
                                    </text>
                                  )}
                                </g>
                              )}
                            {plans.map((plan) => {
                              const planDate = careEventDate(plan)!;
                              const planState = careEventState(plan, todayLocalDate());
                              const planX = dateToX(planDate, viewport);
                              return (
                                <g
                                  className={`${styles.eventNode} ${
                                    plan.kind === "protein"
                                      ? styles.eventProtein
                                      : styles.eventReview
                                  } ${
                                    planState === "completed"
                                      ? styles.eventCompleted
                                      : planState === "due"
                                        ? styles.eventDue
                                        : styles.eventPending
                                  }`}
                                  key={plan.id}
                                  transform={`translate(${planX}, ${y - 1})`}
                                >
                                  {plan.kind === "protein" ? (
                                    <path d="M0-8C0-8-6-1-6 3a6 6 0 0 0 12 0C6-1 0-8 0-8Z" />
                                  ) : (
                                    <circle cy="3" r="6" />
                                  )}
                                  {(planState === "completed"
                                    ? viewport.pixelsPerDay > 3
                                    : viewport.pixelsPerDay > 2) && (
                                    <text x="9" y="-4">
                                      {careEventLabel(plan)}
                                      {planState !== "completed" &&
                                        ` ${format(parseLocalDate(planDate), "M月d日")}`}
                                    </text>
                                  )}
                                </g>
                              );
                            })}
                          </g>
                        );
                      })
                  )}
              </svg>
            </div>
          </div>
        </div>
      </div>

      {selectedItem && (
        <aside className={styles.drawer} aria-label="用品详情">
          <button
            aria-label="关闭详情"
            className={styles.drawerClose}
            onClick={closeItemDetails}
            type="button"
          >
            <Icon name="close" />
          </button>
          <span className={`${styles.statusBadge} ${styles[`badge_${selectedItem.status}`]}`}>
            {statusMeta[selectedItem.status]}
          </span>
          <h2>{editingDetails ? "编辑实例资料" : selectedItem.label}</h2>
          <p className={styles.drawerCategory}>
            {selectedItem.categoryName}
            {selectedProfile?.side ? ` · ${selectedProfile.side}` : ""}
          </p>

          <section className={styles.productSummary}>
            <span>关联产品</span>
            <strong>
              {selectedProduct
                ? `${selectedProduct.brand}${selectedProduct.model ? ` · ${selectedProduct.model}` : ""}`
                : "产品记录缺失"}
            </strong>
            <small>
              {selectedProduct?.capacityMl
                ? `${selectedProduct.capacityMl} mL`
                : (selectedProduct?.specification ?? "未填写规格")}{" "}
              · 批次 {selectedLot?.internalLotCode ?? "记录缺失"}
              {selectedLot?.lotNumber ? ` · 生产批号 ${selectedLot.lotNumber}` : ""}
            </small>
          </section>

          {editingDetails ? (
            <form className={styles.detailForm} onSubmit={handleDetailSave}>
              {detailError && <div className={styles.detailError}>{detailError}</div>}
              <label>
                实例名称
                <input defaultValue={selectedItem.label} name="label" required />
              </label>
              <label>
                启用日期
                <LocalDateInput defaultValue={selectedItem.startDate} name="startDate" required />
              </label>
              <label>
                当前地点
                <select
                  defaultValue={selectedLocation?.id ?? locations[0]?.id}
                  name="locationId"
                  required
                >
                  {locations
                    .filter((location) => location.active)
                    .sort((a, b) => a.order - b.order)
                    .map((location) => (
                      <option key={location.id} value={location.id}>
                        {location.name}
                      </option>
                    ))}
                </select>
              </label>
              {selectedItem.predictionDate && (
                <label>
                  {selectedProfile?.managementTemplate === "opened_container"
                    ? "预计更换日期"
                    : selectedProfile?.managementTemplate === "batch_consumable"
                      ? "预计耗尽日期"
                      : selectedProfile?.managementTemplate === "lens_case"
                        ? "预计切换／更换眼别日期"
                        : "预计更换日期"}
                  <LocalDateInput
                    defaultValue={selectedItem.predictionDate}
                    name="predictionDate"
                    readOnly={
                      selectedProfile?.managementTemplate === "lens_case" ||
                      selectedProfile?.managementTemplate === "opened_container"
                    }
                    required
                  />
                  {selectedProfile?.managementTemplate === "lens_case" && (
                    <small>根据当前眼别、累计使用天数和产品周期自动计算。</small>
                  )}
                </label>
              )}
              {selectedItem.openedExpiryDate && (
                <label>
                  开封后最晚使用日期
                  <LocalDateInput
                    defaultValue={selectedItem.openedExpiryDate}
                    name="openedExpiryDate"
                    required
                  />
                </label>
              )}
              {selectedProfile?.managementTemplate === "opened_container" &&
                selectedItem.depletionPredictionDate && (
                  <label>
                    预测使用完日期
                    <LocalDateInput readOnly value={selectedItem.depletionPredictionDate} />
                    <small>最终预计更换日期取本日期与最晚使用日期中的较早值。</small>
                  </label>
                )}
              {selectedProfile?.managementTemplate === "batch_consumable" && (
                <label>
                  预计每日使用量（{selectedBaseUnit}/天）
                  <input
                    defaultValue={selectedItem.usageRatePerDay ?? 1}
                    min="0.01"
                    name="usageRatePerDay"
                    required
                    step="0.01"
                    type="number"
                  />
                </label>
              )}
              <div className={styles.detailFormActions}>
                <button
                  onClick={() => {
                    setEditingDetails(false);
                    setDetailError(null);
                  }}
                  type="button"
                >
                  取消
                </button>
                <button className={styles.primaryButton} type="submit">
                  保存资料
                </button>
              </div>
            </form>
          ) : (
            <>
              <h3 className={styles.drawerSectionTitle}>当前信息</h3>
              <dl>
                <div>
                  <dt>启用日期</dt>
                  <dd>{displayLocalDate(selectedItem.startDate)}</dd>
                </div>
                <div>
                  <dt>当前地点</dt>
                  <dd>{selectedItem.location}</dd>
                </div>
                {(["soft_daily", "soft_reusable"] as const).includes(
                  selectedProfile?.managementTemplate as "soft_daily" | "soft_reusable"
                ) && (
                  <div>
                    <dt>库存来源</dt>
                    <dd>
                      {selectedProfile?.managementTemplate === "soft_reusable"
                        ? selectedItem.inventorySourceKind === "loose"
                          ? `散片 · 启用 1 ${selectedBaseUnit}`
                          : `完整盒 · 初始 ${selectedReusableCapacity ?? 0} ${selectedBaseUnit}`
                        : selectedItem.inventorySourceKind === "loose"
                          ? `散片分配 · 初始 ${selectedItem.initialUnitQuantity ?? 0} ${selectedBaseUnit}`
                          : `完整盒 · 初始 ${selectedItem.initialUnitQuantity ?? 0} ${selectedBaseUnit}`}
                    </dd>
                  </div>
                )}
                <div>
                  <dt>使用情况</dt>
                  <dd>
                    {selectedProfile?.managementTemplate === "soft_daily"
                      ? `佩戴 ${
                          selectedUsageFacts.filter((fact) => fact.kind === "wear").length
                        } 天 · 剩余 ${selectedRemainingQuantity ?? 0} ${selectedBaseUnit}`
                      : selectedProfile?.managementTemplate === "soft_reusable"
                        ? `已启用 ${selectedReusableCycles.length} ${selectedBaseUnit} · 盒内剩余 ${selectedRemainingQuantity ?? 0} ${selectedBaseUnit}`
                        : selectedProfile?.managementTemplate === "discrete_dose"
                          ? `已使用 ${selectedUsedQuantity} ${selectedBaseUnit}`
                          : selectedProfile?.managementTemplate === "batch_consumable"
                            ? selectedItem.status === "completed"
                              ? `实际剩余 ${selectedLocationAvailableUnits} ${selectedBaseUnit}`
                              : `预计剩余 ${Math.round(
                                  Math.max(0, selectedPredictedQuantity ?? 0)
                                )} ${selectedBaseUnit}`
                            : `已使用 ${selectedItemUsedDays} 天`}
                  </dd>
                </div>
                {selectedItem.predictionDate && (
                  <div>
                    <dt>
                      {selectedProfile?.managementTemplate === "batch_consumable"
                        ? "预计耗尽"
                        : selectedProfile?.managementTemplate === "opened_container"
                          ? "预计用完"
                          : selectedProfile?.managementTemplate === "lens_case"
                            ? "预计切换／更换眼别"
                            : "预计更换"}
                    </dt>
                    <dd>{displayLocalDate(selectedItem.predictionDate)}</dd>
                  </div>
                )}
                {selectedItem.openedExpiryDate && (
                  <div>
                    <dt>开封失效</dt>
                    <dd>{displayLocalDate(selectedItem.openedExpiryDate)}</dd>
                  </div>
                )}
                {selectedProfile?.managementTemplate === "lens_case" && (
                  <>
                    <div>
                      <dt>当前使用眼别</dt>
                      <dd>
                        {selectedEyeSides.length
                          ? selectedEyeSides
                              .map((side) => (side === "L" ? "左眼" : "右眼"))
                              .join("、")
                          : "暂未设置"}
                      </dd>
                    </div>
                    <div>
                      <dt>各眼累计</dt>
                      <dd>
                        {selectedAssignmentUsage.length
                          ? selectedAssignmentUsage
                              .map(([side, days]) => `${side === "L" ? "左眼" : "右眼"} ${days} 天`)
                              .join("、")
                          : "暂无"}
                      </dd>
                    </div>
                    <div>
                      <dt>当前眼别预计</dt>
                      <dd>
                        {selectedEyeExpectedDates.length
                          ? selectedEyeExpectedDates
                              .map(
                                ({ side, date }) =>
                                  `${side === "L" ? "左眼" : "右眼"} ${displayLocalDate(date)}`
                              )
                              .join("、")
                          : "请先设置使用眼别"}
                      </dd>
                    </div>
                  </>
                )}
                <div>
                  <dt>实际结束</dt>
                  <dd>
                    {selectedItem.status === "completed" && selectedItem.endDate
                      ? displayLocalDate(addLocalDays(selectedItem.endDate, -1))
                      : "未结束"}
                  </dd>
                </div>
              </dl>
              {selectedProfile?.managementTemplate === "lens_case" && (
                <section className={styles.usageFactsSection}>
                  {assignmentError && (
                    <div className={styles.lifecycleError}>{assignmentError}</div>
                  )}
                  <div className={styles.usageHistoryHeading}>
                    <div>
                      <strong>眼别使用记录</strong>
                      <span>{selectedEyeAssignmentIntervals.length} 段</span>
                    </div>
                  </div>
                  <div className={styles.usageFactsList}>
                    {selectedEyeAssignmentIntervals.map((interval, index) => {
                      const intervalEnd = interval.endDate ?? todayLocalDate();
                      const days = Math.max(
                        0,
                        daysBetween(interval.startDate, intervalEnd) + (interval.endDate ? 0 : 1)
                      );
                      return (
                        <article
                          className={styles.usageFactRecord}
                          key={`${interval.startDate}-${index}`}
                        >
                          <div>
                            <strong>
                              {interval.eyeSides.length
                                ? interval.eyeSides
                                    .map((side) => (side === "L" ? "左眼" : "右眼"))
                                    .join("、")
                                : "未设置眼别"}
                            </strong>
                            <span>
                              {displayLocalDate(interval.startDate)}－
                              {interval.endDate
                                ? displayLocalDate(addLocalDays(interval.endDate, -1))
                                : "使用中"}{" "}
                              · {days} 天
                            </span>
                          </div>
                          <div className={styles.usageFactActions}>
                            <button
                              onClick={() => {
                                setEditingEyeIntervalIndex(index);
                                setAssignmentError(null);
                              }}
                              type="button"
                            >
                              编辑
                            </button>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                </section>
              )}
              {selectedProfile?.managementTemplate === "soft_reusable" && (
                <section className={styles.usageFactsSection}>
                  {usageError && !editingUsageFactId && (
                    <div className={styles.lifecycleError}>{usageError}</div>
                  )}
                  {reusableCycleError && (
                    <div className={styles.lifecycleError}>{reusableCycleError}</div>
                  )}
                  <div className={styles.usageHistoryHeading}>
                    <div>
                      <strong>使用与损耗记录</strong>
                      <span>{selectedReusableRecords.length} 条</span>
                    </div>
                  </div>
                  <div
                    className={`${styles.usageFactsList} ${
                      showAllUsageFacts ? styles.usageFactsListExpanded : ""
                    }`}
                  >
                    {visibleReusableRecords.map((record) =>
                      record.type === "cycle" ? (
                        <article
                          className={styles.usageFactRecord}
                          key={`cycle-${record.cycle.id}`}
                        >
                          <div>
                            <strong>镜片使用 · {record.cycle.label}</strong>
                            <span>
                              {displayLocalDate(record.cycle.startDate)}－
                              {record.cycle.endDate
                                ? displayLocalDate(addLocalDays(record.cycle.endDate, -1))
                                : "使用中"}
                              {record.cycle.status === "active"
                                ? ` · 预计 ${displayLocalDate(record.cycle.predictionDate)} 更换`
                                : " · 已结束"}
                            </span>
                          </div>
                          <div className={styles.usageFactActions}>
                            <button
                              onClick={() => {
                                setEditingReusableCycleId(record.cycle.id);
                                setReusableCycleError(null);
                              }}
                              type="button"
                            >
                              编辑
                            </button>
                            {record.cycle.status === "completed" &&
                              record.cycle.id === selectedReusableCycles.at(-1)?.id && (
                                <button
                                  onClick={() => undoReusableCycleEnd(record.cycle.id)}
                                  type="button"
                                >
                                  撤销结束
                                </button>
                              )}
                            <button
                              onClick={() => {
                                if (
                                  globalThis.confirm(
                                    `确定删除“${record.cycle.label}”的使用记录吗？库存将归还 1 ${selectedBaseUnit}。`
                                  )
                                ) {
                                  deleteReusableCycle(record.cycle.id);
                                }
                              }}
                              type="button"
                            >
                              删除
                            </button>
                          </div>
                        </article>
                      ) : (
                        <article className={styles.usageFactRecord} key={`loss-${record.fact.id}`}>
                          <div>
                            <strong>额外损耗 · {record.fact.reason ?? "未填写原因"}</strong>
                            <span>
                              {displayLocalDate(record.fact.date)} · {record.fact.quantity}{" "}
                              {selectedBaseUnit}
                            </span>
                          </div>
                          <div className={styles.usageFactActions}>
                            <button
                              onClick={() => {
                                setEditingUsageFactId(record.fact.id);
                                setUsageError(null);
                              }}
                              type="button"
                            >
                              编辑
                            </button>
                            <button onClick={() => undoUsageFact(record.fact.id)} type="button">
                              撤销
                            </button>
                          </div>
                        </article>
                      )
                    )}
                  </div>
                  {selectedReusableRecords.length > 3 && (
                    <button
                      className={styles.usageFactsToggle}
                      onClick={() => setShowAllUsageFacts((current) => !current)}
                      type="button"
                    >
                      {showAllUsageFacts
                        ? "收起使用与损耗记录"
                        : `查看全部 ${selectedReusableRecords.length} 条`}
                    </button>
                  )}
                </section>
              )}
              {selectedUsageFacts.length > 0 &&
                selectedProfile?.managementTemplate !== "soft_reusable" && (
                  <section className={styles.usageFactsSection}>
                    {usageError && !editingUsageFactId && (
                      <div className={styles.lifecycleError}>{usageError}</div>
                    )}
                    <div className={styles.usageHistoryHeading}>
                      <div>
                        <strong>使用与损耗记录</strong>
                        <span>{selectedUsageFacts.length} 条</span>
                      </div>
                    </div>
                    <div
                      className={`${styles.usageFactsList} ${
                        showAllUsageFacts ? styles.usageFactsListExpanded : ""
                      }`}
                    >
                      {visibleUsageFacts.map((fact) => (
                        <article className={styles.usageFactRecord} key={fact.id}>
                          <div>
                            <strong>
                              {fact.kind === "wear"
                                ? "正常佩戴"
                                : fact.kind === "dose"
                                  ? "使用一对"
                                  : (fact.reason ?? "额外消耗")}
                            </strong>
                            <span>
                              {displayLocalDate(fact.date)} · {fact.quantity} {selectedBaseUnit}
                            </span>
                          </div>
                          <div className={styles.usageFactActions}>
                            <button
                              onClick={() => {
                                setEditingUsageFactId(fact.id);
                                setUsageError(null);
                              }}
                              type="button"
                            >
                              编辑
                            </button>
                            <button onClick={() => undoUsageFact(fact.id)} type="button">
                              撤销
                            </button>
                          </div>
                        </article>
                      ))}
                    </div>
                    {selectedUsageFacts.length > 3 && (
                      <button
                        className={styles.usageFactsToggle}
                        onClick={() => setShowAllUsageFacts((current) => !current)}
                        type="button"
                      >
                        {showAllUsageFacts
                          ? "收起使用与损耗记录"
                          : `查看全部 ${selectedUsageFacts.length} 条`}
                      </button>
                    )}
                  </section>
                )}
              {selectedProfile?.managementTemplate === "rigid_long_term" && (
                <section className={styles.careEventsSection}>
                  <div className={styles.careEventsHeading}>
                    <div>
                      <strong>护理事件</strong>
                      <span>{selectedCareEvents.length} 条记录</span>
                    </div>
                    <button
                      onClick={() => {
                        setCareEventDialog({ mode: "create" });
                        setCareEventError(null);
                      }}
                      type="button"
                    >
                      ＋ 添加
                    </button>
                  </div>
                  {selectedCareEvents.length === 0 ? (
                    <p className={styles.careEventsEmpty}>尚未记录复查或除蛋白事件。</p>
                  ) : (
                    <div
                      className={`${styles.careEventsList} ${
                        showAllCareEvents ? styles.careEventsListExpanded : ""
                      }`}
                    >
                      {visibleCareEvents.map((event) => {
                        const eventState = careEventState(event, todayLocalDate());
                        return (
                          <article className={styles.careEventRecord} key={event.id}>
                            <div className={styles.careEventMain}>
                              <div>
                                <strong>{careEventLabel(event)}</strong>
                                <span>{displayLocalDate(careEventDate(event))}</span>
                              </div>
                            </div>
                            <span
                              className={`${styles.careEventState} ${
                                eventState === "due"
                                  ? styles.careEventStateDue
                                  : eventState === "completed"
                                    ? styles.careEventStateCompleted
                                    : ""
                              }`}
                            >
                              {eventState === "completed"
                                ? "已完成"
                                : eventState === "due"
                                  ? "到期待确认"
                                  : "计划中"}
                            </span>
                            <div className={styles.careEventActions}>
                              {eventState !== "completed" && (
                                <button
                                  onClick={() => {
                                    setConfirmCareEventId(event.id);
                                    setCareEventError(null);
                                  }}
                                  type="button"
                                >
                                  确认完成
                                </button>
                              )}
                              <button
                                onClick={() => {
                                  setCareEventDialog({ mode: "edit", eventId: event.id });
                                  setCareEventError(null);
                                }}
                                type="button"
                              >
                                编辑
                              </button>
                              <button
                                className={styles.careEventDelete}
                                onClick={async () => {
                                  if (
                                    globalThis.confirm(`确定删除“${careEventLabel(event)}”吗？`)
                                  ) {
                                    try {
                                      await commitDataMutation(() => {
                                        deleteCareEvent(event.id);
                                      });
                                    } catch (error) {
                                      setCareEventError(
                                        error instanceof Error ? error.message : "护理事件删除失败"
                                      );
                                    }
                                  }
                                }}
                                type="button"
                              >
                                删除
                              </button>
                            </div>
                          </article>
                        );
                      })}
                    </div>
                  )}
                  {selectedCareEvents.length > 3 && (
                    <button
                      className={styles.careEventsToggle}
                      onClick={() => setShowAllCareEvents((current) => !current)}
                      type="button"
                    >
                      {showAllCareEvents
                        ? "收起护理事件"
                        : `查看全部 ${selectedCareEvents.length} 条`}
                    </button>
                  )}
                </section>
              )}
              <LifecycleHistorySection
                entries={lifecycleHistory}
                onEditPause={(pauseIndex) => {
                  setEditingPauseIndex(pauseIndex);
                  setLifecycleError(null);
                }}
                onDeletePause={(pauseIndex) => void handlePauseDelete(pauseIndex)}
              />
              {(selectedItem.locationIntervals?.length ?? 0) > 0 && (
                <section className={styles.usageHistory}>
                  <div className={styles.usageHistoryHeading}>
                    <div>
                      <strong>地点历史</strong>
                      <span>{selectedItem.locationIntervals?.length ?? 0} 段记录</span>
                    </div>
                  </div>
                  <div className={styles.usageHistoryList}>
                    {selectedItem.locationIntervals?.map((interval, index) => (
                      <article
                        className={styles.usageHistoryRecord}
                        key={`${interval.locationId}-${interval.startDate}-${index}`}
                      >
                        <span className={styles.usageHistoryDot} />
                        <div>
                          <strong>
                            {locations.find((location) => location.id === interval.locationId)
                              ?.name ?? "未知地点"}
                          </strong>
                          <span>
                            {displayLocalDate(interval.startDate)}
                            {interval.endDate
                              ? ` 至 ${displayLocalDate(addLocalDays(interval.endDate, -1))}`
                              : " 至今"}
                          </span>
                        </div>
                        <button
                          onClick={() => {
                            setEditingLocationIntervalIndex(index);
                            setLocationHistoryError(null);
                          }}
                          type="button"
                        >
                          编辑
                        </button>
                      </article>
                    ))}
                  </div>
                </section>
              )}
              <div className={styles.drawerActions}>
                <button onClick={() => setEditingDetails(true)} type="button">
                  编辑资料
                </button>
                {selectedProfile?.managementTemplate === "rigid_long_term" && (
                  <>
                    {selectedItem.status !== "completed" && (
                      <>
                        {selectedItem.status === "paused" ? (
                          <button onClick={() => openLifecycleAction("resume")} type="button">
                            恢复使用
                          </button>
                        ) : (
                          <button onClick={() => openLifecycleAction("pause")} type="button">
                            暂停使用
                          </button>
                        )}
                        <button onClick={() => openLifecycleAction("end")} type="button">
                          结束使用
                        </button>
                      </>
                    )}
                    {selectedItem.status === "completed" && (
                      <button onClick={() => openLifecycleAction("reopen")} type="button">
                        撤销结束
                      </button>
                    )}
                  </>
                )}
                {selectedProfile?.managementTemplate !== "rigid_long_term" &&
                  selectedItem.status !== "completed" && (
                    <>
                      {selectedProfile?.managementTemplate === "soft_daily" && (
                        <>
                          <button onClick={() => openUsageAction("wear")} type="button">
                            记录佩戴
                          </button>
                          <button onClick={() => openUsageAction("loss")} type="button">
                            额外消耗
                          </button>
                          <button onClick={() => openUsageAction("discard")} type="button">
                            提前结束／丢弃
                          </button>
                        </>
                      )}
                      {selectedProfile?.managementTemplate === "soft_reusable" && (
                        <>
                          {(selectedRemainingQuantity ?? 0) > 0 && (
                            <button onClick={() => openUsageAction("loss")} type="button">
                              盒内镜片损耗
                            </button>
                          )}
                          {selectedReusableCycles.some((cycle) => cycle.status === "active") ? (
                            <button onClick={() => openLifecycleAction("end")} type="button">
                              结束当前镜片
                            </button>
                          ) : (selectedRemainingQuantity ?? 0) > 0 ? (
                            <button onClick={() => openLifecycleAction("next")} type="button">
                              启用下一片
                            </button>
                          ) : null}
                        </>
                      )}
                      {selectedProfile?.managementTemplate === "discrete_dose" && (
                        <>
                          <button onClick={() => openUsageAction("dose")} type="button">
                            记录使用一对
                          </button>
                          <button onClick={() => openUsageAction("discard")} type="button">
                            提前结束／丢弃
                          </button>
                        </>
                      )}
                      {(selectedProfile?.managementTemplate === "opened_container" ||
                        selectedProfile?.managementTemplate === "batch_consumable") && (
                        <>
                          {selectedItem.status === "paused" ? (
                            <button onClick={() => openLifecycleAction("resume")} type="button">
                              恢复使用
                            </button>
                          ) : (
                            <button onClick={() => openLifecycleAction("pause")} type="button">
                              暂停使用
                            </button>
                          )}
                          <button onClick={() => openLifecycleAction("end")} type="button">
                            结束使用
                          </button>
                        </>
                      )}
                      {(selectedProfile?.managementTemplate === "lens_case" ||
                        selectedProfile?.managementTemplate === "lens_accessory") && (
                        <>
                          {selectedProfile.managementTemplate === "lens_case" && (
                            <button
                              onClick={() => {
                                setShowAssignmentDialog(true);
                                setAssignmentError(null);
                              }}
                              type="button"
                            >
                              切换使用眼别
                            </button>
                          )}
                          <button onClick={() => openLifecycleAction("end")} type="button">
                            更换／结束使用
                          </button>
                        </>
                      )}
                    </>
                  )}
                {selectedProfile?.managementTemplate !== "rigid_long_term" &&
                  selectedItem.status === "completed" &&
                  ((selectedProfile?.managementTemplate !== "soft_daily" &&
                    selectedProfile?.managementTemplate !== "discrete_dose") ||
                    selectedItem.endReason === "提前结束/丢弃") && (
                    <button onClick={() => openLifecycleAction("reopen")} type="button">
                      {selectedProfile?.managementTemplate === "soft_daily" ||
                      selectedProfile?.managementTemplate === "discrete_dose"
                        ? "撤销丢弃"
                        : "撤销结束"}
                    </button>
                  )}
              </div>
              {selectedProfile && (
                <button
                  className={styles.deleteInstanceButton}
                  onClick={() => {
                    setShowDeleteItemDialog(true);
                    setDeleteItemError(null);
                  }}
                  type="button"
                >
                  删除误录记录
                </button>
              )}
            </>
          )}
        </aside>
      )}

      {selectedItem && editingReusableCycle && (
        <div className={styles.modalBackdrop}>
          <form className={styles.addModal} onSubmit={handleReusableCycleEdit}>
            <div className={styles.modalHeading}>
              <div>
                <span>盒内镜片</span>
                <h2>编辑镜片信息</h2>
              </div>
              <button
                aria-label="关闭"
                onClick={() => {
                  setEditingReusableCycleId(null);
                  setReusableCycleError(null);
                }}
                type="button"
              >
                ×
              </button>
            </div>
            {reusableCycleError && (
              <div className={styles.lifecycleError}>{reusableCycleError}</div>
            )}
            <label>
              镜片名称
              <input defaultValue={editingReusableCycle.label} name="label" required />
            </label>
            <label>
              启用日期
              <LocalDateInput
                defaultValue={editingReusableCycle.startDate}
                max={todayLocalDate()}
                name="startDate"
                required
              />
            </label>
            <label>
              预计更换日期
              <LocalDateInput
                defaultValue={editingReusableCycle.predictionDate}
                name="predictionDate"
                required
              />
            </label>
            {editingReusableCycle.status === "completed" && (
              <label>
                实际结束日期
                <LocalDateInput
                  defaultValue={
                    editingReusableCycle.endDate
                      ? addLocalDays(editingReusableCycle.endDate, -1)
                      : todayLocalDate()
                  }
                  max={todayLocalDate()}
                  name="endDate"
                  required
                />
              </label>
            )}
            <div className={styles.modalActions}>
              <button
                onClick={() => {
                  setEditingReusableCycleId(null);
                  setReusableCycleError(null);
                }}
                type="button"
              >
                取消
              </button>
              <button className={styles.primaryButton} type="submit">
                保存镜片
              </button>
            </div>
          </form>
        </div>
      )}

      {selectedItem && lifecycleAction && (
        <div className={styles.modalBackdrop}>
          <form className={styles.addModal} onSubmit={handleLifecycleAction}>
            <div className={styles.modalHeading}>
              <div>
                <span>用品生命周期</span>
                <h2>
                  {lifecycleAction === "pause"
                    ? "暂停使用"
                    : lifecycleAction === "resume"
                      ? "恢复使用"
                      : lifecycleAction === "next"
                        ? "启用下一片"
                        : lifecycleAction === "end"
                          ? "结束使用"
                          : "撤销结束"}
                </h2>
              </div>
              <button
                aria-label="关闭"
                onClick={() => {
                  setLifecycleAction(null);
                  setLifecycleError(null);
                }}
                type="button"
              >
                <Icon name="close" />
              </button>
            </div>
            {lifecycleError && <div className={styles.lifecycleError}>{lifecycleError}</div>}
            {(lifecycleAction === "end" || lifecycleAction === "reopen") && (
              <div
                className={`${styles.actionImpact} ${
                  lifecycleAction === "end"
                    ? styles.actionImpactWarning
                    : styles.actionImpactRecovery
                }`}
              >
                <strong>{lifecycleAction === "end" ? "完成后将发生" : "恢复内容"}</strong>
                <ul>
                  {lifecycleAction === "end" ? (
                    <>
                      <li>
                        {selectedProfile?.managementTemplate === "soft_reusable"
                          ? "结束当前盒内镜片的使用周期；"
                          : "记录实际结束日期并把实例标记为结束使用；"}
                      </li>
                      {selectedProfile?.managementTemplate === "batch_consumable" && (
                        <li>按实际盘点数量追加损耗或盘盈更正；预计剩余只作填写参考。</li>
                      )}
                      <li>时间轴不再显示尚未到达的预计更换标记；</li>
                      <li>如为误操作，可稍后从详情中“撤销结束”。</li>
                    </>
                  ) : (
                    <>
                      <li>清除实际结束日期；</li>
                      <li>
                        恢复为结束前的“
                        {selectedItem.stateIntervals?.at(-1)?.status === "paused"
                          ? "暂停使用"
                          : "使用中"}
                        ”状态；
                      </li>
                      {(selectedProfile?.managementTemplate === "soft_daily" ||
                        selectedProfile?.managementTemplate === "discrete_dose") &&
                        selectedItem.endReason === "提前结束/丢弃" && (
                          <li>同步撤销本次丢弃产生的库存损耗。</li>
                        )}
                      {selectedProfile?.managementTemplate === "batch_consumable" && (
                        <li>结束时确认的实际盘点及其库存更正会保留。</li>
                      )}
                    </>
                  )}
                </ul>
              </div>
            )}
            {lifecycleAction === "reopen" ? (
              <p className={styles.lifecycleNotice}>原有暂停记录和预计结束日期都会保留。</p>
            ) : (
              <label>
                {lifecycleAction === "pause"
                  ? "暂停日期"
                  : lifecycleAction === "resume"
                    ? "恢复日期"
                    : lifecycleAction === "next"
                      ? "下一片启用日期"
                      : "实际结束日期"}
                <LocalDateInput
                  defaultValue={todayLocalDate()}
                  max={todayLocalDate()}
                  min={
                    lifecycleAction === "resume"
                      ? selectedItem.stateIntervals?.at(-1)?.startDate
                      : lifecycleAction === "next"
                        ? selectedReusableCycles.at(-1)?.endDate
                          ? reusableCycleActualEndDate(selectedReusableCycles.at(-1)!.endDate!)
                          : selectedItem.startDate
                        : selectedItem.startDate
                  }
                  name="date"
                  required
                />
              </label>
            )}
            {lifecycleAction === "end" &&
              selectedProfile?.managementTemplate === "batch_consumable" && (
                <label>
                  实际剩余数量（{selectedBaseUnit}）
                  <input min="0" name="actualRemainingQuantity" required step="1" type="number" />
                  <small>
                    预计剩余 {Math.round(Math.max(0, selectedPredictedQuantity ?? 0))}{" "}
                    {selectedBaseUnit}；账面库存 {selectedLocationAvailableUnits} {selectedBaseUnit}
                    。请按实际盘点填写。
                  </small>
                </label>
              )}
            <div className={styles.modalActions}>
              <button
                onClick={() => {
                  setLifecycleAction(null);
                  setLifecycleError(null);
                }}
                type="button"
              >
                取消
              </button>
              <button
                className={
                  lifecycleAction === "end" ? styles.warningActionButton : styles.primaryButton
                }
                disabled={actionSubmitting}
                type="submit"
              >
                {actionSubmitting
                  ? "处理中…"
                  : lifecycleAction === "reopen"
                    ? "确认恢复"
                    : lifecycleAction === "end"
                      ? "确认结束使用"
                      : "确认"}
              </button>
            </div>
          </form>
        </div>
      )}

      {selectedItem && usageAction && (
        <div className={styles.modalBackdrop}>
          <form className={styles.addModal} onSubmit={handleUsageAction}>
            <div className={styles.modalHeading}>
              <div>
                <span>使用记录</span>
                <h2>
                  {usageAction === "wear"
                    ? "记录当天佩戴"
                    : usageAction === "dose"
                      ? "记录使用一对"
                      : usageAction === "discard"
                        ? "提前结束并丢弃"
                        : "记录额外消耗"}
                </h2>
              </div>
              <button
                aria-label="关闭"
                onClick={() => {
                  setUsageAction(null);
                  setUsageError(null);
                }}
                type="button"
              >
                <Icon name="close" />
              </button>
            </div>
            {usageError && <div className={styles.lifecycleError}>{usageError}</div>}
            <label>
              日期
              <LocalDateInput
                defaultValue={usageDefaultDate}
                max={todayLocalDate()}
                min={selectedItem.startDate}
                name="date"
                required
              />
            </label>
            {usageAction === "loss" && (
              <label>
                额外消耗数量
                <input defaultValue="1" min="1" name="quantity" required type="number" />
              </label>
            )}
            {(usageAction === "loss" || usageAction === "discard") && (
              <label>
                原因（选填）
                <input
                  name="reason"
                  placeholder={
                    usageAction === "discard" ? "例如：提前丢弃" : "例如：破损、掉落、同日第二片"
                  }
                />
              </label>
            )}
            {usageAction === "discard" && (
              <div className={`${styles.actionImpact} ${styles.actionImpactDanger}`}>
                <strong>完成后将发生</strong>
                <ul>
                  <li>
                    {selectedProfile?.managementTemplate === "discrete_dose"
                      ? `该批次剩余 ${selectedSourceAvailableUnits} ${selectedBaseUnit}将记为库存损耗；`
                      : `该盒剩余 ${selectedRemainingQuantity ?? 0} ${selectedBaseUnit}将记为库存损耗；`}
                  </li>
                  <li>实例将于所选日期结束，使用日块变为结束使用配色；</li>
                  <li>如为误操作，可稍后从详情中“撤销丢弃”。</li>
                </ul>
              </div>
            )}
            <div className={styles.modalActions}>
              <button
                onClick={() => {
                  setUsageAction(null);
                  setUsageError(null);
                }}
                type="button"
              >
                取消
              </button>
              <button
                className={
                  usageAction === "discard" ? styles.confirmDeleteButton : styles.primaryButton
                }
                disabled={actionSubmitting}
                type="submit"
              >
                {actionSubmitting
                  ? "处理中…"
                  : usageAction === "discard"
                    ? "确认结束并记为损耗"
                    : "确认记录"}
              </button>
            </div>
          </form>
        </div>
      )}

      {selectedItem && editingUsageFact && (
        <div className={styles.modalBackdrop}>
          <form className={styles.addModal} onSubmit={handleUsageFactEdit}>
            <div className={styles.modalHeading}>
              <div>
                <span>使用记录</span>
                <h2>编辑记录</h2>
              </div>
              <button
                aria-label="关闭"
                onClick={() => {
                  setEditingUsageFactId(null);
                  setUsageError(null);
                }}
                type="button"
              >
                <Icon name="close" />
              </button>
            </div>
            {usageError && <div className={styles.lifecycleError}>{usageError}</div>}
            <label>
              日期
              <LocalDateInput
                defaultValue={editingUsageFact.date}
                max={todayLocalDate()}
                min={selectedItem.startDate}
                name="date"
                required
              />
            </label>
            {editingUsageFact.kind === "extra_loss" && (
              <>
                <label>
                  数量
                  <input
                    defaultValue={editingUsageFact.quantity}
                    min="1"
                    name="quantity"
                    required
                    type="number"
                  />
                </label>
                <label>
                  原因
                  <input defaultValue={editingUsageFact.reason} name="reason" />
                </label>
              </>
            )}
            <div className={styles.modalActions}>
              <button onClick={() => setEditingUsageFactId(null)} type="button">
                取消
              </button>
              <button className={styles.primaryButton} type="submit">
                保存
              </button>
            </div>
          </form>
        </div>
      )}

      {selectedItem && editingEyeInterval && (
        <div className={styles.modalBackdrop}>
          <form className={styles.addModal} onSubmit={handleEyeIntervalEdit}>
            <div className={styles.modalHeading}>
              <div>
                <span>镜盒眼别</span>
                <h2>编辑眼别使用记录</h2>
              </div>
              <button
                aria-label="关闭"
                onClick={() => {
                  setEditingEyeIntervalIndex(null);
                  setAssignmentError(null);
                }}
                type="button"
              >
                <Icon name="close" />
              </button>
            </div>
            {assignmentError && <div className={styles.lifecycleError}>{assignmentError}</div>}
            <label>
              开始日期
              <LocalDateInput
                defaultValue={editingEyeInterval.startDate}
                max={todayLocalDate()}
                name="startDate"
                required
              />
            </label>
            <label>
              结束日期
              <LocalDateInput
                defaultValue={
                  editingEyeInterval.endDate ? addLocalDays(editingEyeInterval.endDate, -1) : ""
                }
                max={todayLocalDate()}
                name="endDate"
              />
              <small>
                {editingEyeIntervalIndex === selectedEyeAssignmentIntervals.length - 1 &&
                selectedItem.status !== "completed"
                  ? "当前使用阶段保持为空；需要切换时使用“切换使用眼别”。"
                  : "历史记录必须填写结束日期。"}
              </small>
            </label>
            <fieldset className={styles.profileLinkOptions}>
              <legend>使用眼别</legend>
              {(["L", "R"] as const).map((side) => (
                <label key={side}>
                  {side === "L" ? "左眼" : "右眼"}
                  <input
                    defaultChecked={editingEyeInterval.eyeSides.includes(side)}
                    name="eyeSides"
                    type="checkbox"
                    value={side}
                  />
                </label>
              ))}
            </fieldset>
            <div className={styles.modalActions}>
              <button
                onClick={() => {
                  setEditingEyeIntervalIndex(null);
                  setAssignmentError(null);
                }}
                type="button"
              >
                取消
              </button>
              <button className={styles.primaryButton} type="submit">
                保存记录
              </button>
            </div>
          </form>
        </div>
      )}

      {selectedItem && showAssignmentDialog && (
        <div className={styles.modalBackdrop}>
          <form className={styles.addModal} onSubmit={handleAssignmentChange}>
            <div className={styles.modalHeading}>
              <div>
                <span>镜盒眼别</span>
                <h2>切换使用眼别</h2>
              </div>
              <button
                aria-label="关闭"
                onClick={() => setShowAssignmentDialog(false)}
                type="button"
              >
                <Icon name="close" />
              </button>
            </div>
            {assignmentError && <div className={styles.lifecycleError}>{assignmentError}</div>}
            <label>
              切换日期
              <LocalDateInput
                defaultValue={todayLocalDate()}
                max={todayLocalDate()}
                min={selectedEyeAssignmentIntervals.at(-1)?.startDate ?? selectedItem.startDate}
                name="date"
                required
              />
            </label>
            <fieldset className={styles.profileLinkOptions}>
              <legend>切换后的使用眼别</legend>
              {(["L", "R"] as const).map((side) => (
                <label key={side}>
                  {side === "L" ? "左眼" : "右眼"}
                  <input
                    defaultChecked={selectedEyeSides.includes(side)}
                    name="eyeSides"
                    type="checkbox"
                    value={side}
                  />
                </label>
              ))}
            </fieldset>
            <p className={styles.lifecycleNotice}>
              原眼别阶段截止到切换日，新眼别从切换日开始累计使用天数；选择双眼会同时累计左右眼。
            </p>
            <div className={styles.modalActions}>
              <button onClick={() => setShowAssignmentDialog(false)} type="button">
                取消
              </button>
              <button className={styles.primaryButton} type="submit">
                保存切换
              </button>
            </div>
          </form>
        </div>
      )}

      {selectedItem && showDeleteItemDialog && (
        <div className={styles.modalBackdrop}>
          <div className={styles.addModal} role="dialog" aria-modal="true">
            <div className={styles.modalHeading}>
              <div>
                <span>误录处理</span>
                <h2>删除“{selectedItem.label}”？</h2>
              </div>
              <button
                aria-label="关闭"
                onClick={() => {
                  setShowDeleteItemDialog(false);
                  setDeleteItemError(null);
                }}
                type="button"
              >
                <Icon name="close" />
              </button>
            </div>
            {deleteItemError && <div className={styles.lifecycleError}>{deleteItemError}</div>}
            <div className={styles.deleteInstanceSummary}>
              <strong>删除后将同时处理：</strong>
              <ul>
                {selectedHasActivation && <li>撤销原始启用或库存分配流水，恢复对应库存形态；</li>}
                {selectedUsageFacts.length > 0 && (
                  <li>撤销 {selectedUsageFacts.length} 条使用或损耗库存流水；</li>
                )}
                <li>删除该实例的暂停、恢复和结束历史；</li>
                <li>删除关联的 {selectedCareEvents.length} 条护理事件。</li>
              </ul>
              <p>此操作用于纠正误录，完成后不能在页面内撤销。</p>
            </div>
            <div className={styles.modalActions}>
              <button
                onClick={() => {
                  setShowDeleteItemDialog(false);
                  setDeleteItemError(null);
                }}
                type="button"
              >
                取消
              </button>
              <button
                className={styles.confirmDeleteButton}
                disabled={actionSubmitting}
                onClick={handleDeleteSelectedItem}
                type="button"
              >
                {actionSubmitting ? "删除中…" : "确认删除记录"}
              </button>
            </div>
          </div>
        </div>
      )}

      {selectedItem && careEventDialog && (
        <div className={styles.modalBackdrop}>
          <form
            className={styles.addModal}
            key={editingCareEvent?.id ?? "new-care-event"}
            onSubmit={handleCareEventSave}
          >
            <div className={styles.modalHeading}>
              <div>
                <span>硬镜护理</span>
                <h2>{editingCareEvent ? "编辑护理事件" : "添加护理事件"}</h2>
              </div>
              <button
                aria-label="关闭"
                onClick={() => {
                  setCareEventDialog(null);
                  setCareEventError(null);
                }}
                type="button"
              >
                <Icon name="close" />
              </button>
            </div>
            {careEventError && <div className={styles.lifecycleError}>{careEventError}</div>}
            <label>
              事件类型
              <select defaultValue={editingCareEvent?.kind ?? "review"} name="kind">
                <option value="review">复查</option>
                <option value="protein">除蛋白</option>
              </select>
            </label>
            <label>
              记录状态
              <select
                defaultValue={editingCareEvent?.completedDate ? "completed" : "planned"}
                name="recordType"
              >
                <option value="planned">计划、等待确认</option>
                <option value="completed">已经完成</option>
              </select>
            </label>
            <label>
              事件日期
              <LocalDateInput
                defaultValue={editingCareEvent ? careEventDate(editingCareEvent) : todayLocalDate()}
                min={selectedItem.startDate}
                name="date"
                required
              />
            </label>
            <div className={styles.modalActions}>
              <button
                onClick={() => {
                  setCareEventDialog(null);
                  setCareEventError(null);
                }}
                type="button"
              >
                取消
              </button>
              <button className={styles.primaryButton} type="submit">
                保存
              </button>
            </div>
          </form>
        </div>
      )}

      {selectedItem && confirmingCareEvent && (
        <div className={styles.modalBackdrop}>
          <form className={styles.addModal} onSubmit={handleCareEventConfirm}>
            <div className={styles.modalHeading}>
              <div>
                <span>计划确认</span>
                <h2>确认已完成{confirmingCareEvent.kind === "review" ? "复查" : "除蛋白"}</h2>
              </div>
              <button
                aria-label="关闭"
                onClick={() => {
                  setConfirmCareEventId(null);
                  setCareEventError(null);
                }}
                type="button"
              >
                <Icon name="close" />
              </button>
            </div>
            {careEventError && <div className={styles.lifecycleError}>{careEventError}</div>}
            <p className={styles.lifecycleNotice}>
              原计划日期：{displayLocalDate(confirmingCareEvent.plannedDate)}。确认后保留计划日期，
              并将实际完成日期显示在时间轴上。
            </p>
            <label>
              实际完成日期
              <LocalDateInput
                defaultValue={todayLocalDate()}
                max={todayLocalDate()}
                min={selectedItem.startDate}
                name="completedDate"
                required
              />
            </label>
            <div className={styles.modalActions}>
              <button
                onClick={() => {
                  setConfirmCareEventId(null);
                  setCareEventError(null);
                }}
                type="button"
              >
                取消
              </button>
              <button className={styles.primaryButton} type="submit">
                确认完成
              </button>
            </div>
          </form>
        </div>
      )}

      {selectedItem &&
        editingLocationIntervalIndex !== null &&
        selectedItem.locationIntervals?.[editingLocationIntervalIndex] && (
          <div className={styles.modalBackdrop}>
            <form className={styles.addModal} onSubmit={handleLocationHistoryEdit}>
              <div className={styles.modalHeading}>
                <div>
                  <span>地点历史</span>
                  <h2>编辑地点记录</h2>
                </div>
                <button
                  aria-label="关闭"
                  onClick={() => {
                    setEditingLocationIntervalIndex(null);
                    setLocationHistoryError(null);
                  }}
                  type="button"
                >
                  <Icon name="close" />
                </button>
              </div>
              {locationHistoryError && (
                <div className={styles.lifecycleError}>{locationHistoryError}</div>
              )}
              <label>
                地点
                <select
                  defaultValue={
                    selectedItem.locationIntervals[editingLocationIntervalIndex].locationId
                  }
                  name="locationId"
                  required
                >
                  {[...locations]
                    .sort((left, right) => left.order - right.order)
                    .map((location) => (
                      <option key={location.id} value={location.id}>
                        {location.name}
                        {location.active ? "" : "（已停用）"}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                本段开始日期
                <LocalDateInput
                  defaultValue={
                    selectedItem.locationIntervals[editingLocationIntervalIndex].startDate
                  }
                  max={
                    selectedItem.locationIntervals[editingLocationIntervalIndex].endDate
                      ? addLocalDays(
                          selectedItem.locationIntervals[editingLocationIntervalIndex].endDate!,
                          -1
                        )
                      : todayLocalDate()
                  }
                  min={
                    editingLocationIntervalIndex > 0
                      ? addLocalDays(
                          selectedItem.locationIntervals[editingLocationIntervalIndex - 1]!
                            .startDate,
                          1
                        )
                      : selectedItem.startDate
                  }
                  name="startDate"
                  readOnly={editingLocationIntervalIndex === 0}
                  required
                />
                {editingLocationIntervalIndex === 0 && (
                  <small>首段开始日期与实例启用日期一致，请在“编辑资料”中修改。</small>
                )}
              </label>
              <div className={styles.modalActions}>
                <button
                  onClick={() => {
                    setEditingLocationIntervalIndex(null);
                    setLocationHistoryError(null);
                  }}
                  type="button"
                >
                  取消
                </button>
                <button className={styles.primaryButton} type="submit">
                  保存
                </button>
              </div>
            </form>
          </div>
        )}

      {selectedItem &&
        editingPauseIndex !== null &&
        selectedItem.stateIntervals?.[editingPauseIndex]?.status === "paused" && (
          <div className={styles.modalBackdrop}>
            <form className={styles.addModal} onSubmit={handlePauseEdit}>
              <div className={styles.modalHeading}>
                <div>
                  <span>用品生命周期</span>
                  <h2>编辑暂停记录</h2>
                </div>
                <button
                  aria-label="关闭"
                  onClick={() => {
                    setEditingPauseIndex(null);
                    setLifecycleError(null);
                  }}
                  type="button"
                >
                  <Icon name="close" />
                </button>
              </div>
              {lifecycleError && <div className={styles.lifecycleError}>{lifecycleError}</div>}
              <label>
                暂停日期
                <LocalDateInput
                  defaultValue={selectedItem.stateIntervals[editingPauseIndex].startDate}
                  max={todayLocalDate()}
                  min={selectedItem.startDate}
                  name="startDate"
                  required
                />
              </label>
              <label>
                {selectedItem.status === "completed" &&
                editingPauseIndex === selectedItem.stateIntervals.length - 1
                  ? "实际结束日期"
                  : "恢复日期"}
                <LocalDateInput
                  defaultValue={
                    selectedItem.status === "completed" &&
                    editingPauseIndex === selectedItem.stateIntervals.length - 1 &&
                    selectedItem.stateIntervals[editingPauseIndex].endDate
                      ? addLocalDays(selectedItem.stateIntervals[editingPauseIndex].endDate, -1)
                      : (selectedItem.stateIntervals[editingPauseIndex].endDate ?? "")
                  }
                  max={todayLocalDate()}
                  name="endDate"
                  required={
                    !(
                      selectedItem.status === "paused" &&
                      editingPauseIndex === selectedItem.stateIntervals.length - 1
                    )
                  }
                />
                {selectedItem.status === "paused" &&
                  editingPauseIndex === selectedItem.stateIntervals.length - 1 && (
                    <small>当前仍在暂停时可留空。</small>
                  )}
              </label>
              <div className={styles.modalActions}>
                <button
                  onClick={() => {
                    setEditingPauseIndex(null);
                    setLifecycleError(null);
                  }}
                  type="button"
                >
                  取消
                </button>
                <button className={styles.primaryButton} type="submit">
                  保存
                </button>
              </div>
            </form>
          </div>
        )}

      {pendingMove && (
        <div className={styles.modalBackdrop}>
          <div className={styles.modal} role="dialog" aria-modal="true">
            <span className={styles.modalIcon}>
              <Icon name="calendar" />
            </span>
            <h2>确认修改日期？</h2>
            <p>
              将“{items.find((item) => item.id === pendingMove.itemId)?.label}”整体
              {pendingMove.days > 0 ? "向后" : "向前"}移动 {Math.abs(pendingMove.days)} 天。
            </p>
            {detailError && <div className={styles.detailError}>{detailError}</div>}
            <div className={styles.modalActions}>
              <button
                onClick={() => {
                  setPendingMove(null);
                  setDetailError(null);
                }}
                type="button"
              >
                取消
              </button>
              <button className={styles.primaryButton} onClick={confirmMove} type="button">
                确认修改
              </button>
            </div>
          </div>
        </div>
      )}

      {showAddDialog && (
        <div className={styles.modalBackdrop}>
          <form className={styles.addModal} onSubmit={handleAdd}>
            <div className={styles.modalHeading}>
              <div>
                <span>新建记录</span>
                <h2>向“{addProfile?.name}”添加记录</h2>
              </div>
              <button aria-label="关闭" onClick={() => setShowAddDialog(false)} type="button">
                <Icon name="close" />
              </button>
            </div>
            {addNotice && <div className={styles.addError}>{addNotice}</div>}
            {!addTemplateSupported ? (
              <div className={styles.addEmptyState}>
                <strong>该用品的记录方式尚未接入</strong>
                <p>当前阶段先完成长期硬镜、镜盒和镜片用品的启用流程。</p>
                <button onClick={() => setShowAddDialog(false)} type="button">
                  关闭
                </button>
              </div>
            ) : addProducts.length === 0 ? (
              <div className={styles.addEmptyState}>
                <strong>暂无关联产品</strong>
                <p>请先在库存页面为“{addProfile?.name}”新建产品。</p>
                <button
                  className={styles.primaryButton}
                  onClick={() => {
                    setShowAddDialog(false);
                    onNavigateToInventory?.();
                  }}
                  type="button"
                >
                  前往库存
                </button>
              </div>
            ) : (
              <>
                <label>
                  具体产品
                  <select
                    onChange={(event) => selectAddProduct(event.target.value)}
                    value={selectedAddProduct?.id ?? ""}
                  >
                    {addProducts.map((product) => (
                      <option key={product.id} value={product.id}>
                        {product.brand}
                        {product.model ? ` · ${product.model}` : ""}
                      </option>
                    ))}
                  </select>
                </label>
                {addLots.length === 0 ? (
                  <div className={styles.addEmptyState}>
                    <strong>该产品暂无可用库存</strong>
                    <p>请先录入库存批次，再从这一行添加记录。</p>
                    <button
                      className={styles.primaryButton}
                      onClick={() => {
                        setShowAddDialog(false);
                        onNavigateToInventory?.();
                      }}
                      type="button"
                    >
                      前往入库
                    </button>
                  </div>
                ) : (
                  <>
                    <label>
                      来源批次
                      <select
                        name="stockLotId"
                        onChange={(event) => selectAddLot(event.target.value)}
                        value={selectedAddLot?.id ?? ""}
                      >
                        {addLots.map((lot) => (
                          <option key={lot.id} value={lot.id}>
                            {lot.internalLotCode} ·{" "}
                            {(["soft_daily", "soft_reusable"] as const).includes(
                              addProfile?.managementTemplate as "soft_daily" | "soft_reusable"
                            ) && selectedAddProduct
                              ? `未开封 ${unopenedPackageCount(
                                  lot,
                                  selectedAddProduct,
                                  transactions,
                                  items
                                )} 盒 · 散片 ${
                                  addProfile?.managementTemplate === "soft_reusable"
                                    ? availableReusableLooseUnitQuantity(
                                        lot,
                                        selectedAddProduct,
                                        transactions,
                                        items
                                      )
                                    : availableLooseUnitQuantity(
                                        lot,
                                        selectedAddProduct,
                                        transactions,
                                        items
                                      )
                                } ${addBaseUnit} · 共剩 ${availableUnits(
                                  lot.id,
                                  transactions
                                )} ${addBaseUnit}`
                              : `${availableUnits(lot.id, transactions)} ${
                                  selectedAddProduct?.baseUnit ?? ""
                                }`}
                            {addProfile?.managementTemplate === "rigid_long_term"
                              ? ` · 预计使用 ${
                                  lot.expectedUsageDays ??
                                  selectedAddProduct?.defaultDurationDays ??
                                  addProfile.defaultDurationDays ??
                                  90
                                } 天`
                              : lot.expiryDate
                                ? ` · 预计 ${displayLocalDate(lot.expiryDate)} 到期`
                                : ""}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      实例名称
                      <input
                        defaultValue={`${selectedAddProduct?.brand ?? ""}${selectedAddProduct?.model ? ` · ${selectedAddProduct.model}` : ""}`}
                        key={`name-${selectedAddProduct?.id}`}
                        name="name"
                        required
                      />
                    </label>
                    <label>
                      当前地点
                      <select name="locationId" required>
                        {addSourceLocations
                          .sort((a, b) => a.order - b.order)
                          .map((location) => (
                            <option key={location.id} value={location.id}>
                              {location.name}（该批次{" "}
                              {availableUnitsAtLocation(selectedAddLot!, location.id, transactions)}{" "}
                              {selectedAddProduct?.baseUnit ?? ""}）
                            </option>
                          ))}
                      </select>
                    </label>
                    <label>
                      启用日期
                      <LocalDateInput
                        onChange={(event) => changeAddStartDate(event.target.value as LocalDate)}
                        name="startDate"
                        required
                        value={addStartDate}
                      />
                    </label>
                    {(["soft_daily", "soft_reusable"] as const).includes(
                      addProfile?.managementTemplate as "soft_daily" | "soft_reusable"
                    ) && (
                      <>
                        <label>
                          库存来源
                          <select
                            onChange={(event) =>
                              setAddDailySource(event.target.value as "package" | "loose")
                            }
                            value={addDailySource}
                          >
                            <option disabled={selectedPackagedUnopenedPackages < 1} value="package">
                              完整盒（剩余 {selectedPackagedUnopenedPackages} 盒）
                            </option>
                            <option disabled={selectedPackagedLooseUnits < 1} value="loose">
                              散片（可用 {selectedPackagedLooseUnits} {addBaseUnit}）
                            </option>
                          </select>
                        </label>
                        {addProfile?.managementTemplate === "soft_daily" ? (
                          <label>
                            {addDailySource === "package" ? "本盒片数" : "本次分配散片数"}
                            <input
                              key={`${selectedAddLot?.id}-${addDailySource}`}
                              defaultValue={
                                addDailySource === "package"
                                  ? selectedAddLot && selectedAddProduct
                                    ? lotUnitsPerPackage(selectedAddLot, selectedAddProduct)
                                    : 30
                                  : selectedPackagedLooseUnits
                              }
                              max={
                                addDailySource === "loose" ? selectedPackagedLooseUnits : undefined
                              }
                              min="1"
                              name="initialUnitQuantity"
                              readOnly={addDailySource === "package"}
                              required
                              type="number"
                            />
                            <small>
                              {addDailySource === "package"
                                ? "开盒后该盒剩余片数只属于这一条时间轴记录"
                                : "只分配入库时登记的散片，不会占用已开封盒的剩余片数"}
                            </small>
                          </label>
                        ) : (
                          <small>
                            {addDailySource === "package"
                              ? `开盒并启用 1 ${addBaseUnit}；其余 ${Math.max(
                                  0,
                                  (selectedAddLot && selectedAddProduct
                                    ? lotUnitsPerPackage(selectedAddLot, selectedAddProduct)
                                    : 1) - 1
                                )} ${addBaseUnit}转为可用散片。`
                              : `从可用散片中启用 1 ${addBaseUnit}。`}
                          </small>
                        )}
                      </>
                    )}
                    {addProfile?.managementTemplate === "batch_consumable" && (
                      <label>
                        预计每日使用量（{addBaseUnit}/天）
                        <input
                          defaultValue="1"
                          min="0.01"
                          name="usageRatePerDay"
                          required
                          step="0.01"
                          type="number"
                        />
                      </label>
                    )}
                    {addProfile?.managementTemplate === "lens_case" && (
                      <fieldset className={styles.profileLinkOptions}>
                        <legend>启用眼别</legend>
                        {(["L", "R"] as const).map((side) => (
                          <label key={side}>
                            {side === "L" ? "左眼" : "右眼"}
                            <input name="eyeSides" type="checkbox" value={side} />
                          </label>
                        ))}
                      </fieldset>
                    )}
                    {addNeedsExpectedEnd && (
                      <label>
                        {addProfile?.managementTemplate === "opened_container"
                          ? "开封后最晚使用日期"
                          : addProfile?.managementTemplate === "lens_case"
                            ? "预计切换／更换眼别日期"
                            : "预计更换日期"}
                        <LocalDateInput
                          onChange={(event) =>
                            setAddExpectedEndDate(event.target.value as LocalDate)
                          }
                          name="expectedEndDate"
                          readOnly={addProfile?.managementTemplate === "lens_case"}
                          required
                          value={addExpectedEndDate}
                        />
                      </label>
                    )}
                    {addProfile?.managementTemplate === "opened_container" && (
                      <label>
                        预计更换日期
                        <LocalDateInput
                          name="depletionPredictionDate"
                          readOnly
                          required
                          value={addDepletionDate}
                        />
                        <small>
                          {selectedAddConsumptionRate && selectedAddProduct?.capacityMl
                            ? `按 ${selectedAddProduct.capacityMl} mL 和平均 ${selectedAddConsumptionRate.toFixed(2)} mL／天自动估计`
                            : "暂无可用历史，暂按产品默认周期估计"}
                        </small>
                      </label>
                    )}
                    <div className={styles.modalActions}>
                      <button onClick={() => setShowAddDialog(false)} type="button">
                        取消
                      </button>
                      <button className={styles.primaryButton} type="submit">
                        启用并添加到时间轴
                      </button>
                    </div>
                  </>
                )}
              </>
            )}
          </form>
        </div>
      )}

      {showManageItems && <ManageItemsDialog onClose={() => setShowManageItems(false)} />}

      {undoMove && (
        <div className={styles.toast}>
          日期已修改
          {detailError && <span>{detailError}</span>}
          <button onClick={undoLastMove} type="button">
            <Icon name="undo" size={16} />
            撤销
          </button>
        </div>
      )}
      {addNotice && !showAddDialog && (
        <div className={styles.toast}>
          {addNotice}
          <button onClick={() => setAddNotice(null)} type="button">
            关闭
          </button>
        </div>
      )}
      {actionNotice && (
        <div className={styles.toast} role="status">
          {actionNotice}
          <button onClick={() => setActionNotice(null)} type="button">
            关闭
          </button>
        </div>
      )}
    </section>
  );
}
