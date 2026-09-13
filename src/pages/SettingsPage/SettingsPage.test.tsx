// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SettingsPage } from "./SettingsPage";
import {
  bootstrapPreferencesPersistence,
  collectPreferences
} from "../../features/inventory/preferencesPersistence";
import { setPersistenceCommandAdapterForTests } from "../../features/inventory/persistenceGateway";
import { defaultTimelinePalette, useTimelineThemeStore } from "../../stores/timelineThemeStore";
import { usePersistenceStatusStore } from "../../stores/persistenceStatusStore";
import { useInventoryStore } from "../../stores/inventoryStore";
import { useForecastSettingsStore } from "../../stores/forecastSettingsStore";
import { useItemProfileStore } from "../../stores/itemProfileStore";
import { useTimelineItemStore } from "../../stores/timelineItemStore";
import { useTimelineCareEventStore } from "../../stores/timelineCareEventStore";
import { useUsageFactStore } from "../../stores/usageFactStore";
import { createBackupDocument } from "../../features/inventory/dataBackup";

const dialogMocks = vi.hoisted(() => ({ open: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: dialogMocks.open }));

beforeEach(() => {
  vi.clearAllMocks();
  useInventoryStore.setState({ products: [], lots: [], transactions: [], locations: [] });
  useItemProfileStore.setState({ profiles: [] });
  useTimelineItemStore.setState({ items: [] });
  useTimelineCareEventStore.setState({ events: [] });
  useUsageFactStore.setState({ facts: [] });
  useTimelineThemeStore.setState({ palette: { ...defaultTimelinePalette } });
  usePersistenceStatusStore.getState().setStatus("sqlite", "ready");
});

it("clears the location form after acknowledged creation without showing a false failure", async () => {
  setPersistenceCommandAdapterForTests(async <T,>(command: string, args?: Record<string, unknown>): Promise<T> => {
    if (command === "get_data_location") return { directory: "isolated", defaultDirectory: "isolated", isDefault: true } as T;
    if (command === "create_location") return args?.location as T;
    throw new Error(`Unexpected command ${command}`);
  });
  render(<SettingsPage />);
  const input = screen.getByLabelText("地点名称") as HTMLInputElement;
  fireEvent.change(input, { target: { value: "测试办公室" } });
  fireEvent.submit(input.closest("form")!);
  await waitFor(() => expect(useInventoryStore.getState().locations).toHaveLength(1));
  await waitFor(() => expect(input.value).toBe(""));
  expect(screen.queryByText(/Cannot read properties|保存地点失败/)).toBeNull();
});

it("preserves the location form and store when SQLite rejects creation", async () => {
  setPersistenceCommandAdapterForTests(async <T,>(command: string): Promise<T> => {
    if (command === "get_data_location") return { directory: "isolated", defaultDirectory: "isolated", isDefault: true } as T;
    throw new Error("database locked");
  });
  render(<SettingsPage />);
  const input = screen.getByLabelText("地点名称") as HTMLInputElement;
  fireEvent.change(input, { target: { value: "测试办公室" } });
  fireEvent.submit(input.closest("form")!);
  expect(await screen.findByText("database locked")).toBeTruthy();
  expect(input.value).toBe("测试办公室");
  expect(useInventoryStore.getState().locations).toEqual([]);
});
afterEach(() => {
  cleanup();
  setPersistenceCommandAdapterForTests(null);
});

it("keeps the committed color visible while SQLite saves and after rejection", async () => {
  let rejectSave!: (reason: Error) => void;
  const saving = new Promise<never>((_, reject) => {
    rejectSave = reject;
  });
  setPersistenceCommandAdapterForTests(async <T,>(command: string): Promise<T> => {
    if (command === "load_preferences") return collectPreferences() as T;
    if (command === "get_data_location")
      return { directory: "isolated", defaultDirectory: "isolated", isDefault: true } as T;
    if (command === "save_preferences") return saving;
    throw new Error(`Unexpected command ${command}`);
  });
  await bootstrapPreferencesPersistence();
  render(<SettingsPage />);
  const input = screen.getByLabelText(/使用中.*颜色/) as HTMLInputElement;
  fireEvent.change(input, { target: { value: "#123456" } });
  const pendingColor = useTimelineThemeStore.getState().palette.active;
  rejectSave(new Error("injected SQLite write failure"));
  await waitFor(() => expect(usePersistenceStatusStore.getState().phase).toBe("error"));
  expect(pendingColor).toBe(defaultTimelinePalette.active);
  expect(useTimelineThemeStore.getState().palette.active).toBe(defaultTimelinePalette.active);
  expect(input.value).toBe(defaultTimelinePalette.active);
});

