import { describe, expect, it } from "vitest";
import type { LensCareEvent } from "../timeline.types";
import { careEventDate, careEventLabel, careEventState } from "./careEvents";

const planned: LensCareEvent = {
  id: "event-1",
  itemId: "item-1",
  kind: "review",
  plannedDate: "2026-08-04"
};

describe("lens care events", () => {
  it("moves a plan into due state without completing it automatically", () => {
    expect(careEventState(planned, "2026-08-03")).toBe("planned");
    expect(careEventState(planned, "2026-08-04")).toBe("due");
    expect(careEventState(planned, "2026-08-20")).toBe("due");
  });

  it("uses the actual completion date and completed label after confirmation", () => {
    const completed = { ...planned, completedDate: "2026-08-06" };
    expect(careEventState(completed, "2026-08-06")).toBe("completed");
    expect(careEventDate(completed)).toBe("2026-08-06");
    expect(careEventLabel(completed)).toBe("复查");
    expect(careEventLabel(planned)).toBe("计划复查");
  });
});
