import {
  addLocalDays,
  daysBetween,
  type LocalDate
} from "../../../shared/dates/localDate";
import type { TimelineViewport, VisibleDateRange } from "../timeline.types";

export const MIN_PIXELS_PER_DAY = 0.28;
export const MAX_PIXELS_PER_DAY = 34;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export function visibleDateRange(viewport: TimelineViewport): VisibleDateRange {
  const halfDays = viewport.viewportWidth / viewport.pixelsPerDay / 2;
  return {
    startDate: addLocalDays(viewport.centerDate, -Math.ceil(halfDays)),
    endDate: addLocalDays(viewport.centerDate, Math.ceil(halfDays))
  };
}

export function dateToX(date: LocalDate, viewport: TimelineViewport): number {
  return (
    viewport.viewportWidth / 2 +
    daysBetween(viewport.centerDate, date) * viewport.pixelsPerDay
  );
}

export function xToDate(x: number, viewport: TimelineViewport): LocalDate {
  const offset = Math.round((x - viewport.viewportWidth / 2) / viewport.pixelsPerDay);
  return addLocalDays(viewport.centerDate, offset);
}

/** Resolves a click inside a full-day cell whose left edge is the date boundary. */
export function xToDayCellDate(x: number, viewport: TimelineViewport): LocalDate {
  const offset = Math.floor((x - viewport.viewportWidth / 2) / viewport.pixelsPerDay);
  return addLocalDays(viewport.centerDate, offset);
}

export function panViewport(viewport: TimelineViewport, deltaPixels: number): TimelineViewport {
  const dayDelta = -deltaPixels / viewport.pixelsPerDay;
  return {
    ...viewport,
    centerDate: addLocalDays(viewport.centerDate, Math.round(dayDelta))
  };
}

export function zoomAtX(
  viewport: TimelineViewport,
  anchorX: number,
  factor: number
): TimelineViewport {
  const nextPixelsPerDay = clamp(
    viewport.pixelsPerDay * factor,
    MIN_PIXELS_PER_DAY,
    MAX_PIXELS_PER_DAY
  );
  const anchorDate = xToDate(anchorX, viewport);
  const anchorOffsetFromCenter = (anchorX - viewport.viewportWidth / 2) / nextPixelsPerDay;
  return {
    ...viewport,
    pixelsPerDay: nextPixelsPerDay,
    centerDate: addLocalDays(anchorDate, -Math.round(anchorOffsetFromCenter))
  };
}

export function pixelsPerDayForSpan(width: number, days: number): number {
  return clamp(width / days, MIN_PIXELS_PER_DAY, MAX_PIXELS_PER_DAY);
}
