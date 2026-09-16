import type { LocalDate } from "../../../shared/dates/localDate";

export interface TimelineInterval {
  instanceId: string;
  startDate: LocalDate;
  endDate: LocalDate | null;
}

export interface GroupedTimelineInterval extends TimelineInterval {
  laneGroupId: string;
  laneGroupOrder: number;
}

export interface LaneAssignment {
  instanceId: string;
  laneIndex: number;
}

export interface LaneLayout {
  assignments: LaneAssignment[];
  laneCount: number;
}

interface ClippedInterval extends TimelineInterval {
  clippedStart: LocalDate;
  clippedEnd: LocalDate;
}

function maxDate(a: LocalDate, b: LocalDate): LocalDate {
  return a > b ? a : b;
}

function minDate(a: LocalDate, b: LocalDate): LocalDate {
  return a < b ? a : b;
}

export function intervalsOverlap(
  aStart: LocalDate,
  aEnd: LocalDate,
  bStart: LocalDate,
  bEnd: LocalDate
): boolean {
  return aStart < bEnd && bStart < aEnd;
}

export function clipInterval(
  interval: TimelineInterval,
  rangeStart: LocalDate,
  rangeEnd: LocalDate
): ClippedInterval | null {
  const end = interval.endDate ?? rangeEnd;
  const clippedStart = maxDate(interval.startDate, rangeStart);
  const clippedEnd = minDate(end, rangeEnd);
  if (clippedStart >= clippedEnd) return null;
  return { ...interval, clippedStart, clippedEnd };
}

export function assignLanes(
  intervals: TimelineInterval[],
  rangeStart: LocalDate,
  rangeEnd: LocalDate,
  previousAssignments: ReadonlyMap<string, number> = new Map()
): LaneLayout {
  const visible = intervals
    .map((interval) => clipInterval(interval, rangeStart, rangeEnd))
    .filter((interval): interval is ClippedInterval => interval !== null)
    .sort(
      (a, b) =>
        a.clippedStart.localeCompare(b.clippedStart) || a.instanceId.localeCompare(b.instanceId)
    );

  const laneEnds: LocalDate[] = [];
  const assignments: LaneAssignment[] = [];

  for (const interval of visible) {
    const preferredLane = previousAssignments.get(interval.instanceId);
    let laneIndex = -1;

    if (
      preferredLane !== undefined &&
      (laneEnds[preferredLane] === undefined || laneEnds[preferredLane] <= interval.clippedStart)
    ) {
      laneIndex = preferredLane;
    }

    if (laneIndex < 0) {
      laneIndex = laneEnds.findIndex((end) => end <= interval.clippedStart);
    }

    if (laneIndex < 0) laneIndex = laneEnds.length;
    laneEnds[laneIndex] = interval.clippedEnd;
    assignments.push({ instanceId: interval.instanceId, laneIndex });
  }

  return { assignments, laneCount: laneEnds.length };
}

/** Keeps every visible lane for one product contiguous and follows product order. */
export function assignGroupedLanes(
  intervals: GroupedTimelineInterval[],
  rangeStart: LocalDate,
  rangeEnd: LocalDate
): LaneLayout {
  const visible = intervals.filter(
    (interval) => clipInterval(interval, rangeStart, rangeEnd) !== null
  );
  const groups = new Map<string, GroupedTimelineInterval[]>();
  for (const interval of visible) {
    const group = groups.get(interval.laneGroupId) ?? [];
    group.push(interval);
    groups.set(interval.laneGroupId, group);
  }

  const orderedGroups = [...groups.entries()].sort((left, right) => {
    const leftOrder = Math.min(...left[1].map((entry) => entry.laneGroupOrder));
    const rightOrder = Math.min(...right[1].map((entry) => entry.laneGroupOrder));
    return leftOrder - rightOrder || left[0].localeCompare(right[0]);
  });
  const assignments: LaneAssignment[] = [];
  let laneOffset = 0;
  for (const [, groupIntervals] of orderedGroups) {
    const layout = assignLanes(groupIntervals, rangeStart, rangeEnd);
    assignments.push(
      ...layout.assignments.map((entry) => ({
        ...entry,
        laneIndex: entry.laneIndex + laneOffset
      }))
    );
    laneOffset += layout.laneCount;
  }
  return { assignments, laneCount: laneOffset };
}
