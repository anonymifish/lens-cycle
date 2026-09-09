import type {
  EyeSide,
  ItemProfile,
  ManagementTemplate,
  StandardType
} from "./catalog.types";
import type { TimelineGroupId } from "../timeline/timeline.types";

export const groupLabels: Record<TimelineGroupId, string> = {
  lenses: "镜片",
  periodic: "周期更换用品",
  consumables: "消耗品"
};

export const managementTemplateLabels: Record<ManagementTemplate, string> = {
  rigid_long_term: "长期硬镜",
  soft_daily: "日抛软镜",
  soft_reusable: "多天使用软镜",
  lens_case: "镜盒",
  lens_accessory: "镜片用品",
  opened_container: "开封瓶连续消耗",
  discrete_dose: "离散剂量消耗",
  batch_consumable: "批次定量消耗"
};

export const standardTypeLabels: Record<StandardType, string> = {
  ortho_k: "OK 镜",
  rgp: "RGP",
  scleral: "巩膜镜",
  rigid_other: "其他硬镜",
  soft_daily: "日抛软性隐形眼镜",
  soft_reusable: "多天使用软性隐形眼镜",
  lens_case: "镜盒",
  lens_applicator: "摘戴吸棒",
  column_bottle: "柱形瓶",
  protein_removal_bottle: "除蛋白瓶",
  care_solution: "护理液",
  eye_drops: "滴眼液",
  protein_removal_solution: "除蛋白液",
  saline: "生理盐水"
};

export const templatesByGroup: Record<TimelineGroupId, ManagementTemplate[]> = {
  lenses: ["rigid_long_term", "soft_daily", "soft_reusable"],
  periodic: ["lens_case", "lens_accessory"],
  consumables: ["opened_container", "discrete_dose", "batch_consumable"]
};

export const typesByTemplate: Record<ManagementTemplate, StandardType[]> = {
  rigid_long_term: ["ortho_k", "rgp", "scleral", "rigid_other"],
  soft_daily: ["soft_daily"],
  soft_reusable: ["soft_reusable"],
  lens_case: ["lens_case"],
  lens_accessory: ["lens_applicator", "column_bottle", "protein_removal_bottle"],
  opened_container: ["care_solution", "eye_drops"],
  discrete_dose: ["protein_removal_solution"],
  batch_consumable: ["saline"]
};

export function defaultBaseUnitForTemplate(template: ManagementTemplate): string {
  if (
    template === "rigid_long_term" ||
    template === "soft_daily" ||
    template === "soft_reusable"
  ) {
    return "片";
  }
  if (template === "discrete_dose") return "对";
  if (template === "opened_container" || template === "batch_consumable") {
    return "瓶";
  }
  return "个";
}

export function itemProfileBaseUnit(profile?: Pick<ItemProfile, "baseUnit" | "managementTemplate">) {
  return profile?.baseUnit?.trim() ||
    (profile ? defaultBaseUnitForTemplate(profile.managementTemplate) : "个");
}

function reusableName(durationDays: number) {
  if (durationDays === 14) return "双周抛软性隐形眼镜";
  if (durationDays === 30) return "月抛软性隐形眼镜";
  if (durationDays === 365) return "年抛软性隐形眼镜";
  return `${durationDays}天更换软性隐形眼镜`;
}

export function defaultProfileName(
  standardType: StandardType,
  side?: EyeSide,
  durationDays = 14,
  customStandardTypeName?: string
) {
  const baseName =
    customStandardTypeName?.trim() ||
    (standardType === "soft_reusable"
      ? reusableName(durationDays)
      : standardTypeLabels[standardType]);
  return side ? `${baseName}（${side}）` : baseName;
}

export const initialItemProfiles: ItemProfile[] = [
  {
    id: "scleral-l",
    groupId: "lenses",
    managementTemplate: "rigid_long_term",
    standardType: "scleral",
    name: "巩膜镜（L）",
    baseUnit: "片",
    side: "L",
    active: true,
    order: 0
  },
  {
    id: "soft-r-daily",
    groupId: "lenses",
    managementTemplate: "soft_daily",
    standardType: "soft_daily",
    name: "日抛软性隐形眼镜（R）",
    baseUnit: "片",
    side: "R",
    active: true,
    order: 1
  },
  {
    id: "soft-r-biweekly",
    groupId: "lenses",
    managementTemplate: "soft_reusable",
    standardType: "soft_reusable",
    name: "双周抛软性隐形眼镜（R）",
    baseUnit: "片",
    side: "R",
    defaultDurationDays: 14,
    active: true,
    order: 2
  },
  {
    id: "case-scleral-l",
    groupId: "periodic",
    managementTemplate: "lens_case",
    standardType: "lens_case",
    name: "镜盒",
    baseUnit: "个",
    defaultDurationDays: 90,
    active: true,
    order: 0
  },
  {
    id: "plunger-l",
    groupId: "periodic",
    managementTemplate: "lens_accessory",
    standardType: "lens_applicator",
    name: "摘戴吸棒",
    baseUnit: "个",
    defaultDurationDays: 120,
    active: true,
    order: 1
  },
  {
    id: "solution-scleral-1",
    groupId: "consumables",
    managementTemplate: "opened_container",
    standardType: "care_solution",
    name: "巩膜镜护理液 · 清洁",
    baseUnit: "瓶",
    active: true,
    order: 0
  },
  {
    id: "solution-scleral-2",
    groupId: "consumables",
    managementTemplate: "opened_container",
    standardType: "care_solution",
    name: "巩膜镜护理液 · 润滑",
    baseUnit: "瓶",
    active: true,
    order: 1
  },
  {
    id: "saline",
    groupId: "consumables",
    managementTemplate: "batch_consumable",
    standardType: "saline",
    name: "生理盐水",
    baseUnit: "瓶",
    active: true,
    order: 2
  },
  {
    id: "eye-drops",
    groupId: "consumables",
    managementTemplate: "opened_container",
    standardType: "eye_drops",
    name: "滴眼液",
    baseUnit: "瓶",
    active: true,
    order: 3
  },
  {
    id: "protein-removal-solution",
    groupId: "consumables",
    managementTemplate: "discrete_dose",
    standardType: "protein_removal_solution",
    name: "除蛋白液",
    baseUnit: "对",
    active: true,
    order: 4
  }
];
