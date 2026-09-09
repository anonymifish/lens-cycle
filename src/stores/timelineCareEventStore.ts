import { create } from "./atomicStore";
import type {
  LensCareEvent,
  LensCareEventKind
} from "../features/timeline/timeline.types";
import type { LocalDate } from "../shared/dates/localDate";
import { useTimelineItemStore } from "./timelineItemStore";
import { useItemProfileStore } from "./itemProfileStore";

function validateCareEvent(input: {
  itemId: string;
  plannedDate?: LocalDate;
  completedDate?: LocalDate;
}) {
  const item = useTimelineItemStore
    .getState()
    .items.find((entry) => entry.id === input.itemId);
  if (!item) throw new Error("使用实例不存在");
  const profile = useItemProfileStore
    .getState()
    .profiles.find((entry) => entry.id === item.categoryId);
  if (profile?.managementTemplate !== "rigid_long_term")
    throw new Error("护理事件只能关联长期硬镜实例");
  if (!input.plannedDate && !input.completedDate)
    throw new Error("护理事件至少需要计划或完成日期");
  for (const date of [input.plannedDate, input.completedDate]) {
    if (
      date &&
      (date < item.startDate || (item.endDate !== null && date >= item.endDate))
    )
      throw new Error("护理事件日期不在实例生命周期内");
  }
}

interface TimelineCareEventState {
  events: LensCareEvent[];
  addEvent: (event: {
    itemId: string;
    kind: LensCareEventKind;
    plannedDate?: LocalDate;
    completedDate?: LocalDate;
  }) => string;
  updateEvent: (
    id: string,
    changes: {
      kind: LensCareEventKind;
      plannedDate: LocalDate | undefined;
      completedDate: LocalDate | undefined;
    }
  ) => void;
  completeEvent: (id: string, completedDate: LocalDate) => void;
  deleteEvent: (id: string) => void;
  deleteEventsForItem: (itemId: string) => void;
}

export const useTimelineCareEventStore = create<TimelineCareEventState>()(
  (set) => ({
      events: [],
      addEvent: (event) => {
        validateCareEvent(event);
        const id = `care-event-${crypto.randomUUID()}`;
        set((state) => ({ events: [...state.events, { ...event, id }] }));
        return id;
      },
      updateEvent: (id, changes) => {
        const source = useTimelineCareEventStore
          .getState()
          .events.find((event) => event.id === id);
        if (!source) throw new Error("护理事件不存在");
        validateCareEvent({
          itemId: source.itemId,
          ...(changes.plannedDate
            ? { plannedDate: changes.plannedDate }
            : {}),
          ...(changes.completedDate
            ? { completedDate: changes.completedDate }
            : {})
        });
        set((state) => ({
          events: state.events.map((event) => {
            if (event.id !== id) return event;
            return {
              id: event.id,
              itemId: event.itemId,
              kind: changes.kind,
              ...(changes.plannedDate
                ? { plannedDate: changes.plannedDate }
                : {}),
              ...(changes.completedDate
                ? { completedDate: changes.completedDate }
                : {})
            };
          })
        }));
      },
      completeEvent: (id, completedDate) => {
        const source = useTimelineCareEventStore
          .getState()
          .events.find((event) => event.id === id);
        if (!source) throw new Error("护理事件不存在");
        validateCareEvent({ ...source, completedDate });
        set((state) => ({
          events: state.events.map((event) =>
            event.id === id ? { ...event, completedDate } : event
          )
        }));
      },
      deleteEvent: (id) =>
        set((state) => ({
          events: state.events.filter((event) => event.id !== id)
        })),
      deleteEventsForItem: (itemId) =>
        set((state) => ({
          events: state.events.filter((event) => event.itemId !== itemId)
        }))
  })
);
