import { beforeEach, describe, expect, it } from "vitest";
import type { TimelineItem } from "../features/timeline/timeline.types";
import { useTimelineItemStore } from "./timelineItemStore";

const item: TimelineItem = {
  id: "instance-1",
  categoryId: "case-1",
  groupId: "periodic",
  categoryName: "镜盒",
  productId: "product-1",
  sourceStockLotId: "lot-1",
  label: "测试镜盒",
  detail: "已使用 1 天",
  location: "家",
  locationId: "home",
  locationIntervals: [
    { locationId: "home", startDate: "2026-08-25", endDate: null }
  ],
  eyeSides: ["L"],
  eyeAssignmentIntervals: [
    { eyeSides: ["L"], startDate: "2026-08-25", endDate: null }
  ],
  startDate: "2026-08-25",
  endDate: null,
  status: "active",
  stateIntervals: [
    { status: "active", startDate: "2026-08-25", endDate: null }
  ]
};

describe("timeline item detail updates", () => {
  beforeEach(() => {
    useTimelineItemStore.setState({ items: [item] });
  });

  it("keeps every root interval aligned when the activation date changes", () => {
    useTimelineItemStore.setState({ items: [{
      ...item,
      stateIntervals: [
        item.stateIntervals![0]!,
        { status: "paused", startDate: "2026-08-26", endDate: null }
      ],
      locationIntervals: [
        item.locationIntervals![0]!,
        { locationId: "office", startDate: "2026-08-26", endDate: null }
      ],
      eyeAssignmentIntervals: [
        item.eyeAssignmentIntervals![0]!,
        { eyeSides: ["R"], startDate: "2026-08-26", endDate: null }
      ]
    }] });
    useTimelineItemStore.getState().updateItemDetails(item.id, {
      label: item.label,
      startDate: "2026-08-24",
      location: item.location,
      locationId: item.locationId!
    });

    const updated = useTimelineItemStore.getState().items[0]!;
    expect(updated.startDate).toBe("2026-08-24");
    expect(updated.stateIntervals?.[0]?.startDate).toBe("2026-08-24");
    expect(updated.locationIntervals?.[0]?.startDate).toBe("2026-08-24");
    expect(updated.eyeAssignmentIntervals?.[0]?.startDate).toBe("2026-08-24");
    expect(updated.stateIntervals?.[1]?.startDate).toBe("2026-08-26");
    expect(updated.locationIntervals?.[1]?.startDate).toBe("2026-08-26");
    expect(updated.eyeAssignmentIntervals?.[1]?.startDate).toBe("2026-08-26");
  });

  it("supports direct and functional replacement plus add and delete", () => {
    useTimelineItemStore.getState().setItems([]);
    expect(useTimelineItemStore.getState().items).toEqual([]);
    useTimelineItemStore.getState().addItem(item);
    useTimelineItemStore.getState().setItems((items) => items.map((entry) => ({
      ...entry, label: "函数更新"
    })));
    expect(useTimelineItemStore.getState().items[0]?.label).toBe("函数更新");
    useTimelineItemStore.getState().deleteItem(item.id);
    expect(useTimelineItemStore.getState().items).toEqual([]);
  });

  it("leaves unmatched items and absent interval histories unchanged", () => {
    const withoutHistories = structuredClone(item);
    delete withoutHistories.stateIntervals;
    delete withoutHistories.locationIntervals;
    delete withoutHistories.eyeAssignmentIntervals;
    useTimelineItemStore.setState({ items: [withoutHistories] });
    useTimelineItemStore.getState().updateItemDetails("missing", {
      label: "不应写入", startDate: "2026-08-20", location: "办公室", locationId: "office"
    });
    expect(useTimelineItemStore.getState().items[0]?.label).toBe(item.label);
    useTimelineItemStore.getState().updateItemDetails(item.id, {
      label: "已更新", startDate: "2026-08-20", location: "办公室", locationId: "office"
    });
    expect(useTimelineItemStore.getState().items[0]).toMatchObject({
      label: "已更新", startDate: "2026-08-20", locationId: "office"
    });
  });
});