it("clears a preference save failure after a successful retry", async () => {
  let attempts = 0;
  setPersistenceCommandAdapterForTests(async <T,>(command: string): Promise<T> => {
    if (command === "get_data_location")
      return { directory: "isolated", defaultDirectory: "isolated", isDefault: true } as T;
    if (command === "save_preferences" && attempts++ === 0)
      throw new Error("database busy");
    if (command === "save_preferences") return undefined as T;
    throw new Error(`Unexpected command ${command}`);
  });
  render(<SettingsPage />);

  const scope = screen.getAllByRole("combobox")[0]!;
  fireEvent.change(scope, { target: { value: "same_product" } });
  expect(await screen.findByText(/设置未保存：.*database busy/)).toBeTruthy();
  fireEvent.change(scope, { target: { value: "same_standard_type" } });

  await waitFor(() => expect(screen.queryByText(/设置未保存/)).toBeNull());
});

it("manages prediction preferences, data location, and the full location lifecycle", async () => {
  useInventoryStore.setState({
    products: [], lots: [], transactions: [],
    locations: [
      { id: "home", name: "家", active: true, order: 0 },
      { id: "office", name: "办公室", active: true, order: 1 },
      { id: "spare", name: "备用", active: false, order: 2 }
    ]
  });
  dialogMocks.open.mockResolvedValue("D:\\LensCycleData");
  setPersistenceCommandAdapterForTests(async <T,>(command: string, args?: Record<string, unknown>): Promise<T> => {
    if (command === "get_data_location") return {
      directory: "D:\\Current", defaultDirectory: "C:\\Default", isDefault: false
    } as T;
    if (command === "load_preferences") return collectPreferences() as T;
    if (command === "save_preferences" || command === "delete_location" ||
        command === "relocate_data" || command === "restart_app") return undefined as T;
    if (command === "update_location") return structuredClone(args?.location) as T;
    throw new Error(`Unexpected command ${command}`);
  });
  await bootstrapPreferencesPersistence();
  render(<SettingsPage />);
  expect(await screen.findByText("D:\\Current")).toBeTruthy();

  const selects = screen.getAllByRole("combobox");
  fireEvent.change(selects[0]!, { target: { value: "same_product" } });
  await waitFor(() => expect(useForecastSettingsStore.getState().consumptionHistoryScope).toBe("same_product"));
  fireEvent.change(selects[1]!, { target: { value: "recent_products" } });
  await waitFor(() => expect(screen.getByRole("spinbutton")).toBeTruthy());
  fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "5" } });
  await waitFor(() => expect(useForecastSettingsStore.getState().recentProductCount).toBe(5));

  const color = screen.getByLabelText(/使用中.*颜色/) as HTMLInputElement;
  fireEvent.change(color, { target: { value: "#123456" } });
  await waitFor(() => expect(useTimelineThemeStore.getState().palette.active).toBe("#123456"));
  fireEvent.click(screen.getByRole("button", { name: "恢复默认" }));
  await waitFor(() => expect(useTimelineThemeStore.getState().palette.active).toBe(defaultTimelinePalette.active));

  const office = screen.getByText("办公室").closest("article")!;
  fireEvent.click(office.querySelectorAll("button")[0]!);
  const name = screen.getByLabelText("地点名称") as HTMLInputElement;
  fireEvent.change(name, { target: { value: "公司" } });
  fireEvent.change(screen.getByLabelText("备注（选填）"), { target: { value: "工作日" } });
  fireEvent.submit(name.closest("form")!);
  await waitFor(() => expect(useInventoryStore.getState().locations[1]?.name).toBe("公司"));

  const spare = screen.getByText("备用").closest("article")!;
  fireEvent.click(Array.from(spare.querySelectorAll("button")).find((button) => button.textContent === "重新启用")!);
  await waitFor(() => expect(useInventoryStore.getState().locations.find((entry) => entry.id === "spare")?.active).toBe(true));
  const updatedSpare = screen.getByText("备用").closest("article")!;
  fireEvent.click(Array.from(updatedSpare.querySelectorAll("button")).find((button) => button.textContent === "删除")!);
  fireEvent.click(screen.getByRole("button", { name: "确认删除" }));
  await waitFor(() => expect(useInventoryStore.getState().locations.some((entry) => entry.id === "spare")).toBe(false));

  fireEvent.click(screen.getByRole("button", { name: "选择目录" }));
  expect(await screen.findByText("新位置：D:\\LensCycleData")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "取消" }));
  fireEvent.click(screen.getByRole("button", { name: "恢复默认位置" }));
  expect(await screen.findByText("新位置：C:\\Default")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "迁移并重启" }));
  await waitFor(() => expect(screen.getByText("迁移完成，正在重启应用…")).toBeTruthy());
});

