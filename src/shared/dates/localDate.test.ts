import { describe, expect, it } from "vitest";
import {
  displayCompactLocalDate,
  displayLocalDate
} from "./localDate";
import { localDateInputError } from "./localDateInputValidation";

describe("local date display", () => {
  it("uses the Chinese long format for regular content", () => {
    expect(displayLocalDate("2026-09-02")).toBe("2026年09月02日");
  });

  it("uses ISO format for compact content", () => {
    expect(displayCompactLocalDate("2026-09-02")).toBe("2026-09-02");
  });

  it("uses context-appropriate empty text", () => {
    expect(displayLocalDate(undefined)).toBe("未填写");
    expect(displayCompactLocalDate(undefined)).toBe("—");
  });
});

describe("local date input validation", () => {
  it("rejects invalid and out-of-range dates", () => {
    expect(localDateInputError("2026-02-31")).toContain("有效日期");
    expect(localDateInputError("2026-08-31", "2026-09-01")).toBe(
      "日期不能早于 2026-09-01"
    );
    expect(localDateInputError("2026-09-03", undefined, "2026-09-02")).toBe(
      "日期不能晚于 2026-09-02"
    );
  });
});
