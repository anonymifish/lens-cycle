import { describe, expect, it } from "vitest";
import { normalizeTimelineItems } from "./normalizedSchema";

describe("normalized instance schema", () => {
  it("separates base instances, state intervals and eye assignments", () => {
    const normalized = normalizeTimelineItems(
      [
        {
          id: "case-1",
          categoryId: "case",
          groupId: "periodic",
          categoryName: "镜盒",
          productId: "product-1",
          sourceStockLotId: "lot-1",
          label: "镜盒 1",
          detail: "",
          location: "家",
          locationId: "home",
          startDate: "2026-08-01",
          endDate: null,
          status: "active",
          stateIntervals: [
            { startDate: "2026-08-01", endDate: null, status: "active" }
          ],
          eyeAssignmentIntervals: [
            {
              startDate: "2026-08-01",
              endDate: null,
              eyeSides: ["L"]
            }
          ]
        }
      ],
      new Map([["case", "lens_case"]])
    );
    expect(normalized.instances[0]?.endDateExclusive).toBeNull();
    expect(normalized.stateIntervals).toHaveLength(1);
    expect(normalized.eyeAssignmentIntervals[0]?.eyeSides).toEqual(["L"]);
  });

  it("normalizes location history, reusable cycles, consumable details, and forecasts", () => {
    const normalized = normalizeTimelineItems(
      [
        {
          id: "reusable-1",
          categoryId: "reusable",
          groupId: "lenses",
          categoryName: "双周抛（R）",
          productId: "product-1",
          sourceStockLotId: "lot-1",
          label: "镜片盒 1",
          detail: "",
          location: "办公室",
          locationId: "office",
          locationIntervals: [
            {
              locationId: "home",
              startDate: "2026-08-01",
              endDate: "2026-08-05"
            },
            {
              locationId: "office",
              startDate: "2026-08-05",
              endDate: null
            }
          ],
          startDate: "2026-08-01",
          endDate: null,
          predictionDate: "2026-08-14",
          initialUnitQuantity: 6,
          inventorySourceKind: "package",
          reusableLensCycles: [
            {
              id: "cycle-1",
              label: "镜片 1",
              startDate: "2026-08-01",
              endDate: null,
              predictionDate: "2026-08-14",
              status: "active"
            }
          ],
          status: "active"
        },
        {
          id: "container-1",
          categoryId: "container",
          groupId: "consumables",
          categoryName: "护理液",
          productId: "product-2",
          sourceStockLotId: "lot-2",
          label: "护理液 1",
          detail: "",
          location: "家",
          locationId: "home",
          startDate: "2026-08-01",
          endDate: null,
          predictionDate: "2026-08-20",
          openedExpiryDate: "2026-09-01",
          depletionPredictionDate: "2026-08-20",
          capacityMl: 120,
          usageRatePerDay: 6,
          status: "active"
        },
        {
          id: "current-with-stock",
          categoryId: "reusable",
          groupId: "lenses",
          categoryName: "当前数据",
          productId: "product-3",
          sourceStockLotId: "lot-3",
          label: "当前数据",
          detail: "",
          location: "家",
          locationId: "home",
          locationIntervals: [
            { locationId: "home", startDate: "2026-08-01", endDate: null }
          ],
          startDate: "2026-08-01",
          endDate: null,
          status: "active"
        }
      ],
      new Map([
        ["reusable", "soft_reusable"],
        ["container", "opened_container"]
      ])
    );

    expect(normalized.instances).toHaveLength(3);
    expect(normalized.locationIntervals).toHaveLength(3);
    expect(normalized.reusableLensCycles[0]).toMatchObject({
      id: "cycle-1",
      instanceId: "reusable-1",
      predictedEndDate: "2026-08-14"
    });
    expect(normalized.consumableDetails).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          instanceId: "reusable-1",
          initialUnitQuantity: 6,
          inventorySourceKind: "package"
        }),
        expect.objectContaining({
          instanceId: "container-1",
          capacityMlAtActivation: 120
        })
      ])
    );
    expect(normalized.forecastSnapshots).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          instanceId: "container-1",
          method: "historical_rate",
          estimatedRatePerDay: 6
        })
      ])
    );
  });
});