it("creates and restores a verified backup through the settings UI", async () => {
  setPersistenceCommandAdapterForTests(async <T,>(command: string): Promise<T> => {
    if (command === "get_data_location") return {
      directory: "isolated", defaultDirectory: "isolated", isDefault: true
    } as T;
    if (command === "write_backup_file") return "D:\\Downloads\\backup.json" as T;
    if (command === "replace_app_data" || command === "save_preferences") return undefined as T;
    throw new Error(`Unexpected command ${command}`);
  });
  const backup = await createBackupDocument(new Date("2026-09-06T00:00:00.000Z"));
  const backupText = JSON.stringify(backup);
  render(<SettingsPage />);

  fireEvent.click(screen.getByRole("button", { name: "创建备份" }));
  expect(await screen.findByText("备份已保存：D:\\Downloads\\backup.json")).toBeTruthy();

  const fileInput = screen.getByLabelText("选择备份恢复") as HTMLInputElement;
  const file = { name: "verified.json", size: backupText.length, text: async () => backupText };
  fireEvent.change(fileInput, { target: { files: [file] } });
  expect(await screen.findByText("确认恢复“verified.json”？")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "取消" }));
  fireEvent.change(fileInput, { target: { files: [file] } });
  fireEvent.click(await screen.findByRole("button", { name: "确认恢复" }));
  expect(await screen.findByText("恢复成功，业务数据和偏好设置已更新。")).toBeTruthy();
});

it("offers an in-app exit that completes the safe SQLite shutdown command", async () => {
  const commands: string[] = [];
  setPersistenceCommandAdapterForTests(async <T,>(command: string): Promise<T> => {
    commands.push(command);
    if (command === "get_data_location") return {
      directory: "isolated", defaultDirectory: "isolated", isDefault: true
    } as T;
    if (command === "load_preferences") return collectPreferences() as T;
    if (command === "exit_app") return undefined as T;
    throw new Error(`Unexpected command ${command}`);
  });
  await bootstrapPreferencesPersistence();
  render(<SettingsPage />);

  fireEvent.click(screen.getByRole("button", { name: "退出应用" }));
  await waitFor(() => expect(commands).toContain("exit_app"));
  expect(screen.getByText("正在保存数据并安全关闭数据库…")).toBeTruthy();
});

it("reports data-location, restore-file, migration, and location-safety failures", async () => {
  useInventoryStore.setState({
    products: [{
      id: "product", itemProfileId: "profile", standardType: "scleral",
      brand: "测试", baseUnit: "片", unitsPerPackage: 1, active: true
    }],
    locations: [
      { id: "home", name: "家", active: true, order: 0 },
      { id: "office", name: "办公室", active: true, order: 1 }
    ],
    lots: [{
      id: "lot", productId: "product", internalLotCode: "LOT", receivedDate: "2026-09-01",
      locationId: "home", initialUnitQuantity: 1, unitPriceMinor: 100, currency: "CNY"
    }],
    transactions: [{
      id: "stock", stockLotId: "lot", occurredDate: "2026-09-01",
      type: "stock_in", quantityDelta: 1, locationId: "home"
    }]
  });
  dialogMocks.open.mockRejectedValueOnce(new Error("dialog unavailable"));
  setPersistenceCommandAdapterForTests(async <T,>(command: string): Promise<T> => {
    if (command === "get_data_location") return {
      directory: "D:\\Current", defaultDirectory: "C:\\Default", isDefault: false
    } as T;
    if (command === "relocate_data") throw new Error("disk unavailable");
    throw new Error(`Unexpected command ${command}`);
  });
  render(<SettingsPage />);
  await screen.findByText("D:\\Current");

  fireEvent.click(screen.getByRole("button", { name: "选择目录" }));
  expect(await screen.findByText(/选择目录失败：.*dialog unavailable/)).toBeTruthy();

  const home = screen.getByText("家").closest("article")!;
  fireEvent.click(Array.from(home.querySelectorAll("button")).find((button) => button.textContent === "停用")!);
  expect(screen.getByText("该地点仍有库存或正在使用的实例，请先转移后再停用")).toBeTruthy();

  const fileInput = screen.getByLabelText("选择备份恢复") as HTMLInputElement;
  fireEvent.change(fileInput, { target: { files: [] } });
  const oversized = { name: "huge.json", size: 51 * 1024 * 1024, text: async () => "{}" };
  fireEvent.change(fileInput, { target: { files: [oversized] } });
  expect(screen.getByText("备份文件超过 50 MB 安全限制")).toBeTruthy();
  const malformed = { name: "bad.json", size: 2, text: async () => "{}" };
  fireEvent.change(fileInput, { target: { files: [malformed] } });
  expect(await screen.findByText("备份文件缺少格式版本")).toBeTruthy();

  fireEvent.click(screen.getByRole("button", { name: "恢复默认位置" }));
  fireEvent.click(screen.getByRole("button", { name: "迁移并重启" }));
  expect(await screen.findByText(/数据位置迁移失败.*disk unavailable/)).toBeTruthy();
});

