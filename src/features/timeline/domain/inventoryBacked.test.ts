import { describe, expect, it } from "vitest";
import type { TimelineItem } from "../timeline.types";
import { filterInventoryBackedItems } from "./inventoryBacked";

const baseItem: TimelineItem = {
  id: "item-1",
  categoryId: "profile-1",
  groupId: "lenses",
  categoryName: "巩膜镜（L）",
  label: "镜片 1",
  detail: "使用中",
  location: "家",
  startDate: "2026-07-31",
  endDate: null,
  status: "active"
};

describe("filterInventoryBackedItems", () => {
  it("keeps only instances linked to both a product and source stock lot", () => {
    const backed = {
      ...baseItem,
      productId: "product-1",
      sourceStockLotId: "lot-1"
    };

    expect(
      filterInventoryBackedItems([
        baseItem,
        { ...baseItem, id: "item-2", productId: "product-1" },
        backed
      ])
    ).toEqual([backed]);
  });
});
