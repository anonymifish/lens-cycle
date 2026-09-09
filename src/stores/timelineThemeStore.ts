import { create } from "zustand";

export interface TimelinePalette {
  active: string;
  paused: string;
  completed: string;
  review: string;
  protein: string;
  forecast: string;
  historicalPaused: string;
  danger: string;
}

export const defaultTimelinePalette: TimelinePalette = {
  active: "#5b9f87",
  paused: "#d6a85f",
  completed: "#6f8fb8",
  review: "#6c9fc1",
  protein: "#a17fa3",
  forecast: "#c18a6a",
  historicalPaused: "#a8afb8",
  danger: "#c96b6b"
};

interface TimelineThemeState {
  palette: TimelinePalette;
  setColor: (key: keyof TimelinePalette, value: string) => void;
  resetPalette: () => void;
}

export const useTimelineThemeStore = create<TimelineThemeState>()(
  (set) => ({
    palette: defaultTimelinePalette,
    setColor: (key, value) =>
      set((state) => ({ palette: { ...state.palette, [key]: value } })),
    resetPalette: () => set({ palette: defaultTimelinePalette })
  })
);
