import { create } from "./atomicStore";
import {
  defaultBaseUnitForTemplate,
  itemProfileBaseUnit,
  templatesByGroup,
  typesByTemplate
} from "../features/catalog/catalog";
import type {
  EditableItemProfile,
  ItemProfile,
  NewItemProfile
} from "../features/catalog/catalog.types";
import type { TimelineGroupId } from "../features/timeline/timeline.types";
import { useInventoryStore } from "./inventoryStore";
import { useTimelineItemStore } from "./timelineItemStore";

function validateProfileInput(profile: NewItemProfile) {
  if (!profile.name.trim() || !profile.standardTypeName.trim())
    throw new Error("用品配置名称和标准类型名称不能为空");
  if (profile.baseUnit !== undefined && !profile.baseUnit.trim())
    throw new Error("基础单位不能为空");
  if (!templatesByGroup[profile.groupId].includes(profile.managementTemplate))
    throw new Error("管理模板与大类不一致");
  if (!typesByTemplate[profile.managementTemplate].includes(profile.standardType))
    throw new Error("标准类型与管理模板不一致");
  if (profile.groupId === "lenses" && !profile.side)
    throw new Error("镜片配置必须选择眼别");
  if (profile.groupId !== "lenses" && profile.side)
    throw new Error("非镜片配置不能设置眼别");
  if (
    profile.defaultDurationDays !== undefined &&
    (!Number.isInteger(profile.defaultDurationDays) ||
      profile.defaultDurationDays <= 0)
  )
    throw new Error("默认周期必须是正整数");
}

interface ItemProfileState {
  profiles: ItemProfile[];
  addProfile: (profile: NewItemProfile) => string;
  updateProfile: (id: string, changes: EditableItemProfile) => void;
  deleteProfile: (id: string) => void;
  renameProfile: (id: string, name: string) => void;
  moveProfile: (id: string, direction: -1 | 1) => void;
  setProfileActive: (id: string, active: boolean) => void;
}

function normalizeOrder(profiles: ItemProfile[], groupId: TimelineGroupId) {
  const groupProfiles = profiles
    .filter((profile) => profile.groupId === groupId)
    .sort((a, b) => a.order - b.order)
    .map((profile, index) => ({ ...profile, order: index }));
  const byId = new Map(groupProfiles.map((profile) => [profile.id, profile]));
  return profiles.map((profile) => byId.get(profile.id) ?? profile);
}

export const useItemProfileStore = create<ItemProfileState>()(
  (set) => ({
      profiles: [],
      addProfile: (profile) => {
        validateProfileInput(profile);
        const id = `${profile.standardType}-${crypto.randomUUID()}`;
        set((state) => {
          const order = state.profiles.filter(
            (current) => current.groupId === profile.groupId
          ).length;
          return {
            profiles: [
              ...state.profiles,
              {
                ...profile,
                baseUnit: itemProfileBaseUnit(profile),
                id,
                active: true,
                order
              }
            ]
          };
        });
        return id;
      },
      updateProfile: (id, changes) => {
        const source = useItemProfileStore
          .getState()
          .profiles.find((profile) => profile.id === id);
        if (!source) throw new Error("用品配置不存在");
        const candidate: NewItemProfile = {
          groupId: source.groupId,
          managementTemplate: source.managementTemplate,
          standardType: changes.standardType,
          standardTypeName: changes.standardTypeName,
          name: changes.name,
          baseUnit:
            changes.baseUnit ??
            source.baseUnit ??
            defaultBaseUnitForTemplate(source.managementTemplate),
          ...(changes.side ? { side: changes.side } : {}),
          ...(changes.defaultDurationDays !== undefined
            ? { defaultDurationDays: changes.defaultDurationDays }
            : {})
        };
        validateProfileInput(candidate);
        const normalizedBaseUnit = itemProfileBaseUnit(candidate);
        set((state) => ({
          profiles: state.profiles.map((profile) =>
            profile.id === id
              ? { ...profile, ...changes, baseUnit: normalizedBaseUnit }
              : profile
          )
        }));
        useInventoryStore
          .getState()
          .updateProductsForProfile(
            id,
            candidate.standardType,
            normalizedBaseUnit
          );
      },
      deleteProfile: (id) =>
        set((state) => {
          const source = state.profiles.find((profile) => profile.id === id);
          if (!source) return state;
          if (
            useInventoryStore
              .getState()
              .products.some((product) => product.itemProfileId === id) ||
            useTimelineItemStore
              .getState()
              .items.some((item) => item.categoryId === id)
          )
            throw new Error("已有产品或时间轴记录，不能删除用品配置");
          return {
            profiles: normalizeOrder(
              state.profiles.filter((profile) => profile.id !== id),
              source.groupId
            )
          };
        }),
      renameProfile: (id, name) => {
        if (!name.trim()) throw new Error("用品配置名称不能为空");
        set((state) => ({
          profiles: state.profiles.map((profile) =>
            profile.id === id ? { ...profile, name: name.trim() } : profile
          )
        }));
      },
      moveProfile: (id, direction) =>
        set((state) => {
          const source = state.profiles.find((profile) => profile.id === id);
          if (!source) return state;
          const ordered = state.profiles
            .filter((profile) => profile.groupId === source.groupId)
            .sort((a, b) => a.order - b.order);
          const index = ordered.findIndex((profile) => profile.id === id);
          const target = ordered[index + direction];
          if (!target) return state;
          const profiles = state.profiles.map((profile) => {
            if (profile.id === source.id) return { ...profile, order: target.order };
            if (profile.id === target.id) return { ...profile, order: source.order };
            return profile;
          });
          return { profiles: normalizeOrder(profiles, source.groupId) };
        }),
      setProfileActive: (id, active) => {
        if (!useItemProfileStore.getState().profiles.some((profile) => profile.id === id))
          throw new Error("用品配置不存在");
        set((state) => ({
          profiles: state.profiles.map((profile) =>
            profile.id === id ? { ...profile, active } : profile
          )
        }));
      }
  })
);
