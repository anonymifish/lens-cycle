import { afterEach, describe, expect, it } from "vitest";
import { collectPreferences } from "./preferencesPersistence";
import { collectAppDataSnapshot } from "./appDataSnapshot";
import {
  bootstrapDatabasePersistence, getDataLocation, initializeDataLocation,
  replacePersistedAppData
} from "./databasePersistence";
import { setPersistenceCommandAdapterForTests } from "./persistenceGateway";
import { usePersistenceStatusStore } from "../../stores/persistenceStatusStore";

const emptySnapshot = {
  schemaVersion: 1 as const, profiles: [], products: [], locations: [], lots: [],
  transactions: [], items: [], usageFacts: [], careEvents: []
};

afterEach(() => setPersistenceCommandAdapterForTests(null));

describe("database persistence orchestration", () => {
  it("loads data and preferences once, then exposes the current location", async () => {
    const calls: string[] = [];
    setPersistenceCommandAdapterForTests(async <T,>(command: string): Promise<T> => {
      calls.push(command);
      if (command === "load_app_data") return structuredClone(emptySnapshot) as T;
      if (command === "load_preferences") return collectPreferences() as T;
      if (command === "get_data_location") return {
        directory: "isolated", defaultDirectory: "isolated", isDefault: true,
        qaMode: true, initialized: true
      } as T;
      throw new Error(`Unexpected command ${command}`);
    });
    await bootstrapDatabasePersistence();
    await bootstrapDatabasePersistence();
    expect(calls.filter((command) => command === "load_app_data")).toHaveLength(1);
    expect(await getDataLocation()).toMatchObject({ directory: "isolated", qaMode: true });
    expect(usePersistenceStatusStore.getState().phase).toBe("ready");
  });

  it("initializes a location, restarts, and atomically replaces the visible snapshot", async () => {
    const calls: Array<[string, Record<string, unknown> | undefined]> = [];
    setPersistenceCommandAdapterForTests(async <T,>(
      command: string, args?: Record<string, unknown>
    ): Promise<T> => {
      calls.push([command, args]);
      return undefined as T;
    });
    await initializeDataLocation("D:\\Data");
    await replacePersistedAppData(emptySnapshot);
    expect(calls.map(([command]) => command)).toEqual([
      "initialize_data_location", "restart_app", "replace_app_data"
    ]);
    expect(collectAppDataSnapshot()).toEqual(emptySnapshot);
  });

  it("preserves the current view and reports a failed replacement", async () => {
    const before = collectAppDataSnapshot();
    setPersistenceCommandAdapterForTests(async () => { throw "disk unavailable"; });
    await expect(replacePersistedAppData(emptySnapshot)).rejects.toBe("disk unavailable");
    expect(collectAppDataSnapshot()).toEqual(before);
    expect(usePersistenceStatusStore.getState()).toMatchObject({
      phase: "error", error: "disk unavailable"
    });
  });
});
