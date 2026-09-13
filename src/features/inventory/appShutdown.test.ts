import { afterEach, expect, it } from "vitest";
import { requestAppShutdown } from "./appShutdown";
import {
  invokePersistence,
  setPersistenceCommandAdapterForTests
} from "./persistenceGateway";

afterEach(() => setPersistenceCommandAdapterForTests(null));

it("waits for an in-flight write, blocks new writes, then requests a safe exit", async () => {
  let finishWrite!: () => void;
  const writeGate = new Promise<void>((resolve) => { finishWrite = resolve; });
  const commands: string[] = [];
  setPersistenceCommandAdapterForTests(async <T,>(command: string): Promise<T> => {
    commands.push(command);
    if (command === "save_preferences") await writeGate;
    return undefined as T;
  });

  const write = invokePersistence("save_preferences");
  const shutdown = requestAppShutdown("exit");
  await Promise.resolve();
  expect(commands).toEqual(["save_preferences"]);
  await expect(invokePersistence("create_location")).rejects.toThrow("正在安全关闭");

  finishWrite();
  await write;
  await shutdown;
  expect(commands).toEqual(["save_preferences", "exit_app"]);
});

it("keeps shutdown retryable and reports the SQLite closing stage", async () => {
  const commands: string[] = [];
  setPersistenceCommandAdapterForTests(async <T,>(command: string): Promise<T> => {
    commands.push(command);
    if (command === "restart_app" && commands.length === 1)
      throw new Error("checkpoint busy");
    return undefined as T;
  });

  await expect(requestAppShutdown("restart")).rejects.toThrow(
    "无法安全重启：SQLite 收尾失败：checkpoint busy"
  );
  await expect(requestAppShutdown("restart")).resolves.toBeUndefined();
  expect(commands).toEqual(["restart_app", "restart_app"]);
});
