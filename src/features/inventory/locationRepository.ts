import { invokePersistence as invoke } from "./persistenceGateway";
import { useInventoryStore } from "../../stores/inventoryStore";
import { useTimelineItemStore } from "../../stores/timelineItemStore";
import type { InventoryLocation, NewInventoryLocation } from "./inventory.types";
import { applyDatabaseViewUpdate } from "./databasePersistence";

function normalize(input: NewInventoryLocation, existing?: InventoryLocation) {
  const locations = useInventoryStore.getState().locations;
  const name = input.name.trim();
  if (!name || locations.some((location) =>
    location.id !== existing?.id &&
    location.name.toLocaleLowerCase() === name.toLocaleLowerCase()
  )) throw new Error("地点名称不能为空或重复");
  return {
    id: existing?.id ?? `location-${crypto.randomUUID()}`,
    name,
    ...(input.note?.trim() ? { note: input.note.trim() } : {}),
    active: existing?.active ?? true,
    order: existing?.order ?? locations.length
  } satisfies InventoryLocation;
}

export async function createLocation(input: NewInventoryLocation) {
  const location = normalize(input);
  const stored = await invoke<InventoryLocation>("create_location", { location });
  applyDatabaseViewUpdate(() => {
    useInventoryStore.setState((state) => ({ locations: [...state.locations, stored] }));
  });
  return stored.id;
}

export async function updateLocation(id: string, input: NewInventoryLocation) {
  const source = useInventoryStore.getState().locations.find((entry) => entry.id === id);
  if (!source) throw new Error("地点不存在");
  const stored = await invoke<InventoryLocation>("update_location", {
    location: normalize(input, source)
  });
  applyDatabaseViewUpdate(() => {
    useInventoryStore.setState((state) => ({
      locations: state.locations.map((entry) => entry.id === id ? stored : entry)
    }));
    useTimelineItemStore.setState((state) => ({
      items: state.items.map((item) =>
        item.locationId === id ? { ...item, location: stored.name } : item
      )
    }));
  });
}

export async function setLocationActive(id: string, active: boolean) {
  const source = useInventoryStore.getState().locations.find((entry) => entry.id === id);
  if (!source) throw new Error("地点不存在");
  const stored = await invoke<InventoryLocation>("update_location", {
    location: { ...source, active }
  });
  applyDatabaseViewUpdate(() => {
    useInventoryStore.setState((state) => ({
      locations: state.locations.map((entry) => entry.id === id ? stored : entry)
    }));
  });
}

export async function deleteLocation(id: string) {
  await invoke("delete_location", { id });
  applyDatabaseViewUpdate(() => {
    useInventoryStore.setState((state) => ({
      locations: state.locations
        .filter((entry) => entry.id !== id)
        .map((entry, order) => ({ ...entry, order }))
    }));
  });
}
