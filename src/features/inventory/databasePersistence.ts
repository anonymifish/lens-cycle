import { invokePersistence as invoke } from "./persistenceGateway";
import {
  applyAppDataSnapshot,
  assertValidAppDataSnapshot,
  assertCurrentAppDataSnapshot,
  type AppDataSnapshot
} from "./appDataSnapshot";
import { usePersistenceStatusStore } from "../../stores/persistenceStatusStore";
import type { AppPreferences } from "./preferencesPersistence";
import { bootstrapPreferencesPersistence } from "./preferencesPersistence";
import { batchStoreNotifications } from "../../stores/atomicStore";
import { requestAppShutdown } from "./appShutdown";

let bootstrapPromise: Promise<void> | null = null;

export interface DataLocationInfo {
  directory: string;
  defaultDirectory: string;
  isDefault: boolean;
  qaMode: boolean;
  initialized: boolean;
}

export function bootstrapDatabasePersistence() {
  if (bootstrapPromise) return bootstrapPromise;
  bootstrapPromise = bootstrapDatabasePersistenceOnce();
  return bootstrapPromise;
}

async function bootstrapDatabasePersistenceOnce() {
  const status = usePersistenceStatusStore.getState();
  status.setStatus("sqlite", "initializing");
  try {
    const stored = await invoke<unknown>("load_app_data");
    assertCurrentAppDataSnapshot(stored);
    assertValidAppDataSnapshot(stored);
    applyDatabaseViewUpdate(() => applyAppDataSnapshot(stored));
    await bootstrapPreferencesPersistence();
    status.setStatus("sqlite", "ready");
  } catch (error) {
    status.setStatus("sqlite", "error", errorMessage(error));
    throw error;
  }
}

/** Apply a database result to the in-memory view after the commit succeeds. */
export function applyDatabaseViewUpdate(update: () => void) {
  batchStoreNotifications(update);
}

export function getDataLocation() {
  return invoke<DataLocationInfo>("get_data_location");
}

export async function initializeDataLocation(targetDirectory: string) {
  await invoke("initialize_data_location", { targetDirectory });
  await requestAppShutdown("restart");
}

/** Persist first so a failed restore never replaces the currently visible data. */
export async function replacePersistedAppData(
  snapshot: AppDataSnapshot,
  preferences?: AppPreferences
) {
  assertCurrentAppDataSnapshot(snapshot);
  assertValidAppDataSnapshot(snapshot);
  const status = usePersistenceStatusStore.getState();
  status.setStatus("sqlite", "saving");
  try {
    await invoke("replace_app_data", { snapshot, ...(preferences ? { preferences } : {}) });
    applyDatabaseViewUpdate(() => applyAppDataSnapshot(snapshot));
    status.setStatus("sqlite", "ready");
  } catch (error) {
    status.setStatus("sqlite", "error", errorMessage(error));
    throw error;
  }
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
