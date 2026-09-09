import { describe, expect, it } from "vitest";
import {
  defaultBaseUnitForTemplate,
  defaultProfileName,
  initialItemProfiles,
  templatesByGroup,
  typesByTemplate
} from "./catalog";

describe("defaultProfileName", () => {
  it("adds an eye suffix to rigid lenses", () => {
    expect(defaultProfileName("scleral", "L")).toBe("巩膜镜（L）");
  });

  it("uses familiar names for common reusable durations", () => {
    expect(defaultProfileName("soft_reusable", "R", 14)).toBe(
      "双周抛软性隐形眼镜（R）"
    );
    expect(defaultProfileName("soft_reusable", "L", 30)).toBe(
      "月抛软性隐形眼镜（L）"
    );
  });

  it("uses a day-based name for custom reusable durations", () => {
    expect(defaultProfileName("soft_reusable", "L", 21)).toBe(
      "21天更换软性隐形眼镜（L）"
    );
  });

  it("uses a custom standard type name while keeping the eye suffix rule", () => {
    expect(defaultProfileName("scleral", "R", 14, "夜戴硬镜")).toBe(
      "夜戴硬镜（R）"
    );
  });
});

describe("catalog hierarchy", () => {
  it("defaults batch consumables to bottles and gives built-ins explicit units", () => {
    expect(defaultBaseUnitForTemplate("batch_consumable")).toBe("瓶");
    expect(initialItemProfiles.every((profile) => profile.baseUnit?.trim())).toBe(true);
  });

  it("assigns every management template to exactly one top-level group", () => {
    const templates = Object.values(templatesByGroup).flat();
    expect(new Set(templates).size).toBe(templates.length);
    expect(new Set(templates)).toEqual(new Set(Object.keys(typesByTemplate)));
  });

  it("assigns every standard type to exactly one management template", () => {
    const types = Object.values(typesByTemplate).flat();
    expect(new Set(types).size).toBe(types.length);
    expect(types).toHaveLength(14);
  });

  it("keeps all built-in profiles consistent with the hierarchy and ordering", () => {
    initialItemProfiles.forEach((profile) => {
      expect(templatesByGroup[profile.groupId]).toContain(
        profile.managementTemplate
      );
      expect(typesByTemplate[profile.managementTemplate]).toContain(
        profile.standardType
      );
      if (profile.groupId === "lenses") expect(profile.side).toMatch(/^[LR]$/);
      else expect(profile.side).toBeUndefined();
    });
    Object.keys(templatesByGroup).forEach((groupId) => {
      const orders = initialItemProfiles
        .filter((profile) => profile.groupId === groupId)
        .map((profile) => profile.order);
      expect(new Set(orders).size).toBe(orders.length);
    });
  });
});
