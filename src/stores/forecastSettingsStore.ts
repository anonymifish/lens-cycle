import { create } from "zustand";

export type ConsumptionHistoryRange = "all" | "recent_year" | "recent_products";
export type ConsumptionHistoryScope = "same_product" | "same_profile" | "same_standard_type";

interface ForecastSettingsState {
  consumptionHistoryRange: ConsumptionHistoryRange;
  recentProductCount: number;
  consumptionHistoryScope: ConsumptionHistoryScope;
  setConsumptionHistoryRange: (range: ConsumptionHistoryRange) => void;
  setRecentProductCount: (count: number) => void;
  setConsumptionHistoryScope: (scope: ConsumptionHistoryScope) => void;
}

export const useForecastSettingsStore = create<ForecastSettingsState>()(
  (set) => ({
    consumptionHistoryRange: "all",
    recentProductCount: 3,
    consumptionHistoryScope: "same_profile",
    setConsumptionHistoryRange: (consumptionHistoryRange) =>
      set({ consumptionHistoryRange }),
    setRecentProductCount: (count) =>
      set({ recentProductCount: Math.max(1, Math.floor(count)) }),
    setConsumptionHistoryScope: (consumptionHistoryScope) =>
      set({ consumptionHistoryScope })
  })
);
