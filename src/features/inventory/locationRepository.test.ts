import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useInventoryStore } from "../../stores/inventoryStore";
import { useTimelineItemStore } from "../../stores/timelineItemStore";
import { createLocation, deleteLocation, setLocationActive, updateLocation } from "./locationRepository";
import { setPersistenceCommandAdapterForTests } from "./persistenceGateway";

describe("location repository validation", () => {
  beforeEach(() => {
    useInventoryStore.setState({
      products: [], lots: [], transactions: [],
      locations: [
        { id: "home", name: "家", note: "常用", active: true, order: 0 },
        { id: "office", name: "办公室", active: false, order: 1 }
      ]
    });
    useTimelineItemStore.setState({ items: [{
      id: "item-1", categoryId: "profile", groupId: "periodic", categoryName: "镜盒",
      label: "镜盒", detail: "", location: "家", locationId: "home",
      startDate: "2026-09-01", endDate: null, status: "active"
    }, {
      id: "item-2", categoryId: "profile", groupId: "periodic", categoryName: "镜盒",
      label: "另一个", detail: "", location: "办公室", locationId: "office",
      startDate: "2026-09-01", endDate: null, status: "active"
    }] });
    setPersistenceCommandAdapterForTests(async <T,>(command: string, args?: Record<string, unknown>) => {
      if (command === "create_location" || command === "update_location")
        return structuredClone(args?.location) as T;
      return undefined as T;
    });
  });

  afterEach(() => setPersistenceCommandAdapterForTests(null));

  it("rejects blank and case-insensitive duplicate names", async () => {
    await expect(createLocation({ name: "   " })).rejects.toThrow("地点名称不能为空或重复");
    await expect(createLocation({ name: "办公室" })).rejects.toThrow("地点名称不能为空或重复");
  });

  it("allows retaining the current name and clears a blank note", async () => {
    await updateLocation("home", { name: " 家 ", note: "  " });
    expect(useInventoryStore.getState().locations[0]).toEqual({
      id: "home", name: "家", active: true, order: 0
    });
    expect(useTimelineItemStore.getState().items).toEqual([
      expect.objectContaining({ id: "item-1", location: "家" }),
      expect.objectContaining({ id: "item-2", location: "办公室" })
    ]);
  });

  it("rejects missing update and activity targets", async () => {
    await expect(updateLocation("missing", { name: "随身" })).rejects.toThrow("地点不存在");
    await expect(setLocationActive("missing", false)).rejects.toThrow("地点不存在");
  });

  it("creates at the end, toggles activity, and compacts deletion order", async () => {
    const id = await createLocation({ name: " 随身 ", note: " 小包 " });
    expect(useInventoryStore.getState().locations.at(-1)).toMatchObject({
      id, name: "随身", note: "小包", active: true, order: 2
    });
    await setLocationActive("home", false);
    expect(useInventoryStore.getState().locations[0]?.active).toBe(false);
    await deleteLocation("home");
    expect(useInventoryStore.getState().locations.map((entry) => entry.order)).toEqual([0, 1]);
  });
});
