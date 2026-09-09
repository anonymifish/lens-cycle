import type { LocalDate } from "../../../shared/dates/localDate";

export interface TimelineInterval {
  instanceId: string;
  startDate: LocalDate;
  endDate: LocalDate | null;
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
        a.clippedStart.localeCompare(b.clippedStart) ||
        a.instanceId.localeCompare(b.instanceId)
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
