import { describe, expect, it } from "vitest";
import type { TimelineItem } from "../timeline.types";
import {
  editPausedInterval,
  endTimelineItem,
  pauseTimelineItem,
  reopenTimelineItem,
  replacementCountdownText,
  resumeTimelineItem,
  timelineItemActiveDays,
  timelineItemUsageSummary,
  timelineItemUsedDays
} from "./lifecycle";

const item: TimelineItem = {
  id: "item-1",
  categoryId: "profile-1",
  groupId: "lenses",
  categoryName: "巩膜镜（L）",
  productId: "product-1",
  sourceStockLotId: "lot-1",
  label: "镜片 1",
  detail: "使用中",
  location: "家",
  locationId: "home",
  locationIntervals: [
    { locationId: "home", startDate: "2026-07-01", endDate: null }
  ],
  eyeSides: ["L"],
  eyeAssignmentIntervals: [
    { eyeSides: ["L"], startDate: "2026-07-01", endDate: null }
  ],
  startDate: "2026-07-01",
  endDate: null,
  status: "active",
  stateIntervals: [
    { startDate: "2026-07-01", endDate: null, status: "active" }
  ]
};

describe("long-term lifecycle", () => {
  it("calculates natural usage days dynamically and freezes them after ending", () => {
    expect(timelineItemUsedDays(item, "2026-07-10")).toBe(10);
    expect(
      timelineItemUsedDays(endTimelineItem(item, "2026-07-15"), "2026-08-01")
    ).toBe(15);
  });

  it.each([
    "rigid_long_term",
    "lens_accessory",
    "opened_container",
    "batch_consumable"
  ] as const)("shows dynamic elapsed days for %s", (template) => {
    const itemWithStaleDisplayText = { ...item, detail: "已使用 1 天" };
    expect(
      timelineItemUsageSummary(itemWithStaleDisplayText, template, "2026-07-10")
    ).toBe("已使用 10 天");
  });

  it("excludes paused calendar days from active consumption days", () => {
    const resumed = resumeTimelineItem(
      pauseTimelineItem(item, "2026-07-04"),
      "2026-07-07"
    );
    expect(timelineItemActiveDays(resumed, "2026-07-10")).toBe(7);
  });

  it("formats future, due-today, and overdue replacement countdowns", () => {
    expect(replacementCountdownText("2026-08-11", "2026-08-01")).toBe(
      "预计 10 天后更换"
    );
    expect(replacementCountdownText("2026-08-01", "2026-08-01")).toBe(
      "预计今天更换"
    );
    expect(replacementCountdownText("2026-07-30", "2026-08-01")).toBe(
      "已超过预计更换日 2 天"
    );
  });

  it("creates continuous pause and resume boundaries", () => {
    const paused = pauseTimelineItem(item, "2026-07-10");
    const resumed = resumeTimelineItem(paused, "2026-07-13");

    expect(resumed.stateIntervals).toEqual([
      { startDate: "2026-07-01", endDate: "2026-07-10", status: "active" },
      { startDate: "2026-07-10", endDate: "2026-07-13", status: "paused" },
      { startDate: "2026-07-13", endDate: null, status: "active" }
    ]);
  });

  it("stores the inclusive actual end date as an exclusive boundary", () => {
    const completed = endTimelineItem(item, "2026-07-15");
    expect(completed.endDate).toBe("2026-07-16");
    expect(completed.stateIntervals?.[0]?.endDate).toBe("2026-07-16");
    expect(completed.locationIntervals?.[0]?.endDate).toBe("2026-07-16");
    expect(completed.eyeAssignmentIntervals?.[0]?.endDate).toBe("2026-07-16");
  });

  it("undoes an accidental end and restores the preceding status", () => {
    const activeAgain = reopenTimelineItem(endTimelineItem(item, "2026-07-15"));
    const pausedAgain = reopenTimelineItem(
      endTimelineItem(pauseTimelineItem(item, "2026-07-10"), "2026-07-15")
    );

    expect(activeAgain.status).toBe("active");
    expect(activeAgain.endDate).toBeNull();
    expect(activeAgain.stateIntervals?.at(-1)?.endDate).toBeNull();
    expect(activeAgain.locationIntervals?.at(-1)?.endDate).toBeNull();
    expect(activeAgain.eyeAssignmentIntervals?.at(-1)?.endDate).toBeNull();
    expect(pausedAgain.status).toBe("paused");
    expect(pausedAgain.stateIntervals?.at(-1)?.status).toBe("paused");
  });

  it("clears discard metadata when reopening an ended daily box", () => {
    const discarded = {
      ...endTimelineItem(item, "2026-07-15"),
      endReason: "提前结束/丢弃",
      completionUsageFactId: "usage-discard-1"
    };

    const reopened = reopenTimelineItem(discarded);
    expect(reopened.endReason).toBeUndefined();
    expect(reopened.completionUsageFactId).toBeUndefined();
    expect(reopened.status).toBe("active");
  });

  it("edits a pause and keeps adjacent intervals continuous", () => {
    const resumed = resumeTimelineItem(
      pauseTimelineItem(item, "2026-07-10"),
      "2026-07-13"
    );
    const edited = editPausedInterval(
      resumed,
      1,
      "2026-07-09",
      "2026-07-12"
    );

    expect(edited.stateIntervals?.[0]?.endDate).toBe("2026-07-09");
    expect(edited.stateIntervals?.[2]?.startDate).toBe("2026-07-12");
  });

  it("keeps a completed item's end boundary aligned with its final pause", () => {
    const completed = endTimelineItem(
      pauseTimelineItem(item, "2026-07-10"),
      "2026-07-15"
    );
    const edited = editPausedInterval(
      completed,
      1,
      "2026-07-09",
      "2026-07-18"
    );

    expect(edited.endDate).toBe("2026-07-18");
    expect(edited.stateIntervals?.[1]?.endDate).toBe("2026-07-18");
  });

  it("rejects invalid pause, resume, end, and reopen transitions", () => {
    expect(() => pauseTimelineItem(item, "2026-07-01")).toThrow(
      "暂停日期必须晚于当前使用阶段开始日期"
    );
    expect(() => resumeTimelineItem(item, "2026-07-02")).toThrow(
      "只有暂停中的实例可以恢复"
    );
    const paused = pauseTimelineItem(item, "2026-07-05");
    expect(() => resumeTimelineItem(paused, "2026-07-05")).toThrow(
      "恢复日期必须晚于暂停日期"
    );
    expect(() => endTimelineItem(item, "2026-06-30")).toThrow(
      "结束日期不能早于启用日期"
    );
    expect(() => reopenTimelineItem(item)).toThrow(
      "只有已经结束的实例可以撤销结束"
    );
  });

  it("rejects pause edits that create zero-length or open historical intervals", () => {
    const resumed = resumeTimelineItem(
      pauseTimelineItem(item, "2026-07-10"),
      "2026-07-13"
    );
    expect(() =>
      editPausedInterval(resumed, 1, "2026-07-01", "2026-07-12")
    ).toThrow("暂停日期必须晚于前一个使用阶段开始日期");
    expect(() =>
      editPausedInterval(resumed, 1, "2026-07-09", null)
    ).toThrow("历史暂停记录必须填写恢复日期");
    expect(() =>
      editPausedInterval(resumed, 1, "2026-07-09", "2026-07-09")
    ).toThrow("恢复日期必须晚于暂停日期");
  });

  it("falls back to root dates when state history is absent", () => {
    const withoutHistory = structuredClone(item);
    delete withoutHistory.stateIntervals;
    expect(timelineItemActiveDays(withoutHistory, "2026-07-03")).toBe(3);
    expect(timelineItemUsageSummary(withoutHistory, undefined, "2026-07-03")).toBeNull();
    expect(timelineItemUsageSummary(withoutHistory, "soft_daily", "2026-07-03")).toBeNull();
  });

  it("rejects malformed current intervals and duplicate lifecycle actions", () => {
    expect(() => pauseTimelineItem({ ...item, status: "paused" }, "2026-07-02"))
      .toThrow("只有使用中的实例可以暂停");
    expect(() => pauseTimelineItem({
      ...item,
      stateIntervals: [{ startDate: "2026-07-01", endDate: "2026-07-02", status: "active" }]
    }, "2026-07-03")).toThrow("当前使用区间不完整");
    expect(() => resumeTimelineItem({
      ...item,
      status: "paused",
      stateIntervals: [{ startDate: "2026-07-01", endDate: null, status: "active" }]
    }, "2026-07-03")).toThrow("当前暂停区间不完整");
    const completed = endTimelineItem(item, "2026-07-03");
    expect(() => endTimelineItem(completed, "2026-07-04")).toThrow("实例已经结束");
    expect(() => endTimelineItem({
      ...item,
      stateIntervals: [{ startDate: "2026-07-01", endDate: "2026-07-02", status: "active" }]
    }, "2026-07-03")).toThrow("结束日期与当前状态区间冲突");
  });

  it("supports ending and reopening items without auxiliary histories", () => {
    const bare = structuredClone(item);
    delete bare.locationIntervals;
    delete bare.eyeAssignmentIntervals;
    const completed = endTimelineItem(bare, "2026-07-03");
    expect(completed.locationIntervals).toBeUndefined();
    expect(completed.eyeAssignmentIntervals).toBeUndefined();
    expect(reopenTimelineItem(completed).status).toBe("active");
  });

  it("rejects inconsistent auxiliary histories while ending and reopening", () => {
    expect(() => endTimelineItem({
      ...item,
      locationIntervals: [{ locationId: "home", startDate: "2026-07-01", endDate: "2026-07-02" }]
    }, "2026-07-03")).toThrow("地点末尾区间与结束日期冲突");
    expect(() => endTimelineItem({
      ...item,
      eyeAssignmentIntervals: [{ eyeSides: ["L"], startDate: "2026-07-01", endDate: "2026-07-02" }]
    }, "2026-07-03")).toThrow("眼别末尾区间与结束日期冲突");
    const completed = endTimelineItem(item, "2026-07-03");
    expect(() => reopenTimelineItem({
      ...completed,
      locationIntervals: [{ locationId: "home", startDate: "2026-07-01", endDate: "2026-07-02" }]
    })).toThrow("地点末尾区间与实例结束日期不一致");
    expect(() => reopenTimelineItem({
      ...completed,
      eyeAssignmentIntervals: [{ eyeSides: ["L"], startDate: "2026-07-01", endDate: "2026-07-02" }]
    })).toThrow("眼别末尾区间与实例结束日期不一致");
  });

  it("rejects malformed pause edits and later interval conflicts", () => {
    expect(() => editPausedInterval(item, 0, "2026-07-02", null))
      .toThrow("暂停记录不存在");
    const multiStage = {
      ...item,
      status: "completed" as const,
      endDate: "2026-07-20" as const,
      stateIntervals: [
        { startDate: "2026-07-01" as const, endDate: "2026-07-05" as const, status: "active" as const },
        { startDate: "2026-07-05" as const, endDate: "2026-07-08" as const, status: "paused" as const },
        { startDate: "2026-07-08" as const, endDate: "2026-07-12" as const, status: "active" as const },
        { startDate: "2026-07-12" as const, endDate: "2026-07-20" as const, status: "paused" as const }
      ]
    };
    expect(() => editPausedInterval(multiStage, 1, "2026-07-04", null))
      .toThrow("历史暂停记录必须填写恢复日期");
    expect(() => editPausedInterval(multiStage, 1, "2026-07-04", "2026-07-12"))
      .toThrow("恢复日期必须早于后续阶段结束日期");
    expect(() => editPausedInterval(multiStage, 1, "2026-07-04", "2026-07-21"))
      .toThrow("恢复日期必须早于后续阶段结束日期");
    expect(() => editPausedInterval({
      ...multiStage,
      stateIntervals: multiStage.stateIntervals.map((interval, index) =>
        index === 2 ? { ...interval, endDate: null } : interval
      )
    }, 1, "2026-07-04", "2026-07-21"))
      .toThrow("恢复日期不能晚于实例结束日期");
  });
});
