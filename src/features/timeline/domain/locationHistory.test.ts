import { describe, expect, it } from "vitest";
import type { TimelineItem } from "../timeline.types";
import {
  editTimelineLocationInterval,
  timelineLocationIdAtDate
} from "./locationHistory";

const item: TimelineItem = {
  id: "item-1",
  categoryId: "profile-1",
  groupId: "periodic",
  categoryName: "镜盒",
  productId: "product-1",
  sourceStockLotId: "lot-1",
  label: "镜盒 1",
  detail: "使用中",
  location: "办公室",
  locationId: "office",
  locationIntervals: [
    { locationId: "home", startDate: "2026-08-01", endDate: "2026-08-05" },
    { locationId: "office", startDate: "2026-08-05", endDate: null }
  ],
  startDate: "2026-08-01",
  endDate: null,
  status: "active"
};

describe("timeline location history", () => {
  it("resolves the location covering a historical date", () => {
    expect(timelineLocationIdAtDate(item, "2026-08-04")).toBe("home");
    expect(timelineLocationIdAtDate(item, "2026-08-05")).toBe("office");
  });

  it("moves a boundary while keeping adjacent intervals continuous", () => {
    const updated = editTimelineLocationInterval(
      item,
      1,
      "carry",
      "随身",
      "2026-08-07"
    );

    expect(updated.locationIntervals).toEqual([
      { locationId: "home", startDate: "2026-08-01", endDate: "2026-08-07" },
      { locationId: "carry", startDate: "2026-08-07", endDate: null }
    ]);
    expect(updated.locationId).toBe("carry");
    expect(updated.location).toBe("随身");
  });

  it("edits an older location without changing the current location", () => {
    const updated = editTimelineLocationInterval(
      item,
      0,
      "carry",
      "随身",
      "2026-08-01"
    );
    expect(updated.locationIntervals?.[0]?.locationId).toBe("carry");
    expect(updated.locationId).toBe("office");
  });

  it("rejects boundaries that make an interval empty", () => {
    expect(() =>
      editTimelineLocationInterval(item, 1, "carry", "随身", "2026-08-01")
    ).toThrow("本段开始日期必须晚于上一段开始日期");
  });

  it("rejects missing histories, locations, and invalid first boundaries", () => {
    const withoutLocationHistory = structuredClone(item);
    delete withoutLocationHistory.locationIntervals;
    expect(() => editTimelineLocationInterval(
      withoutLocationHistory, 0, "home", "家", "2026-08-01"
    )).toThrow("地点历史记录不存在");
    expect(() => editTimelineLocationInterval(item, 0, "", "", "2026-08-01"))
      .toThrow("请选择地点");
    expect(() => editTimelineLocationInterval(item, 0, "home", "家", "2026-08-02"))
      .toThrow("首段地点必须从实例启用日期开始");
  });

  it("rejects a later segment starting at or after its own end", () => {
    const completedHistory = {
      ...item,
      locationIntervals: [
        { locationId: "home", startDate: "2026-08-01" as const, endDate: "2026-08-05" as const },
        { locationId: "office", startDate: "2026-08-05" as const, endDate: "2026-08-10" as const }
      ]
    };
    expect(() => editTimelineLocationInterval(
      completedHistory, 1, "carry", "随身", "2026-08-10"
    )).toThrow("本段开始日期必须早于本段结束日期");
  });
});
