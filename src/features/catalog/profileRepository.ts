import { invokePersistence as invoke } from "../inventory/persistenceGateway";
import { useInventoryStore } from "../../stores/inventoryStore";
import { useItemProfileStore } from "../../stores/itemProfileStore";
import { useTimelineItemStore } from "../../stores/timelineItemStore";
import { applyDatabaseViewUpdate } from "../inventory/databasePersistence";
import { defaultBaseUnitForTemplate, itemProfileBaseUnit } from "./catalog";
import type { EditableItemProfile, ItemProfile, NewItemProfile } from "./catalog.types";

export async function createProfile(input: NewItemProfile) {
  const profile: ItemProfile = {
    ...input,
    id: `${input.standardType}-${crypto.randomUUID()}`,
    name: input.name.trim(),
    standardTypeName: input.standardTypeName.trim(),
    baseUnit: itemProfileBaseUnit(input),
    active: true,
    order: useItemProfileStore.getState().profiles.filter(
      (entry) => entry.groupId === input.groupId
    ).length
  };
  const stored = await invoke<ItemProfile>("create_profile", { profile });
  applyDatabaseViewUpdate(() => useItemProfileStore.setState((state) => ({
    profiles: [...state.profiles, stored]
  })));
  return stored.id;
}

export async function updateProfile(id: string, changes: EditableItemProfile) {
  const source = useItemProfileStore.getState().profiles.find((entry) => entry.id === id);
  if (!source) throw new Error("用品配置不存在");
  const baseUnit = (changes.baseUnit ?? source.baseUnit ??
    defaultBaseUnitForTemplate(source.managementTemplate)).trim();
  const profile: ItemProfile = {
    ...source,
    ...changes,
    name: changes.name.trim(),
    standardTypeName: changes.standardTypeName.trim(),
    baseUnit,
    ...(changes.side ? { side: changes.side } : {}),
    ...(changes.defaultDurationDays !== undefined
      ? { defaultDurationDays: changes.defaultDurationDays }
      : {})
  };
  const stored = await invoke<ItemProfile>("update_profile", { profile });
  applyDatabaseViewUpdate(() => {
    useItemProfileStore.setState((state) => ({
      profiles: state.profiles.map((entry) => entry.id === id ? stored : entry)
    }));
    useInventoryStore.setState((state) => ({
      products: state.products.map((product) => product.itemProfileId === id
        ? { ...product, standardType: stored.standardType, baseUnit }
        : product)
    }));
  });
}

export async function setProfileActive(id: string, active: boolean) {
  const source = useItemProfileStore.getState().profiles.find((entry) => entry.id === id);
  if (!source) throw new Error("用品配置不存在");
  const stored = await invoke<ItemProfile>("update_profile", {
    profile: { ...source, active }
  });
  applyDatabaseViewUpdate(() => useItemProfileStore.setState((state) => ({
    profiles: state.profiles.map((entry) => entry.id === id ? stored : entry)
  })));
}

export async function deleteProfile(id: string) {
  await invoke("delete_profile", { id });
  applyDatabaseViewUpdate(() => useItemProfileStore.setState((state) => {
    const source = state.profiles.find((entry) => entry.id === id);
    if (!source) return state;
    let order = 0;
    return { profiles: state.profiles.filter((entry) => entry.id !== id).map((entry) =>
      entry.groupId === source.groupId ? { ...entry, order: order++ } : entry
    ) };
  }));
}

export async function moveProfile(id: string, direction: -1 | 1) {
  const profiles = useItemProfileStore.getState().profiles;
  const source = profiles.find((entry) => entry.id === id);
  if (!source) throw new Error("用品配置不存在");
  const group = profiles.filter((entry) => entry.groupId === source.groupId)
    .sort((left, right) => left.order - right.order);
  const index = group.findIndex((entry) => entry.id === id);
  const target = group[index + direction];
  if (!target) return;
  [group[index], group[index + direction]] = [target, source];
  const order = group.map((entry, nextOrder) => ({ id: entry.id, order: nextOrder }));
  await invoke("reorder_profiles", { order });
  const orderById = new Map(order.map((entry) => [entry.id, entry.order]));
  applyDatabaseViewUpdate(() => useItemProfileStore.setState({
    profiles: profiles.map((entry) => orderById.has(entry.id)
      ? { ...entry, order: orderById.get(entry.id)! }
      : entry)
  }));
}

export function profileHasRelations(profileId: string) {
  const profile = useItemProfileStore.getState().profiles.find((entry) => entry.id === profileId);
  if (!profile) return false;
  return useInventoryStore.getState().products.some((product) =>
    product.itemProfileId === profile.id
  ) || useTimelineItemStore.getState().items.some((item) => item.categoryId === profile.id);
}
