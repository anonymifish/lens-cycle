import { beforeEach, describe, expect, it } from "vitest";
import { useInventoryStore } from "../../stores/inventoryStore";
import { useTimelineItemStore } from "../../stores/timelineItemStore";
import { useTimelineCareEventStore } from "../../stores/timelineCareEventStore";
import { useUsageFactStore } from "../../stores/usageFactStore";
import { runLocalDataTransaction } from "./localDataTransaction";

describe("local data transaction", () => {
  beforeEach(() => {
    useInventoryStore.setState({ products: [], lots: [], transactions: [] });
    useTimelineItemStore.setState({ items: [] });
    useUsageFactStore.setState({ facts: [] });
    useTimelineCareEventStore.setState({ events: [] });
  });

  it("rolls every store back when a command fails", () => {
    expect(() =>
      runLocalDataTransaction(() => {
        useInventoryStore.setState({
          transactions: [
            {
              id: "tx-1",
              stockLotId: "lot-1",
              occurredDate: "2026-08-01",
              type: "consume",
              quantityDelta: -1
            }
          ]
        });
        useTimelineItemStore.setState({
          items: [
            {
              id: "item-1",
              categoryId: "profile-1",
              groupId: "lenses",
              categoryName: "测试",
              productId: "product-1",
              sourceStockLotId: "lot-1",
              label: "测试",
              detail: "",
              location: "家",
              startDate: "2026-08-01",
              endDate: null,
              status: "active"
            }
          ]
        });
        useUsageFactStore.setState({
          facts: [
            {
              id: "fact-1",
              itemId: "item-1",
              stockLotId: "lot-1",
              transactionId: "tx-1",
              date: "2026-08-01",
              kind: "wear",
              quantity: 1
            }
          ]
        });
        useTimelineCareEventStore.setState({
          events: [
            {
              id: "care-1",
              itemId: "item-1",
              kind: "review",
              plannedDate: "2026-08-10"
            }
          ]
        });
        throw new Error("failed");
      })
    ).toThrow("failed");
    expect(useInventoryStore.getState().transactions).toEqual([]);
    expect(useTimelineItemStore.getState().items).toEqual([]);
    expect(useUsageFactStore.getState().facts).toEqual([]);
    expect(useTimelineCareEventStore.getState().events).toEqual([]);
  });

  it("commits every store when the operation succeeds", () => {
    const result = runLocalDataTransaction(() => {
      useInventoryStore.setState({
        transactions: [
          {
            id: "tx-1",
            stockLotId: "lot-1",
            occurredDate: "2026-08-01",
            type: "correction",
            quantityDelta: 1
          }
        ]
      });
      useTimelineCareEventStore.setState({
        events: [
          {
            id: "care-1",
            itemId: "item-1",
            kind: "protein",
            plannedDate: "2026-08-10"
          }
        ]
      });
      return "committed";
    });

    expect(result).toBe("committed");
    expect(useInventoryStore.getState().transactions).toHaveLength(1);
    expect(useTimelineCareEventStore.getState().events).toHaveLength(1);
  });
});
