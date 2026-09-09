import { describe, expect, it } from "vitest";
import {
  reusableCycleActualEndDate,
  reusableCycleEndIsValid,
  reusableCycleStartIsValid
} from "./reusableCycle";

describe("reusable lens cycle dates", () => {
  it("allows replacing a lens on its actual final usage day", () => {
    expect(reusableCycleActualEndDate("2026-08-26")).toBe("2026-08-25");
    expect(reusableCycleStartIsValid("2026-08-26", "2026-08-25")).toBe(true);
    expect(reusableCycleEndIsValid("2026-08-26", "2026-08-25")).toBe(true);
  });

  it("rejects a replacement before the preceding lens actually ended", () => {
    expect(reusableCycleStartIsValid("2026-08-26", "2026-08-24")).toBe(false);
    expect(reusableCycleEndIsValid("2026-08-27", "2026-08-25")).toBe(false);
  });
});
