import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { usePersistenceStatusStore } from "../../stores/persistenceStatusStore";

export type PersistenceCommandAdapter = <T>(
  command: string,
  args?: Record<string, unknown>
) => Promise<T>;

let adapter: PersistenceCommandAdapter = (command, args) =>
  tauriInvoke(command, args);
let writeInFlight = false;

const readCommands = new Set([
  "load_app_data",
  "load_preferences",
  "get_data_location",
  "get_startup_notice"
]);

/** The only frontend boundary for business persistence. */
export async function invokePersistence<T>(
  command: string,
  args?: Record<string, unknown>
): Promise<T> {
  const status = usePersistenceStatusStore.getState();
  const write = !readCommands.has(command);
  if (write && writeInFlight) throw new Error("已有 SQLite 写入正在提交，请勿重复操作");
  if (write) {
    writeInFlight = true;
    status.setStatus("sqlite", "saving");
  }
  try {
    const result = await adapter<T>(command, args);
    if (!readCommands.has(command)) status.setStatus("sqlite", "ready");
    return result;
  } catch (error) {
    status.setStatus(
      "sqlite",
      "error",
      error instanceof Error ? error.message : String(error)
    );
    throw error;
  } finally {
    if (write) writeInFlight = false;
  }
}

/** Test-only dependency injection; production always retains the Tauri adapter. */
export function setPersistenceCommandAdapterForTests(
  next: PersistenceCommandAdapter | null
) {
  adapter = next ?? ((command, args) => tauriInvoke(command, args));
  writeInFlight = false;
}
