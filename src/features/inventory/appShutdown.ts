import { flushPreferencesSave } from "./preferencesPersistence";
import {
  beginPersistenceShutdown,
  cancelPersistenceShutdown,
  invokeShutdownCommand
} from "./persistenceGateway";

export type AppShutdownKind = "exit" | "restart";

export async function requestAppShutdown(kind: AppShutdownKind) {
  const action = kind === "exit" ? "退出" : "重启";
  try {
    await beginPersistenceShutdown();
  } catch (error) {
    throw shutdownError(action, "等待正在提交的数据失败", error);
  }
  try {
    await flushPreferencesSave();
  } catch (error) {
    cancelPersistenceShutdown();
    throw shutdownError(action, "保存待提交设置失败", error);
  }
  try {
    await invokeShutdownCommand(kind === "exit" ? "exit_app" : "restart_app");
  } catch (error) {
    cancelPersistenceShutdown();
    throw shutdownError(action, "SQLite 收尾失败", error);
  }
}

function shutdownError(action: string, stage: string, error: unknown) {
  const detail = error instanceof Error ? error.message : String(error);
  return new Error(`无法安全${action}：${stage}：${detail}`);
}
