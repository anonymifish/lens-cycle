import type { TimelineItem } from "../timeline.types";

export function filterInventoryBackedItems(items: TimelineItem[]) {
  return items.filter(
    (item) => Boolean(item.productId) && Boolean(item.sourceStockLotId)
  );
}
