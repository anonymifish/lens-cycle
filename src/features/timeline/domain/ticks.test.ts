import { describe, expect, it } from "vitest";
import { buildTimelineTicks, selectTickScale } from "./ticks";

describe("adaptive timeline ticks", () => {
  it("selects progressively finer scales", () => {
    expect(selectTickScale(0.3)).toBe("year");
    expect(selectTickScale(0.8)).toBe("quarter");
    expect(selectTickScale(2)).toBe("month");
    expect(selectTickScale(5)).toBe("week");
    expect(selectTickScale(12)).toBe("week");
    expect(selectTickScale(15)).toBe("day");
  });

  it("shows only year labels at the widest scale", () => {
    const result = buildTimelineTicks("2025-06-01", "2027-06-01", 0.3);
    expect(result.ticks.filter((tick) => tick.showLabel).map((tick) => tick.label)).toEqual([
      "2026 年",
      "2027 年"
    ]);
  });

  it("keeps dense day labels spaced apart", () => {
    const result = buildTimelineTicks("2026-07-01", "2026-07-31", 15);
    const labeled = result.ticks.filter((tick) => tick.showLabel);
    expect(result.scale).toBe("day");
    expect(labeled.length).toBeLessThanOrEqual(16);
    expect(labeled.every((tick) => /^\d{1,2}$/.test(tick.label))).toBe(true);
  });

  it("anchors sampled day labels to the first day of each month", () => {
    const result = buildTimelineTicks("2026-07-14", "2026-08-12", 15);
    expect(result.ticks.filter((tick) => tick.showLabel).map((tick) => tick.label)).toEqual([
      "15",
      "17",
      "19",
      "21",
      "23",
      "25",
      "27",
      "29",
      "31",
      "1",
      "3",
      "5",
      "7",
      "9",
      "11"
    ]);
    expect(result.contextBands.map((band) => band.label)).toEqual([
      "2026 年 7 月",
      "2026 年 8 月"
    ]);
  });

  it("anchors week labels to Mondays without splitting at month boundaries", () => {
    const result = buildTimelineTicks("2026-07-14", "2026-08-12", 10);
    expect(
      result.ticks.filter((tick) => tick.showLabel).map((tick) => ({
        label: tick.label,
        date: tick.date
      }))
    ).toEqual([
      { label: "13", date: "2026-07-13" },
      { label: "20", date: "2026-07-20" },
      { label: "27", date: "2026-07-27" },
      { label: "3", date: "2026-08-03" },
      { label: "10", date: "2026-08-10" }
    ]);
    expect(
      result.ticks.filter((tick) => tick.major).map((tick) => tick.date)
    ).toEqual(["2026-07-01", "2026-08-01"]);
  });

  it("hides a Monday label when it would collide with the next month boundary", () => {
    const result = buildTimelineTicks("2026-08-20", "2026-09-10", 10);
    const august31 = result.ticks.find((tick) => tick.date === "2026-08-31");
    expect(august31).toMatchObject({ label: "31", showLabel: false });
    expect(
      result.ticks.filter((tick) => tick.showLabel).map((tick) => tick.label)
    ).toContain("7");
  });

  it("keeps quarter and month labels independent from years", () => {
    const quarters = buildTimelineTicks("2026-01-01", "2026-12-31", 0.8);
    expect(quarters.ticks.filter((tick) => tick.showLabel).map((tick) => tick.label)).toEqual([
      "Q1",
      "Q2",
      "Q3",
      "Q4"
    ]);

    const months = buildTimelineTicks("2025-12-01", "2026-02-01", 2);
    expect(months.ticks.filter((tick) => tick.showLabel).map((tick) => tick.label)).toEqual([
      "12 月",
      "1 月",
      "2 月"
    ]);
    expect(months.contextBands.map((band) => band.label)).toEqual(["2025 年", "2026 年"]);
  });
});
