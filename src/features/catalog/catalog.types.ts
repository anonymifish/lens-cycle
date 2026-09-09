import type { TimelineGroupId } from "../timeline/timeline.types";

export type ManagementTemplate =
  | "rigid_long_term"
  | "soft_daily"
  | "soft_reusable"
  | "lens_case"
  | "lens_accessory"
  | "opened_container"
  | "discrete_dose"
  | "batch_consumable";

export type StandardType =
  | "ortho_k"
  | "rgp"
  | "scleral"
  | "rigid_other"
  | "soft_daily"
  | "soft_reusable"
  | "lens_case"
  | "lens_applicator"
  | "column_bottle"
  | "protein_removal_bottle"
  | "care_solution"
  | "eye_drops"
  | "protein_removal_solution"
  | "saline";

export type EyeSide = "L" | "R";

export interface ItemProfile {
  id: string;
  groupId: TimelineGroupId;
  managementTemplate: ManagementTemplate;
  standardType: StandardType;
  standardTypeName?: string;
  name: string;
  /** Inventory and consumption quantity label, for example 片、瓶、个. */
  baseUnit?: string;
  side?: EyeSide;
  defaultDurationDays?: number;
  active: boolean;
  order: number;
}

export interface NewItemProfile {
  groupId: TimelineGroupId;
  managementTemplate: ManagementTemplate;
  standardType: StandardType;
  standardTypeName: string;
  name: string;
  baseUnit?: string;
  side?: EyeSide;
  defaultDurationDays?: number;
}

export type EditableItemProfile = Pick<
  NewItemProfile,
  "standardType" | "standardTypeName" | "name" | "baseUnit"
> &
  Partial<Pick<NewItemProfile, "side" | "defaultDurationDays">>;
