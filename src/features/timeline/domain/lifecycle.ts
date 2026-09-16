import { addLocalDays, daysBetween, type LocalDate } from "../../../shared/dates/localDate";
import type { TimelineItem } from "../timeline.types";
import type { ManagementTemplate } from "../../catalog/catalog.types";

type StateInterval = NonNullable<TimelineItem["stateIntervals"]>[number];

type DatedInterval = {
  startDate: LocalDate;
  endDate: LocalDate | null;
};

function closeAuxiliaryIntervals<T extends DatedInterval>(
  source: T[] | undefined,
  boundary: LocalDate,
  label: string
) {
  if (!source) return undefined;
  const intervals = source.map((interval) => ({ ...interval }));
  const current = intervals.at(-1);
  if (!current || current.endDate !== null || boundary <= current.startDate) {
    throw new Error(`${label}末尾区间与结束日期冲突`);
  }
  current.endDate = boundary;
  return intervals;
}

function reopenAuxiliaryIntervals<T extends DatedInterval>(
  source: T[] | undefined,
  boundary: LocalDate,
  label: string
) {
  if (!source) return undefined;
  const intervals = source.map((interval) => ({ ...interval }));
  const current = intervals.at(-1);
  if (!current || current.endDate !== boundary) {
    throw new Error(`${label}末尾区间与实例结束日期不一致`);
  }
  current.endDate = null;
  return intervals;
}

function intervalsFor(item: TimelineItem): StateInterval[] {
  return (
    item.stateIntervals?.map((interval) => ({ ...interval })) ?? [
      {
        startDate: item.startDate,
        endDate: item.endDate,
        status: item.status === "paused" ? "paused" : "active"
      }
    ]
  );
}

export function timelineItemUsedDays(item: TimelineItem, asOfDate: LocalDate) {
  const lastUsedDate =
    item.status === "completed" && item.endDate ? addLocalDays(item.endDate, -1) : asOfDate;
  return Math.max(1, daysBetween(item.startDate, lastUsedDate) + 1);
}

export function timelineItemUsageSummary(
  item: TimelineItem,
  template: ManagementTemplate | undefined,
  asOfDate: LocalDate
): string | null {
  if (
    !template ||
    !["rigid_long_term", "lens_accessory", "opened_container", "batch_consumable"].includes(
      template
    )
  ) {
    return null;
  }
  return `已使用 ${timelineItemUsedDays(item, asOfDate)} 天`;
}

export function timelineItemActiveDays(item: TimelineItem, asOfDate: LocalDate) {
  const intervals = intervalsFor(item);
  return intervals
    .filter((interval) => interval.status === "active")
    .reduce((total, interval) => {
      if (interval.endDate) {
        return total + Math.max(0, daysBetween(interval.startDate, interval.endDate));
      }
      return total + Math.max(0, daysBetween(interval.startDate, asOfDate) + 1);
    }, 0);
}

export function replacementCountdownText(predictionDate: LocalDate, asOfDate: LocalDate) {
  const remainingDays = daysBetween(asOfDate, predictionDate);
  if (remainingDays > 0) return `预计 ${remainingDays} 天后更换`;
  if (remainingDays === 0) return "预计今天更换";
  return `已超过预计更换日 ${Math.abs(remainingDays)} 天`;
}

export function pauseTimelineItem(item: TimelineItem, date: LocalDate) {
  if (item.status !== "active") throw new Error("只有使用中的实例可以暂停");
  const intervals = intervalsFor(item);
  const current = intervals.at(-1);
  if (!current || current.status !== "active" || current.endDate !== null) {
    throw new Error("当前使用区间不完整");
  }
  if (date <= current.startDate) throw new Error("暂停日期必须晚于当前使用阶段开始日期");
  current.endDate = date;
  intervals.push({ startDate: date, endDate: null, status: "paused" });
  return { ...item, status: "paused" as const, stateIntervals: intervals };
}

export function resumeTimelineItem(item: TimelineItem, date: LocalDate) {
  if (item.status !== "paused") throw new Error("只有暂停中的实例可以恢复");
  const intervals = intervalsFor(item);
  const current = intervals.at(-1);
  if (!current || current.status !== "paused" || current.endDate !== null) {
    throw new Error("当前暂停区间不完整");
  }
  if (date <= current.startDate) throw new Error("恢复日期必须晚于暂停日期");
  current.endDate = date;
  intervals.push({ startDate: date, endDate: null, status: "active" });
  return { ...item, status: "active" as const, stateIntervals: intervals };
}

