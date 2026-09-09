import { beforeEach, describe, expect, it } from "vitest";
import { useItemProfileStore } from "./itemProfileStore";
import { useTimelineCareEventStore } from "./timelineCareEventStore";
import { useTimelineItemStore } from "./timelineItemStore";

describe("care event store invariants", () => {
  beforeEach(() => {
    useItemProfileStore.setState({
      profiles: [
        {
          id: "rigid-profile",
          groupId: "lenses",
          managementTemplate: "rigid_long_term",
          standardType: "scleral",
          name: "巩膜镜（L）",
          side: "L",
          active: true,
          order: 0
        },
        {
          id: "daily-profile",
          groupId: "lenses",
          managementTemplate: "soft_daily",
          standardType: "soft_daily",
          name: "日抛（R）",
          side: "R",
          active: true,
          order: 1
        }
      ]
    });
    useTimelineItemStore.setState({
      items: [
        {
          id: "rigid-item",
          categoryId: "rigid-profile",
          groupId: "lenses",
          categoryName: "巩膜镜（L）",
          productId: "product-1",
          sourceStockLotId: "lot-1",
          label: "镜片",
          detail: "",
          location: "家",
          locationId: "home",
          startDate: "2026-08-01",
          endDate: null,
          status: "active"
        },
        {
          id: "daily-item",
          categoryId: "daily-profile",
          groupId: "lenses",
          categoryName: "日抛（R）",
          productId: "product-2",
          sourceStockLotId: "lot-2",
          label: "日抛",
          detail: "",
          location: "家",
          locationId: "home",
          startDate: "2026-08-01",
          endDate: null,
          status: "active"
        }
      ]
    });
    useTimelineCareEventStore.setState({ events: [] });
  });

  it("creates, updates, and completes a rigid-lens care event", () => {
    const store = useTimelineCareEventStore.getState();
    const id = store.addEvent({
      itemId: "rigid-item",
      kind: "review",
      plannedDate: "2026-08-10"
    });
    store.updateEvent(id, {
      kind: "protein",
      plannedDate: "2026-08-12",
      completedDate: undefined
    });
    store.completeEvent(id, "2026-08-11");
    expect(useTimelineCareEventStore.getState().events[0]).toMatchObject({
      id,
      kind: "protein",
      plannedDate: "2026-08-12",
      completedDate: "2026-08-11"
    });
  });

  it.each([
    [{ itemId: "missing", kind: "review" as const, plannedDate: "2026-08-10" as const }, "使用实例不存在"],
    [{ itemId: "daily-item", kind: "review" as const, plannedDate: "2026-08-10" as const }, "护理事件只能关联长期硬镜实例"],
    [{ itemId: "rigid-item", kind: "review" as const }, "护理事件至少需要计划或完成日期"],
    [{ itemId: "rigid-item", kind: "review" as const, plannedDate: "2026-07-31" as const }, "护理事件日期不在实例生命周期内"]
  ])("rejects invalid care event %#", (event, message) => {
    expect(() => useTimelineCareEventStore.getState().addEvent(event)).toThrow(
      message
    );
    expect(useTimelineCareEventStore.getState().events).toEqual([]);
  });

  it("rejects editing or completing an unknown event", () => {
    expect(() =>
      useTimelineCareEventStore.getState().updateEvent("missing", {
        kind: "review",
        plannedDate: "2026-08-10",
        completedDate: undefined
      })
    ).toThrow("护理事件不存在");
    expect(() =>
      useTimelineCareEventStore.getState().completeEvent("missing", "2026-08-10")
    ).toThrow("护理事件不存在");
  });
});