it("covers timeline location guards and non-Error repository failures", async () => {
  useInventoryStore.setState({
    products: [], lots: [], transactions: [],
    locations: [
      { id: "home", name: "家", active: true, order: 0 },
      { id: "office", name: "办公室", active: true, order: 1 }
    ]
  });
  useTimelineItemStore.setState({ items: [{
    id: "item", categoryId: "profile", groupId: "periodic", categoryName: "镜盒",
    label: "镜盒", detail: "", location: "办公室", locationId: "office",
    locationIntervals: [{ locationId: "home", startDate: "2026-09-01", endDate: "2026-09-02" },
      { locationId: "office", startDate: "2026-09-02", endDate: null }],
    startDate: "2026-09-01", endDate: null, status: "active"
  }] });
  setPersistenceCommandAdapterForTests(async <T,>(command: string): Promise<T> => {
    if (command === "get_data_location") return {
      directory: "isolated", defaultDirectory: "isolated", isDefault: true
    } as T;
    return Promise.reject("non-error repository failure") as Promise<T>;
  });
  render(<SettingsPage />);
  await screen.findByText("isolated");

  const office = screen.getByText("办公室").closest("article")!;
  fireEvent.click(Array.from(office.querySelectorAll("button")).find((button) => button.textContent === "停用")!);
  expect(screen.getByText("该地点仍有库存或正在使用的实例，请先转移后再停用")).toBeTruthy();

  useTimelineItemStore.setState({ items: [] });
  const home = screen.getByText("家").closest("article")!;
  fireEvent.click(Array.from(home.querySelectorAll("button")).find((button) => button.textContent === "停用")!);
  expect(await screen.findByText("更新地点失败")).toBeTruthy();

  const name = screen.getByLabelText("地点名称") as HTMLInputElement;
  fireEvent.change(name, { target: { value: "随身" } });
  fireEvent.submit(name.closest("form")!);
  expect(await screen.findByText("保存地点失败")).toBeTruthy();
});

it("reports backup and restore commit failures and handles a cancelled directory picker", async () => {
  dialogMocks.open.mockResolvedValue(null);
  setPersistenceCommandAdapterForTests(async <T,>(command: string): Promise<T> => {
    if (command === "get_data_location") return {
      directory: "isolated", defaultDirectory: "isolated", isDefault: true
    } as T;
    if (command === "write_backup_file") throw new Error("backup disk full");
    if (command === "replace_app_data") throw new Error("restore commit failed");
    throw new Error(`Unexpected command ${command}`);
  });
  const backup = await createBackupDocument(new Date("2026-09-06T00:00:00.000Z"));
  const backupText = JSON.stringify(backup);
  render(<SettingsPage />);
  await screen.findByText("isolated");

  fireEvent.click(screen.getByRole("button", { name: "创建备份" }));
  expect(await screen.findByText("backup disk full")).toBeTruthy();

  fireEvent.click(screen.getByRole("button", { name: "选择目录" }));
  await waitFor(() => expect(dialogMocks.open).toHaveBeenCalledOnce());
  expect(screen.queryByText(/新位置：/)).toBeNull();

  const fileInput = screen.getByLabelText("选择备份恢复") as HTMLInputElement;
  const file = { name: "valid.json", size: backupText.length, text: async () => backupText };
  fireEvent.change(fileInput, { target: { files: [file] } });
  fireEvent.click(await screen.findByRole("button", { name: "确认恢复" }));
  expect(await screen.findByText(/恢复失败，当前数据未被覆盖：restore commit failed/)).toBeTruthy();
});