export function endTimelineItem(item: TimelineItem, date: LocalDate) {
  if (item.status === "completed") throw new Error("实例已经结束");
  if (date < item.startDate) throw new Error("结束日期不能早于启用日期");
  const intervals = intervalsFor(item);
  const current = intervals.at(-1);
  const boundary = addLocalDays(date, 1);
  if (!current || current.endDate !== null || boundary <= current.startDate) {
    throw new Error("结束日期与当前状态区间冲突");
  }
  current.endDate = boundary;
  const locationIntervals = closeAuxiliaryIntervals(item.locationIntervals, boundary, "地点");
  const eyeAssignmentIntervals = closeAuxiliaryIntervals(
    item.eyeAssignmentIntervals,
    boundary,
    "眼别"
  );
  return {
    ...item,
    status: "completed" as const,
    endDate: boundary,
    stateIntervals: intervals,
    ...(locationIntervals ? { locationIntervals } : {}),
    ...(eyeAssignmentIntervals ? { eyeAssignmentIntervals } : {})
  };
}

export function reopenTimelineItem(item: TimelineItem) {
  if (item.status !== "completed" || !item.endDate) {
    throw new Error("只有已经结束的实例可以撤销结束");
  }
  const intervals = intervalsFor(item);
  const previous = intervals.at(-1);
  if (!previous || previous.endDate !== item.endDate) {
    throw new Error("结束状态与最后一个状态区间不一致");
  }

  previous.endDate = null;
  const locationIntervals = reopenAuxiliaryIntervals(item.locationIntervals, item.endDate, "地点");
  const eyeAssignmentIntervals = reopenAuxiliaryIntervals(
    item.eyeAssignmentIntervals,
    item.endDate,
    "眼别"
  );
  const reopened: TimelineItem = {
    ...item,
    status: previous.status,
    endDate: null,
    stateIntervals: intervals,
    ...(locationIntervals ? { locationIntervals } : {}),
    ...(eyeAssignmentIntervals ? { eyeAssignmentIntervals } : {})
  };
  delete reopened.endReason;
  delete reopened.completionUsageFactId;
  return reopened;
}

export function editPausedInterval(
  item: TimelineItem,
  intervalIndex: number,
  startDate: LocalDate,
  endDate: LocalDate | null
) {
  const intervals = intervalsFor(item);
  const paused = intervals[intervalIndex];
  const previous = intervals[intervalIndex - 1];
  const next = intervals[intervalIndex + 1];
  const isFinalCompletedPause =
    item.status === "completed" && intervalIndex === intervals.length - 1;
  if (!paused || paused.status !== "paused" || !previous) {
    throw new Error("暂停记录不存在");
  }
  if (startDate <= previous.startDate) {
    throw new Error("暂停日期必须晚于前一个使用阶段开始日期");
  }
  if (endDate && endDate <= startDate) {
    throw new Error("恢复日期必须晚于暂停日期");
  }
  if (!endDate && !(item.status === "paused" && intervalIndex === intervals.length - 1)) {
    throw new Error("历史暂停记录必须填写恢复日期");
  }
  if (next && endDate && next.endDate && endDate >= next.endDate) {
    throw new Error("恢复日期必须早于后续阶段结束日期");
  }
  if (item.endDate && endDate && endDate > item.endDate && !isFinalCompletedPause) {
    throw new Error("恢复日期不能晚于实例结束日期");
  }

  previous.endDate = startDate;
  paused.startDate = startDate;
  paused.endDate = endDate;
  if (next && endDate) next.startDate = endDate;
  return {
    ...item,
    ...(isFinalCompletedPause && endDate ? { endDate } : {}),
    stateIntervals: intervals
  };
}

export function deletePausedInterval(item: TimelineItem, intervalIndex: number) {
  const intervals = intervalsFor(item);
  const paused = intervals[intervalIndex];
  const previous = intervals[intervalIndex - 1];
  const next = intervals[intervalIndex + 1];
  if (!paused || paused.status !== "paused" || !previous) {
    throw new Error("暂停记录不存在");
  }
  if (!paused.endDate) {
    throw new Error("当前暂停阶段不能删除，请先恢复使用");
  }
  if (next && next.status !== "active") {
    throw new Error("暂停记录后的使用阶段不完整");
  }
  previous.endDate = next ? next.endDate : paused.endDate;
  intervals.splice(intervalIndex, next ? 2 : 1);
  return { ...item, stateIntervals: intervals };
}
