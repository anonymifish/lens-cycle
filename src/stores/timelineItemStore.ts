import { create } from "./atomicStore";
import { filterInventoryBackedItems } from "../features/timeline/domain/inventoryBacked";
import type {
  TimelineItem,
  TimelineItemDetailsUpdate
} from "../features/timeline/timeline.types";

type TimelineItemsUpdater =
  | TimelineItem[]
  | ((current: TimelineItem[]) => TimelineItem[]);

interface TimelineItemState {
  items: TimelineItem[];
  setItems: (updater: TimelineItemsUpdater) => void;
  addItem: (item: TimelineItem) => void;
  deleteItem: (id: string) => void;
  updateItemDetails: (
    id: string,
    changes: TimelineItemDetailsUpdate
  ) => void;
}

export const useTimelineItemStore = create<TimelineItemState>()(
  (set) => ({
      items: [],
      setItems: (updater) =>
        set((state) => ({
          items: filterInventoryBackedItems(
            typeof updater === "function" ? updater(state.items) : updater
          )
        })),
      addItem: (item) =>
        set((state) => ({
          items: filterInventoryBackedItems([...state.items, item])
        })),
      deleteItem: (id) =>
        set((state) => ({
          items: state.items.filter((item) => item.id !== id)
        })),
      updateItemDetails: (id, changes) =>
        set((state) => ({
          items: state.items.map((item) => {
            if (item.id !== id) return item;
            const updated: TimelineItem = {
              ...item,
              ...changes
            };
            return {
              ...updated,
              ...(item.stateIntervals
                ? {
                    stateIntervals: item.stateIntervals.map((interval, index) =>
                      index === 0
                        ? { ...interval, startDate: changes.startDate }
                        : interval
                    )
                  }
                : {}),
              ...(item.locationIntervals
                ? {
                    locationIntervals: item.locationIntervals.map(
                      (interval, index) =>
                        index === 0
                          ? { ...interval, startDate: changes.startDate }
                          : interval
                    )
                  }
                : {}),
              ...(item.eyeAssignmentIntervals
                ? {
                    eyeAssignmentIntervals: item.eyeAssignmentIntervals.map(
                      (interval, index) =>
                        index === 0
                          ? { ...interval, startDate: changes.startDate }
                          : interval
                    )
                  }
                : {})
            };
          })
        }))
  })
);
