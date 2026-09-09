import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  applyPreferences,
  bootstrapPreferencesPersistence,
  collectPreferences,
  flushPreferencesSave,
  savePreferences
} from "./preferencesPersistence";
import { setPersistenceCommandAdapterForTests } from "./persistenceGateway";
import { defaultTimelinePalette } from "../../stores/timelineThemeStore";

beforeEach(async () => {
  const initial = {
    timelinePalette: { ...defaultTimelinePalette },
    consumptionHistoryRange: "all" as const,
    consumptionHistoryScope: "same_profile" as const,
    recentProductCount: 3
  };
  setPersistenceCommandAdapterForTests(async <T>() => initial as T);
  await bootstrapPreferencesPersistence();
});
afterEach(() => setPersistenceCommandAdapterForTests(null));

it("publishes both preference stores after commit and waits before closing", async () => {
  const before = collectPreferences();
  let resolve!: () => void;
  const gate = new Promise<void>((done) => {
    resolve = done;
  });
  setPersistenceCommandAdapterForTests(async <T>() => {
    await gate;
    return undefined as T;
  });
  const pending = savePreferences({
    timelinePalette: { ...before.timelinePalette, active: "#112233" },
    recentProductCount: 7
  });
  expect(collectPreferences()).toEqual(before);
  expect(flushPreferencesSave()).toBe(pending);
  resolve();
  await pending;
  expect(collectPreferences().timelinePalette.active).toBe("#112233");
  expect(collectPreferences().recentProductCount).toBe(7);
  await expect(flushPreferencesSave()).resolves.toBeUndefined();
});

it("retains committed preferences after failure and allows an explicit retry", async () => {
  const before = collectPreferences();
  setPersistenceCommandAdapterForTests(async () => {
    throw new Error("locked");
  });
  await expect(savePreferences({ recentProductCount: 9 })).rejects.toThrow("locked");
  expect(collectPreferences()).toEqual(before);
  await expect(flushPreferencesSave()).rejects.toThrow("locked");
  setPersistenceCommandAdapterForTests(async <T>() => undefined as T);
  await savePreferences({ recentProductCount: 9 });
  expect(collectPreferences().recentProductCount).toBe(9);
  await expect(flushPreferencesSave()).resolves.toBeUndefined();
});

it("rejects duplicate saves without losing the first candidate", async () => {
  let resolve!: () => void;
  const gate = new Promise<void>((done) => {
    resolve = done;
  });
  const calls = vi.fn();
  setPersistenceCommandAdapterForTests(async <T>(command: string) => {
    calls(command);
    await gate;
    return undefined as T;
  });
  const pending = savePreferences({ recentProductCount: 4 });
  await expect(savePreferences({ recentProductCount: 5 })).rejects.toThrow("请勿重复操作");
  expect(calls).toHaveBeenCalledTimes(1);
  resolve();
  await pending;
  expect(collectPreferences().recentProductCount).toBe(4);
});

it("does not persist mutations of the caller's candidate after dispatch", async () => {
  const palette = { ...defaultTimelinePalette, active: "#112233" };
  let received: unknown;
  setPersistenceCommandAdapterForTests(
    async <T>(_command: string, args?: Record<string, unknown>) => {
      received = args?.preferences;
      return undefined as T;
    }
  );
  const pending = savePreferences({ timelinePalette: palette });
  palette.active = "#445566";
  await pending;
  expect(received).toMatchObject({ timelinePalette: { active: "#112233" } });
  expect(collectPreferences().timelinePalette.active).toBe("#112233");
});

it("rejects missing baseline preferences without changing the committed view", async () => {
  const before = collectPreferences();
  setPersistenceCommandAdapterForTests(async <T>() => null as T);
  await expect(bootstrapPreferencesPersistence()).rejects.toThrow("缺少当前基线");
  expect(collectPreferences()).toEqual(before);
});

it("does not write back merely because a database snapshot is applied", async () => {
  const adapter = vi.fn();
  setPersistenceCommandAdapterForTests(async <T>() => {
    adapter();
    return undefined as T;
  });
  applyPreferences({ ...collectPreferences(), recentProductCount: 11 });
  await flushPreferencesSave();
  expect(adapter).not.toHaveBeenCalled();
});
