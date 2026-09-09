import { beforeEach, describe, expect, it } from "vitest";
import { useInventoryStore } from "./inventoryStore";
import { useItemProfileStore } from "./itemProfileStore";
import { useTimelineItemStore } from "./timelineItemStore";

const validProfile = {
  groupId: "lenses" as const,
  managementTemplate: "soft_reusable" as const,
  standardType: "soft_reusable" as const,
  standardTypeName: "双周抛",
  name: "双周抛软性隐形眼镜（R）",
  baseUnit: "片",
  side: "R" as const,
  defaultDurationDays: 14
};
const profileWithoutSide = {
  groupId: validProfile.groupId,
  managementTemplate: validProfile.managementTemplate,
  standardType: validProfile.standardType,
  standardTypeName: validProfile.standardTypeName,
  name: validProfile.name,
  defaultDurationDays: validProfile.defaultDurationDays
};

describe("item profile store invariants", () => {
  beforeEach(() => {
    useItemProfileStore.setState({ profiles: [] });
    useInventoryStore.setState({ products: [], lots: [], transactions: [] });
    useTimelineItemStore.setState({ items: [] });
  });

  it("creates a valid profile with a normalized group order", () => {
    const id = useItemProfileStore.getState().addProfile(validProfile);
    expect(useItemProfileStore.getState().profiles[0]).toMatchObject({
      id,
      active: true,
      order: 0,
      side: "R",
      defaultDurationDays: 14
    });
  });

  it.each([
    [{ ...validProfile, name: "" }, "用品配置名称和标准类型名称不能为空"],
    [{ ...validProfile, standardTypeName: "" }, "用品配置名称和标准类型名称不能为空"],
    [{ ...validProfile, baseUnit: "" }, "基础单位不能为空"],
    [
      { ...validProfile, groupId: "periodic" as const },
      "管理模板与大类不一致"
    ],
    [
      { ...validProfile, standardType: "scleral" as const },
      "标准类型与管理模板不一致"
    ],
    [profileWithoutSide, "镜片配置必须选择眼别"],
    [{
      ...validProfile, groupId: "periodic" as const,
      managementTemplate: "lens_case" as const, standardType: "lens_case" as const
    }, "非镜片配置不能设置眼别"],
    [{ ...validProfile, defaultDurationDays: 0 }, "默认周期必须是正整数"]
    ,[{ ...validProfile, defaultDurationDays: 1.5 }, "默认周期必须是正整数"]
  ])("rejects malformed profile input %#", (profile, message) => {
    expect(() => useItemProfileStore.getState().addProfile(profile)).toThrow(
      message
    );
    expect(useItemProfileStore.getState().profiles).toEqual([]);
  });

  it("blocks deleting a profile referenced by a product", () => {
    const id = useItemProfileStore.getState().addProfile(validProfile);
    useInventoryStore.setState({
      products: [
        {
          id: "product-1",
          itemProfileId: id,
          standardType: "soft_reusable",
          brand: "测试",
          baseUnit: "片",
          unitsPerPackage: 6,
          active: true
        }
      ]
    });
    expect(() => useItemProfileStore.getState().deleteProfile(id)).toThrow(
      "已有产品或时间轴记录，不能删除用品配置"
    );
    expect(useItemProfileStore.getState().profiles).toHaveLength(1);
  });

  it("synchronizes a changed configuration unit to related products", () => {
    const id = useItemProfileStore.getState().addProfile(validProfile);
    useInventoryStore.setState({
      products: [
        {
          id: "product-1",
          itemProfileId: id,
          standardType: "soft_reusable",
          brand: "测试",
          baseUnit: "片",
          unitsPerPackage: 6,
          active: true
        }
      ]
    });

    useItemProfileStore.getState().updateProfile(id, {
      standardType: "soft_reusable",
      standardTypeName: "双周抛",
      name: "双周抛软性隐形眼镜（R）",
      baseUnit: "枚",
      side: "R",
      defaultDurationDays: 14
    });

    expect(useItemProfileStore.getState().profiles[0]?.baseUnit).toBe("枚");
    expect(useInventoryStore.getState().products[0]?.baseUnit).toBe("枚");
  });

  it("allows deleting an unreferenced profile and normalizes sibling order", () => {
    const first = useItemProfileStore.getState().addProfile(validProfile);
    const second = useItemProfileStore.getState().addProfile({
      ...validProfile,
      name: "月抛软性隐形眼镜（L）",
      standardTypeName: "月抛",
      side: "L",
      defaultDurationDays: 30
    });
    useItemProfileStore.getState().deleteProfile(first);
    expect(useItemProfileStore.getState().profiles).toEqual([
      expect.objectContaining({ id: second, order: 0 })
    ]);
  });

  it("renames, reorders, and toggles existing profiles", () => {
    const first = useItemProfileStore.getState().addProfile(validProfile);
    const second = useItemProfileStore.getState().addProfile({ ...validProfile, name: "第二行" });
    const store = useItemProfileStore.getState();

    store.renameProfile(first, "  已重命名  ");
    expect(useItemProfileStore.getState().profiles.find((profile) => profile.id === first)?.name)
      .toBe("已重命名");
    store.moveProfile(second, -1);
    expect([...useItemProfileStore.getState().profiles].sort((a, b) => a.order - b.order)
      .map((profile) => profile.id)).toEqual([second, first]);
    store.setProfileActive(first, false);
    expect(useItemProfileStore.getState().profiles.find((profile) => profile.id === first)?.active)
      .toBe(false);

    store.moveProfile("missing", 1);
    store.moveProfile(first, 1);
    store.deleteProfile("missing");
    expect(() => store.renameProfile(first, " ")).toThrow("用品配置名称不能为空");
    expect(() => store.setProfileActive("missing", true)).toThrow("用品配置不存在");
    expect(() => store.updateProfile("missing", validProfile)).toThrow("用品配置不存在");
  });

  it("blocks deleting a profile referenced by timeline history", () => {
    const id = useItemProfileStore.getState().addProfile(validProfile);
    useTimelineItemStore.setState({ items: [{
      id: "history", categoryId: id, groupId: "lenses", categoryName: "测试",
      label: "历史", detail: "", location: "家", startDate: "2026-01-01",
      endDate: "2026-01-02", status: "completed"
    }] });
    expect(() => useItemProfileStore.getState().deleteProfile(id)).toThrow(
      "已有产品或时间轴记录，不能删除用品配置"
    );
  });
});
