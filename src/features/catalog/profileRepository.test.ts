import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setPersistenceCommandAdapterForTests } from "../inventory/persistenceGateway";
import { useInventoryStore } from "../../stores/inventoryStore";
import { useItemProfileStore } from "../../stores/itemProfileStore";
import { useTimelineItemStore } from "../../stores/timelineItemStore";
import type { ItemProfile } from "./catalog.types";
import {
  createProfile,
  deleteProfile,
  moveProfile,
  profileHasRelations,
  setProfileActive,
  updateProfile
} from "./profileRepository";

const profile = (overrides: Partial<ItemProfile> = {}): ItemProfile => ({
  id: "profile-1", groupId: "lenses", managementTemplate: "rigid_long_term",
  standardType: "scleral", standardTypeName: "巩膜镜", name: "左眼巩膜镜",
  baseUnit: "片", side: "L", defaultDurationDays: 365, active: true, order: 0,
  ...overrides
});

describe("profile repository", () => {
  const calls: Array<{ command: string; args: Record<string, unknown> | undefined }> = [];

  beforeEach(() => {
    calls.length = 0;
    useItemProfileStore.setState({ profiles: [profile()] });
    useInventoryStore.setState({ products: [], lots: [], transactions: [], locations: [] });
    useTimelineItemStore.setState({ items: [] });
    setPersistenceCommandAdapterForTests(async <T,>(command: string, args?: Record<string, unknown>) => {
      calls.push({ command, args });
      if (command === "create_profile" || command === "update_profile")
        return structuredClone(args?.profile) as T;
      return undefined as T;
    });
  });

  afterEach(() => setPersistenceCommandAdapterForTests(null));

  it("creates a trimmed profile after its group siblings", async () => {
    useItemProfileStore.setState({ profiles: [profile(), profile({ id: "periodic", groupId: "periodic" })] });
    const id = await createProfile({
      groupId: "lenses", managementTemplate: "rigid_long_term", standardType: "rgp",
      standardTypeName: " RGP ", name: " 右眼 RGP ", side: "R"
    });
    expect(id).toMatch(/^rgp-/);
    expect(useItemProfileStore.getState().profiles.at(-1)).toMatchObject({
      id, name: "右眼 RGP", standardTypeName: "RGP", baseUnit: "片", order: 1, active: true
    });
  });

  it("updates profile metadata and synchronizes related product fields", async () => {
    useInventoryStore.setState({
      products: [{ id: "p1", itemProfileId: "profile-1", standardType: "scleral", brand: "B", baseUnit: "片", unitsPerPackage: 1, active: true },
        { id: "p2", itemProfileId: "other", standardType: "scleral", brand: "C", baseUnit: "片", unitsPerPackage: 1, active: true }],
      lots: [], transactions: [], locations: []
    });
    await updateProfile("profile-1", {
      standardType: "rgp", standardTypeName: " RGP ", name: " 新名称 ",
      baseUnit: " 枚 ", side: "R", defaultDurationDays: 180
    });
    expect(useItemProfileStore.getState().profiles[0]).toMatchObject({
      standardType: "rgp", name: "新名称", standardTypeName: "RGP", baseUnit: "枚",
      side: "R", defaultDurationDays: 180
    });
    expect(useInventoryStore.getState().products).toEqual([
      expect.objectContaining({ id: "p1", standardType: "rgp", baseUnit: "枚" }),
      expect.objectContaining({ id: "p2", standardType: "scleral", baseUnit: "片" })
    ]);
  });

  it("uses source and template defaults for omitted optional updates", async () => {
    useItemProfileStore.setState({ profiles: [profile({ baseUnit: undefined as never, managementTemplate: "lens_case" })] });
    await updateProfile("profile-1", {
      standardType: "lens_case", standardTypeName: "镜盒", name: "镜盒"
    });
    expect(useItemProfileStore.getState().profiles[0]).toMatchObject({ baseUnit: "个", side: "L", defaultDurationDays: 365 });
  });

  it("toggles activity and rejects mutations for missing profiles", async () => {
    await setProfileActive("profile-1", false);
    expect(useItemProfileStore.getState().profiles[0]?.active).toBe(false);
    await expect(updateProfile("missing", {
      standardType: "rgp", standardTypeName: "RGP", name: "RGP"
    })).rejects.toThrow("用品配置不存在");
    await expect(setProfileActive("missing", false)).rejects.toThrow("用品配置不存在");
    await expect(moveProfile("missing", 1)).rejects.toThrow("用品配置不存在");
  });

  it("deletes and compacts only the source group, including stale local deletes", async () => {
    useItemProfileStore.setState({ profiles: [
      profile(), profile({ id: "profile-2", order: 4 }),
      profile({ id: "profile-3", groupId: "periodic", order: 7 })
    ] });
    await deleteProfile("profile-1");
    expect(useItemProfileStore.getState().profiles).toEqual([
      expect.objectContaining({ id: "profile-2", order: 0 }),
      expect.objectContaining({ id: "profile-3", order: 7 })
    ]);
    await deleteProfile("already-absent");
    expect(useItemProfileStore.getState().profiles).toHaveLength(2);
  });

  it("reorders within a group and treats outer moves as no-ops", async () => {
    useItemProfileStore.setState({ profiles: [
      profile({ order: 2 }), profile({ id: "profile-2", order: 0 }),
      profile({ id: "profile-3", groupId: "periodic", order: 0 })
    ] });
    await moveProfile("profile-1", -1);
    expect(useItemProfileStore.getState().profiles.find((entry) => entry.id === "profile-1")?.order).toBe(0);
    expect(useItemProfileStore.getState().profiles.find((entry) => entry.id === "profile-3")?.order).toBe(0);
    const count = calls.length;
    await moveProfile("profile-1", -1);
    expect(calls).toHaveLength(count);
  });

  it("detects product and timeline relations and handles missing profiles", () => {
    expect(profileHasRelations("missing")).toBe(false);
    expect(profileHasRelations("profile-1")).toBe(false);
    useInventoryStore.setState({
      products: [{ id: "p1", itemProfileId: "profile-1", standardType: "scleral", brand: "B", baseUnit: "片", unitsPerPackage: 1, active: true }],
      lots: [], transactions: [], locations: []
    });
    expect(profileHasRelations("profile-1")).toBe(true);
    useInventoryStore.setState({ products: [], lots: [], transactions: [], locations: [] });
    useTimelineItemStore.setState({ items: [{
      id: "i1", categoryId: "profile-1", groupId: "lenses", categoryName: "镜片",
      label: "实例", detail: "", location: "家", startDate: "2026-01-01",
      endDate: null, status: "active"
    }] });
    expect(profileHasRelations("profile-1")).toBe(true);
  });
});
