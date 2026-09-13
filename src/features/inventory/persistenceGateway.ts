import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { usePersistenceStatusStore } from "../../stores/persistenceStatusStore";

export type PersistenceCommandAdapter = <T>(
  command: string,
  args?: Record<string, unknown>
) => Promise<T>;

let adapter: PersistenceCommandAdapter = (command, args) =>
  tauriInvoke(command, args);
let writeInFlight: Promise<unknown> | null = null;
let shutdownRequested = false;

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
  if (shutdownRequested) throw new Error("应用正在安全关闭，不能开始新的数据库操作");
  if (write && writeInFlight) throw new Error("已有 SQLite 写入正在提交，请勿重复操作");
  if (write) {
    status.setStatus("sqlite", "saving");
  }
  const operation = adapter<T>(command, args);
  if (write) writeInFlight = operation;
  try {
    const result = await operation;
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
    if (write && writeInFlight === operation) writeInFlight = null;
  }
}

export async function beginPersistenceShutdown() {
  if (shutdownRequested) throw new Error("应用关闭流程已经开始");
  shutdownRequested = true;
  try {
    await writeInFlight;
  } catch (error) {
    shutdownRequested = false;
    throw error;
  }
}

export async function invokeShutdownCommand(command: "exit_app" | "restart_app") {
  if (!shutdownRequested) throw new Error("应用关闭流程尚未开始");
  const status = usePersistenceStatusStore.getState();
  status.setStatus("sqlite", "saving");
  try {
    const result = await adapter<void>(command);
    status.setStatus("sqlite", "ready");
    return result;
  } catch (error) {
    status.setStatus(
      "sqlite",
      "error",
      error instanceof Error ? error.message : String(error)
    );
    shutdownRequested = false;
    throw error;
  }
}

export function cancelPersistenceShutdown() {
  shutdownRequested = false;
}

/** Test-only dependency injection; production always retains the Tauri adapter. */
export function setPersistenceCommandAdapterForTests(
  next: PersistenceCommandAdapter | null
) {
  adapter = next ?? ((command, args) => tauriInvoke(command, args));
  writeInFlight = null;
  shutdownRequested = false;
}
