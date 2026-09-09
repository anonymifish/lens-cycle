import { create } from "zustand";
import { formatLocalDate } from "../shared/dates/localDate";
import type { TimelineGroupId, TimelineViewport } from "../features/timeline/timeline.types";

interface TimelineViewportState {
  viewport: TimelineViewport;
  expandedGroups: Record<TimelineGroupId, boolean>;
  setViewport: (viewport: TimelineViewport) => void;
  setViewportWidth: (width: number) => void;
  toggleGroup: (groupId: TimelineGroupId) => void;
}

export const useTimelineViewportStore = create<TimelineViewportState>((set) => ({
  viewport: {
    centerDate: formatLocalDate(new Date()),
    pixelsPerDay: 2.7,
    viewportWidth: 900
  },
  expandedGroups: {
    lenses: true,
    periodic: true,
    consumables: true
  },
  setViewport: (viewport) => set({ viewport }),
  setViewportWidth: (viewportWidth) =>
    set((state) => ({ viewport: { ...state.viewport, viewportWidth } })),
  toggleGroup: (groupId) =>
    set((state) => ({
      expandedGroups: {
        ...state.expandedGroups,
        [groupId]: !state.expandedGroups[groupId]
      }
    }))
}));
