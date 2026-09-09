import { describe, expect, it } from "vitest";
import { assignLanes, clipInterval, intervalsOverlap } from "./intervals";

describe("timeline intervals", () => {
  it("uses left-closed right-open overlap semantics", () => {
    expect(intervalsOverlap("2026-01-01", "2026-01-10", "2026-01-10", "2026-01-20")).toBe(
      false
    );
    expect(intervalsOverlap("2026-01-01", "2026-01-11", "2026-01-10", "2026-01-20")).toBe(
      true
    );
  });

  it("clips intervals to the current viewport", () => {
    expect(
      clipInterval(
        { instanceId: "a", startDate: "2025-12-01", endDate: "2026-02-01" },
        "2026-01-01",
        "2026-03-01"
      )
    ).toMatchObject({ clippedStart: "2026-01-01", clippedEnd: "2026-02-01" });
  });

  it("allocates the minimum lanes and reuses non-overlapping lanes", () => {
    const layout = assignLanes(
      [
        { instanceId: "a", startDate: "2026-01-01", endDate: "2026-02-01" },
        { instanceId: "b", startDate: "2026-01-20", endDate: "2026-03-01" },
        { instanceId: "c", startDate: "2026-03-01", endDate: "2026-04-01" }
      ],
      "2026-01-01",
      "2026-05-01"
    );
    expect(layout.laneCount).toBe(2);
    expect(layout.assignments).toEqual([
      { instanceId: "a", laneIndex: 0 },
      { instanceId: "b", laneIndex: 1 },
      { instanceId: "c", laneIndex: 0 }
    ]);
  });

  it("drops invisible overlaps and contracts lanes", () => {
    const layout = assignLanes(
      [
        { instanceId: "a", startDate: "2026-01-01", endDate: "2026-02-01" },
        { instanceId: "b", startDate: "2026-01-10", endDate: "2026-06-01" }
      ],
      "2026-03-01",
      "2026-05-01"
    );
    expect(layout).toEqual({
      assignments: [{ instanceId: "b", laneIndex: 0 }],
      laneCount: 1
    });
  });

  it("reuses preferred lanes when available and falls back when occupied", () => {
    expect(assignLanes(
      [{ instanceId: "a", startDate: "2026-01-01", endDate: "2026-01-10" }],
      "2026-01-01", "2026-02-01", new Map([["a", 0]])
    ).assignments).toEqual([{ instanceId: "a", laneIndex: 0 }]);

    expect(assignLanes(
      [
        { instanceId: "a", startDate: "2026-01-01", endDate: "2026-01-10" },
        { instanceId: "b", startDate: "2026-01-10", endDate: "2026-01-20" }
      ],
      "2026-01-01", "2026-02-01", new Map([["a", 0], ["b", 0]])
    ).assignments).toEqual([
      { instanceId: "a", laneIndex: 0 },
      { instanceId: "b", laneIndex: 0 }
    ]);

    expect(assignLanes(
      [
        { instanceId: "a", startDate: "2026-01-01", endDate: "2026-01-20" },
        { instanceId: "b", startDate: "2026-01-10", endDate: "2026-01-15" }
      ],
      "2026-01-01", "2026-02-01", new Map([["a", 0], ["b", 0]])
    ).assignments).toEqual([
      { instanceId: "a", laneIndex: 0 },
      { instanceId: "b", laneIndex: 1 }
    ]);
  });
});
