import { describe, expect, it } from "vitest";
import { applyLensCaseEyeSwitch, lensCasePredictionDate } from "./lensCase";

describe("lens case prediction", () => {
  it("returns no prediction when the case is not assigned to an eye", () => {
    expect(lensCasePredictionDate([], new Map(), 90, "2026-08-25")).toBeNull();
  });

  it("starts eye history when there is no previous assignment", () => {
    expect(applyLensCaseEyeSwitch([], "2026-08-25", ["R"])).toEqual([
      { startDate: "2026-08-25", endDate: null, eyeSides: ["R"] }
    ]);
  });

  it("closes the previous assignment when switching on a later day", () => {
    expect(applyLensCaseEyeSwitch(
      [{ startDate: "2026-08-20", endDate: null, eyeSides: ["L"] }],
      "2026-08-25",
      ["R"]
    )).toEqual([
      { startDate: "2026-08-20", endDate: "2026-08-25", eyeSides: ["L"] },
      { startDate: "2026-08-25", endDate: null, eyeSides: ["R"] }
    ]);
  });

  it("recalculates a single-eye replacement date from accumulated days", () => {
    expect(
      lensCasePredictionDate(["L"], new Map([["L", 90]]), 90, "2026-08-25")
    ).toBe("2026-08-25");
  });

  it("uses the earlier remaining lifetime when both eyes are active", () => {
    expect(
      lensCasePredictionDate(
        ["L", "R"],
        new Map([
          ["L", 10],
          ["R", 20]
        ]),
        90,
        "2026-08-25"
      )
    ).toBe("2026-11-03");
  });

  it("updates rather than appends a second eye switch on the same day", () => {
    const intervals = applyLensCaseEyeSwitch(
      [
        { startDate: "2026-05-28", endDate: "2026-08-25", eyeSides: ["L"] },
        { startDate: "2026-08-25", endDate: null, eyeSides: ["R"] }
      ],
      "2026-08-25",
      ["L", "R"]
    );

    expect(intervals).toHaveLength(2);
    expect(intervals.at(-1)).toEqual({
      startDate: "2026-08-25",
      endDate: null,
      eyeSides: ["L", "R"]
    });
  });
});
