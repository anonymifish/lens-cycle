import { describe, expect, it } from "vitest";
import type { TimelineViewport } from "../timeline.types";
import {
  dateToX,
  panViewport,
  visibleDateRange,
  xToDate,
  xToDayCellDate,
  zoomAtX
} from "./viewport";

const viewport: TimelineViewport = {
  centerDate: "2026-07-30",
  pixelsPerDay: 10,
  viewportWidth: 1000
};

describe("timeline viewport", () => {
  it("converts dates and pixels in both directions", () => {
    expect(dateToX("2026-08-04", viewport)).toBe(550);
    expect(xToDate(550, viewport)).toBe("2026-08-04");
  });

  it("keeps every click inside a day cell on that day", () => {
    expect(xToDayCellDate(550, viewport)).toBe("2026-08-04");
    expect(xToDayCellDate(559.99, viewport)).toBe("2026-08-04");
    expect(xToDayCellDate(560, viewport)).toBe("2026-08-05");
    expect(xToDayCellDate(499.99, viewport)).toBe("2026-07-29");
  });

  it("derives the visible date range", () => {
    expect(visibleDateRange(viewport)).toEqual({
      startDate: "2026-06-10",
      endDate: "2026-09-18"
    });
  });

  it("pans continuously by pixel distance", () => {
    expect(panViewport(viewport, 100).centerDate).toBe("2026-07-20");
  });

  it("keeps the cursor date anchored while zooming", () => {
    const anchorX = 700;
    const anchorDate = xToDate(anchorX, viewport);
    const zoomed = zoomAtX(viewport, anchorX, 2);
    expect(xToDate(anchorX, zoomed)).toBe(anchorDate);
  });
});
