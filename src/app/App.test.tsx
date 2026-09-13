// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { App } from "./App";
import { usePersistenceStatusStore } from "../stores/persistenceStatusStore";

const mocks = vi.hoisted(() => ({
  bootstrap: vi.fn(),
  invoke: vi.fn(),
  flush: vi.fn(),
  shutdown: vi.fn(),
  destroy: vi.fn(),
  onClose: vi.fn(),
  dispose: vi.fn()
}));
vi.mock("../features/inventory/databasePersistence", () => ({
  bootstrapDatabasePersistence: mocks.bootstrap
}));
vi.mock("../features/inventory/persistenceGateway", () => ({ invokePersistence: mocks.invoke }));
vi.mock("../features/inventory/preferencesPersistence", () => ({
  flushPreferencesSave: mocks.flush
}));
vi.mock("../features/inventory/appShutdown", () => ({
  requestAppShutdown: mocks.shutdown
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ onCloseRequested: mocks.onClose, destroy: mocks.destroy })
}));
// These placeholders isolate shell behavior; page coverage is measured in page tests.
vi.mock("../pages/TimelinePage/TimelinePage", () => ({
  TimelinePage: ({ onNavigateToInventory }: { onNavigateToInventory: () => void }) =>
    <div>timeline-content<button onClick={onNavigateToInventory}>timeline-to-inventory</button></div>
}));
vi.mock("../pages/InventoryPage/InventoryPage", () => ({
  InventoryPage: ({ onNavigateToTimeline }: { onNavigateToTimeline: () => void }) =>
    <div>inventory-content<button onClick={onNavigateToTimeline}>inventory-to-timeline</button></div>
}));
vi.mock("../pages/StatisticsPage/StatisticsPage", () => ({
  StatisticsPage: ({ onNavigateToInventory }: { onNavigateToInventory: () => void }) =>
    <div>statistics-content<button onClick={onNavigateToInventory}>statistics-to-inventory</button></div>
}));
vi.mock("../pages/SettingsPage/SettingsPage", () => ({
  SettingsPage: () => <div>settings-content</div>
}));
beforeEach(() => {
  vi.resetAllMocks();
  mocks.bootstrap.mockResolvedValue(undefined);
  mocks.invoke.mockResolvedValue(null);
  mocks.onClose.mockResolvedValue(mocks.dispose);
  mocks.flush.mockResolvedValue(undefined);
  mocks.shutdown.mockResolvedValue(undefined);
  usePersistenceStatusStore.getState().setStatus("sqlite", "ready");
});
afterEach(cleanup);

it("does not expose business navigation until startup succeeds", async () => {
  let resolve!: () => void;
  mocks.bootstrap.mockReturnValue(
    new Promise<void>((done) => {
      resolve = done;
    })
  );
  render(<App />);
  expect(screen.queryByRole("navigation")).toBeNull();
  expect(screen.getByText("正在检查数据位置…")).toBeTruthy();
  await act(async () => resolve());
  expect(await screen.findByText("timeline-content")).toBeTruthy();
});

it("blocks business UI on database startup failure", async () => {
  mocks.bootstrap.mockRejectedValue(new Error("corrupt SQLite"));
  render(<App />);
  expect(await screen.findByRole("alert")).toBeTruthy();
  expect(screen.getByText("corrupt SQLite")).toBeTruthy();
  expect(screen.queryByRole("navigation")).toBeNull();
  expect(mocks.onClose).toHaveBeenCalledOnce();
});

it("navigates recovery notices to settings and supports all page destinations", async () => {
  mocks.invoke.mockResolvedValue("recovered isolated database");
  render(<App />);
  await screen.findByText("timeline-content");
  fireEvent.click(screen.getByRole("button", { name: "前往数据恢复" }));
  expect(screen.getByText("settings-content")).toBeTruthy();
  for (const [name, content] of [
    ["库存", "inventory-content"],
    ["统计", "statistics-content"],
    ["时间轴", "timeline-content"]
  ] as const) {
    fireEvent.click(screen.getByRole("button", { name }));
    expect(screen.getByText(content!)).toBeTruthy();
  }
  fireEvent.click(screen.getByRole("button", { name: "关闭提示" }));
  expect(screen.queryByText("recovered isolated database")).toBeNull();
});

it("honors navigation requests emitted by business pages", async () => {
  render(<App />);
  await screen.findByText("timeline-content");
  fireEvent.click(screen.getByRole("button", { name: "timeline-to-inventory" }));
  expect(screen.getByText("inventory-content")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "inventory-to-timeline" }));
  fireEvent.click(screen.getByRole("button", { name: "统计" }));
  fireEvent.click(screen.getByRole("button", { name: "statistics-to-inventory" }));
  expect(screen.getByText("inventory-content")).toBeTruthy();
});

it("keeps the window open when safe shutdown fails and permits retry", async () => {
  mocks.shutdown.mockRejectedValueOnce(new Error("checkpoint locked"));
  render(<App />);
  await waitFor(() => expect(mocks.onClose).toHaveBeenCalledTimes(1));
  const close = mocks.onClose.mock.calls[0]![0] as (event: {
    preventDefault: () => void;
  }) => Promise<void>;
  const event = { preventDefault: vi.fn() };
  await close(event);
  expect(await screen.findByText("无法安全退出")).toBeTruthy();
  await close(event);
  expect(mocks.shutdown).toHaveBeenLastCalledWith("exit");
  expect(event.preventDefault).toHaveBeenCalledTimes(2);
});

it("shows non-Error startup failures and offers a retry", async () => {
  mocks.bootstrap.mockRejectedValue("plain startup failure");
  render(<App />);
  expect(await screen.findByText("plain startup failure")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "重新尝试" }));
});

it("shows persistence failures and prevents duplicate close work", async () => {
  let finishShutdown!: () => void;
  mocks.shutdown.mockReturnValue(new Promise<void>((resolve) => { finishShutdown = resolve; }));
  const { unmount } = render(<App />);
  await screen.findByText("timeline-content");
  act(() => usePersistenceStatusStore.getState().setStatus("sqlite", "error", "disk full"));
  expect(screen.getByText("数据保存失败")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "重新加载数据" }));
  await waitFor(() => expect(mocks.onClose).toHaveBeenCalledTimes(1));
  const close = mocks.onClose.mock.calls[0]![0] as (event: {
    preventDefault: () => void;
  }) => Promise<void>;
  const event = { preventDefault: vi.fn() };
  const first = close(event);
  await close(event);
  expect(mocks.shutdown).toHaveBeenCalledTimes(1);
  finishShutdown();
  await first;
  expect(mocks.shutdown).toHaveBeenCalledWith("exit");
  unmount();
  expect(mocks.dispose).toHaveBeenCalledOnce();
});
