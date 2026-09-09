import { describe, expect, it } from "vitest";
import type { ItemProfile } from "../../catalog/catalog.types";
import type { Product } from "../../inventory/inventory.types";
import type { TimelineItem } from "../timeline.types";
import {
  batchConsumptionPredictionDate,
  consumptionPredictionDate,
  fallbackConsumptionRate,
  historicalBatchConsumptionRateUnitsPerDay,
  historicalConsumptionRateMlPerDay,
  inclusiveCycleEndDate
} from "./forecast";

const profile = {
  id: "care",
  groupId: "consumables",
  managementTemplate: "opened_container",
  standardType: "care_solution",
  name: "护理液",
  active: true,
  order: 0
} satisfies ItemProfile;

function completed(id: string, startDate: string, endDate: string, capacityMl: number): TimelineItem {
  return {
    id,
    categoryId: profile.id,
    groupId: "consumables",
    categoryName: profile.name,
    label: id,
    detail: "",
    location: "家",
    startDate,
    endDate,
    capacityMl,
    status: "completed",
    stateIntervals: [{ startDate, endDate, status: "active" }]
  };
}

describe("forecast rules", () => {
  it("treats the activation date as day one", () => {
    expect(inclusiveCycleEndDate("2026-07-01", 14)).toBe("2026-07-14");
  });

  it("predicts depletion from capacity and average daily millilitres", () => {
    expect(consumptionPredictionDate("2026-07-01", 120, 10)).toBe("2026-07-12");
  });

  it("recalculates batch depletion from activation date and paused days", () => {
    expect(batchConsumptionPredictionDate("2026-08-23", 120, 1)).toBe(
      "2026-12-20"
    );
    expect(batchConsumptionPredictionDate("2026-08-23", 120, 1, 2)).toBe(
      "2026-12-22"
    );
  });

  it("supports all history, recent year and recent product count", () => {
    const items = [
      completed("old", "2024-01-01", "2024-01-11", 100),
      completed("new-a", "2026-06-01", "2026-06-11", 200),
      completed("new-b", "2026-07-01", "2026-07-11", 300)
    ];
    expect(historicalConsumptionRateMlPerDay(items, [profile], { range: "all", recentProductCount: 1 }, "2026-08-01")).toBeCloseTo(20);
    expect(historicalConsumptionRateMlPerDay(items, [profile], { range: "recent_year", recentProductCount: 1 }, "2026-08-01")).toBeCloseTo(25);
    expect(historicalConsumptionRateMlPerDay(items, [profile], { range: "recent_products", recentProductCount: 1 }, "2026-08-01")).toBeCloseTo(30);
  });

  it("excludes paused days from historical consumption speed", () => {
    const item = completed("paused", "2026-07-01", "2026-07-11", 70);
    item.stateIntervals = [
      { startDate: "2026-07-01", endDate: "2026-07-04", status: "active" },
      { startDate: "2026-07-04", endDate: "2026-07-07", status: "paused" },
      { startDate: "2026-07-07", endDate: "2026-07-11", status: "active" }
    ];
    expect(
      historicalConsumptionRateMlPerDay(
        [item],
        [profile],
        { range: "all", recentProductCount: 3 },
        "2026-08-01"
      )
    ).toBe(10);
  });

  it("filters historical samples by product, profile, or standard type", () => {
    const otherProfile = { ...profile, id: "care-other" };
    const first = { ...completed("a", "2026-07-01", "2026-07-11", 100), productId: "p1" };
    const second = {
      ...completed("b", "2026-07-01", "2026-07-11", 200),
      productId: "p2",
      categoryId: otherProfile.id
    };
    const settings = { range: "all" as const, recentProductCount: 3 };

    expect(
      historicalConsumptionRateMlPerDay(
        [first, second],
        [profile, otherProfile],
        settings,
        "2026-08-01",
        {
          scope: "same_product",
          standardType: "care_solution",
          profileId: profile.id,
          productId: "p1"
        }
      )
    ).toBe(10);
    expect(
      historicalConsumptionRateMlPerDay(
        [first, second],
        [profile, otherProfile],
        settings,
        "2026-08-01",
        {
          scope: "same_standard_type",
          standardType: "care_solution",
          profileId: profile.id,
          productId: "p1"
        }
      )
    ).toBe(15);
  });

  it("rounds partial consumption days up and still treats start as day one", () => {
    expect(consumptionPredictionDate("2026-07-01", 121, 10)).toBe(
      "2026-07-13"
    );
  });

  it("estimates batch-consumable units per active day from completed instances", () => {
    const salineProfile = {
      ...profile,
      id: "saline",
      managementTemplate: "batch_consumable",
      standardType: "saline",
      name: "生理盐水"
    } satisfies ItemProfile;
    const salineItem = {
      ...completed("saline-history", "2026-07-01", "2026-07-11", 0),
      categoryId: salineProfile.id,
      categoryName: salineProfile.name,
      initialUnitQuantity: 20
    };

    expect(
      historicalBatchConsumptionRateUnitsPerDay(
        [salineItem],
        [salineProfile],
        { range: "all", recentProductCount: 3 },
        "2026-08-01"
      )
    ).toBe(2);
  });

  it("ignores incomplete history and applies every fallback-rate source", () => {
    const active = { ...completed("active", "2026-07-01", "2026-07-11", 100), status: "active" as const };
    const missingEnd = { ...completed("missing-end", "2026-07-01", "2026-07-11", 100), endDate: null };
    const empty = completed("empty", "2026-07-01", "2026-07-11", 0);
    const missingProfile = { ...completed("missing-profile", "2026-07-01", "2026-07-11", 100), categoryId: "missing" };
    expect(historicalConsumptionRateMlPerDay(
      [active, missingEnd, empty, missingProfile], [profile],
      { range: "all", recentProductCount: 3 }, "2026-08-01"
    )).toBeNull();

    const batchProfile = {
      ...profile,
      id: "batch",
      managementTemplate: "batch_consumable",
      standardType: "saline",
      name: "盐水"
    } satisfies ItemProfile;
    const zeroBatch = {
      ...completed("zero-batch", "2026-07-01", "2026-07-11", 0),
      categoryId: batchProfile.id,
      initialUnitQuantity: 0
    };
    expect(historicalBatchConsumptionRateUnitsPerDay(
      [zeroBatch], [batchProfile], { range: "all", recentProductCount: 3 }, "2026-08-01"
    )).toBeNull();

    const product = {
      id: "care-product", itemProfileId: profile.id, standardType: "care_solution",
      brand: "护理液", baseUnit: "瓶", unitsPerPackage: 1, active: true
    } satisfies Product;
    expect(fallbackConsumptionRate({ ...product, capacityMl: 0 }, profile)).toBeNull();
    expect(fallbackConsumptionRate({ ...product, capacityMl: 120 }, { ...profile, defaultDurationDays: 60 })).toBe(2);
    expect(fallbackConsumptionRate({ ...product, capacityMl: 120, defaultDurationDays: 30 }, profile)).toBe(4);
    expect(fallbackConsumptionRate({ ...product, capacityMl: 90 })).toBe(1);
    expect(inclusiveCycleEndDate("2026-07-01", 0)).toBe("2026-07-01");
    expect(batchConsumptionPredictionDate("2026-07-01", -1, 0, -2)).toBe("2026-07-01");
  });
});
