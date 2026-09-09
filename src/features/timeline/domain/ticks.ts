import {
  addDays,
  addMonths,
  addQuarters,
  addWeeks,
  addYears,
  differenceInCalendarDays,
  format,
  startOfDay,
  startOfMonth,
  startOfQuarter,
  startOfWeek,
  startOfYear
} from "date-fns";
import {
  formatLocalDate,
  parseLocalDate,
  type LocalDate
} from "../../../shared/dates/localDate";

export type TimelineTickScale = "year" | "quarter" | "month" | "week" | "day";

export interface TimelineTick {
  date: LocalDate;
  label: string;
  labelEndDate?: LocalDate;
  minimumLabelWidth?: number;
  major: boolean;
  showLabel: boolean;
}

export interface TimelineTicks {
  scale: TimelineTickScale;
  ticks: TimelineTick[];
  contextBands: TimelineContextBand[];
}

export interface TimelineContextBand {
  startDate: LocalDate;
  endDate: LocalDate;
  label: string;
}

function within(date: Date, end: Date): boolean {
  return date.getTime() <= end.getTime();
}

export function selectTickScale(pixelsPerDay: number): TimelineTickScale {
  if (pixelsPerDay < 0.5) return "year";
  if (pixelsPerDay < 1.5) return "quarter";
  if (pixelsPerDay < 4) return "month";
  if (pixelsPerDay < 15) return "week";
  return "day";
}

export function buildTimelineTicks(
  startDate: LocalDate,
  endDate: LocalDate,
  pixelsPerDay: number
): TimelineTicks {
  const start = parseLocalDate(startDate);
  const end = parseLocalDate(endDate);
  const scale = selectTickScale(pixelsPerDay);
  const ticks: TimelineTick[] = [];
  const contextBands: TimelineContextBand[] = [];

  if (scale === "day" || scale === "week") {
    let bandStart = startOfMonth(start);
    while (within(bandStart, end) && contextBands.length < 80) {
      const bandEnd = addMonths(bandStart, 1);
      contextBands.push({
        startDate: formatLocalDate(bandStart),
        endDate: formatLocalDate(bandEnd),
        label: format(bandStart, "yyyy 年 M 月")
      });
      bandStart = bandEnd;
    }
  } else if (scale === "month" || scale === "quarter") {
    let bandStart = startOfYear(start);
    while (within(bandStart, end) && contextBands.length < 30) {
      const bandEnd = addYears(bandStart, 1);
      contextBands.push({
        startDate: formatLocalDate(bandStart),
        endDate: formatLocalDate(bandEnd),
        label: format(bandStart, "yyyy 年")
      });
      bandStart = bandEnd;
    }
  }

  if (scale === "year") {
    let cursor = startOfQuarter(start);
    while (within(cursor, end) && ticks.length < 160) {
      const isYear = cursor.getMonth() === 0;
      ticks.push({
        date: formatLocalDate(cursor),
        label: isYear ? format(cursor, "yyyy 年") : "",
        major: isYear,
        showLabel: isYear
      });
      cursor = addQuarters(cursor, 1);
    }
  } else if (scale === "quarter") {
    let cursor = startOfMonth(start);
    while (within(cursor, end) && ticks.length < 160) {
      const isQuarter = cursor.getMonth() % 3 === 0;
      ticks.push({
        date: formatLocalDate(cursor),
        label: isQuarter ? `Q${Math.floor(cursor.getMonth() / 3) + 1}` : "",
        major: isQuarter,
        showLabel: isQuarter
      });
      cursor = addMonths(cursor, 1);
    }
  } else if (scale === "month") {
    let cursor = startOfWeek(start, { weekStartsOn: 1 });
    while (within(cursor, end) && ticks.length < 220) {
      ticks.push({
        date: formatLocalDate(cursor),
        label: "",
        major: false,
        showLabel: false
      });
      cursor = addWeeks(cursor, 1);
    }
    cursor = startOfMonth(start);
    while (within(cursor, end) && ticks.length < 240) {
      ticks.push({
        date: formatLocalDate(cursor),
        label: format(cursor, "M 月"),
        major: true,
        showLabel: true
      });
      cursor = addMonths(cursor, 1);
    }
  } else if (scale === "week") {
    let cursor = startOfWeek(start, { weekStartsOn: 1 });
    while (within(cursor, end) && ticks.length < 220) {
      ticks.push({
        date: formatLocalDate(cursor),
        label: format(cursor, "d"),
        major: false,
        showLabel:
          differenceInCalendarDays(addMonths(startOfMonth(cursor), 1), cursor) *
            pixelsPerDay >=
          format(cursor, "d").length * 6 + 14
      });
      cursor = addWeeks(cursor, 1);
    }

    cursor = startOfMonth(start);
    while (within(cursor, end) && ticks.length < 240) {
      ticks.push({
        date: formatLocalDate(cursor),
        label: "",
        major: true,
        showLabel: false
      });
      cursor = addMonths(cursor, 1);
    }
  } else {
    const labelEvery = Math.max(1, Math.ceil(30 / pixelsPerDay));
    let cursor = startOfDay(start);
    while (within(cursor, end) && ticks.length < 360) {
      const isMonthBoundary = cursor.getDate() === 1;
      const showLabel = (cursor.getDate() - 1) % labelEvery === 0;
      ticks.push({
        date: formatLocalDate(cursor),
        ...(showLabel ? { labelEndDate: formatLocalDate(addDays(cursor, 1)) } : {}),
        label: showLabel ? format(cursor, "d") : "",
        major: isMonthBoundary,
        showLabel
      });
      cursor = addDays(cursor, 1);
    }
  }

  const uniqueTicks = new Map<LocalDate, TimelineTick>();
  for (const tick of ticks) {
    const existing = uniqueTicks.get(tick.date);
    if (!existing) {
      uniqueTicks.set(tick.date, tick);
      continue;
    }
    uniqueTicks.set(tick.date, {
      ...existing,
      ...tick,
      label: existing.showLabel ? existing.label : tick.label,
      ...(existing.labelEndDate ? { labelEndDate: existing.labelEndDate } : {}),
      ...(existing.minimumLabelWidth
        ? { minimumLabelWidth: existing.minimumLabelWidth }
        : {}),
      major: existing.major || tick.major,
      showLabel: existing.showLabel || tick.showLabel
    });
  }
  return {
    scale,
    ticks: [...uniqueTicks.values()].sort((a, b) => a.date.localeCompare(b.date)),
    contextBands
  };
}
