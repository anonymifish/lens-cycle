import { beforeEach, describe, expect, it } from "vitest";
import { useForecastSettingsStore } from "./forecastSettingsStore";
import { defaultTimelinePalette, useTimelineThemeStore } from "./timelineThemeStore";
import { useTimelineViewportStore } from "./timelineViewportStore";
import { useUsageFactStore } from "./usageFactStore";

describe("simple application stores", () => {
  beforeEach(() => {
    useForecastSettingsStore.setState({
      consumptionHistoryRange: "all", recentProductCount: 3,
      consumptionHistoryScope: "same_profile"
    });
    useTimelineThemeStore.setState({ palette: defaultTimelinePalette });
    useUsageFactStore.setState({ facts: [] });
  });

  it("updates forecast preferences and clamps the recent-product count", () => {
    const state = useForecastSettingsStore.getState();
    state.setConsumptionHistoryRange("recent_products");
    state.setConsumptionHistoryScope("same_product");
    state.setRecentProductCount(0.9);
    expect(useForecastSettingsStore.getState()).toMatchObject({
      consumptionHistoryRange: "recent_products", consumptionHistoryScope: "same_product",
      recentProductCount: 1
    });
  });

  it("updates and resets timeline colors", () => {
    useTimelineThemeStore.getState().setColor("danger", "#000000");
    expect(useTimelineThemeStore.getState().palette.danger).toBe("#000000");
    useTimelineThemeStore.getState().resetPalette();
    expect(useTimelineThemeStore.getState().palette).toEqual(defaultTimelinePalette);
  });

  it("resizes, replaces, and expands the timeline viewport", () => {
    const viewport = { centerDate: "2026-09-06" as const, pixelsPerDay: 5, viewportWidth: 800 };
    useTimelineViewportStore.getState().setViewport(viewport);
    useTimelineViewportStore.getState().setViewportWidth(640);
    const before = useTimelineViewportStore.getState().expandedGroups.lenses;
    useTimelineViewportStore.getState().toggleGroup("lenses");
    expect(useTimelineViewportStore.getState().viewport.viewportWidth).toBe(640);
    expect(useTimelineViewportStore.getState().expandedGroups.lenses).toBe(!before);
  });

  it("adds, updates, and deletes usage facts", () => {
    const fact = {
      id: "fact-1", itemId: "item-1", stockLotId: "lot-1", transactionId: "tx-1",
      date: "2026-09-06" as const, kind: "wear" as const, quantity: 1
    };
    const other = { ...fact, id: "fact-2", itemId: "item-2", transactionId: "tx-2" };
    useUsageFactStore.getState().addFact(fact);
    useUsageFactStore.getState().addFact(other);
    useUsageFactStore.getState().updateFact("fact-1", { ...fact, quantity: 2 });
    expect(useUsageFactStore.getState().facts[0]?.quantity).toBe(2);
    useUsageFactStore.getState().deleteFact("fact-2");
    useUsageFactStore.getState().deleteFactsForItem("item-1");
    expect(useUsageFactStore.getState().facts).toEqual([]);
  });
});
