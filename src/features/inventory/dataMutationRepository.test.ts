import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyAppDataSnapshot, collectAppDataSnapshot, type AppDataSnapshot } from "./appDataSnapshot";
import { commitDataMutation } from "./dataMutationRepository";
import {
  setPersistenceCommandAdapterForTests,
  type PersistenceCommandAdapter
} from "./persistenceGateway";
import { useTimelineItemStore } from "../../stores/timelineItemStore";
import { useInventoryStore } from "../../stores/inventoryStore";

function fixture(): AppDataSnapshot {
  return {
    schemaVersion: 1,
    profiles: [{ id: "p", groupId: "lenses", managementTemplate: "rigid_long_term", standardType: "scleral", name: "镜片", baseUnit: "片", side: "L", active: true, order: 0 }],
    products: [{ id: "product", itemProfileId: "p", standardType: "scleral", brand: "测试", baseUnit: "片", unitsPerPackage: 1, active: true }],
    locations: [{ id: "home", name: "家", active: true, order: 0 }],
    lots: [{ id: "lot", productId: "product", internalLotCode: "test", receivedDate: "2026-08-25", locationId: "home", initialUnitQuantity: 2, unitPriceMinor: 100, currency: "CNY" }],
    transactions: [{ id: "in", stockLotId: "lot", occurredDate: "2026-08-25", type: "stock_in", quantityDelta: 2, locationId: "home" }, { id: "activate", stockLotId: "lot", occurredDate: "2026-08-25", type: "activate", quantityDelta: -1, locationId: "home", relatedInstanceId: "item" }, { id: "audit-adjustment", stockLotId: "lot", occurredDate: "2026-08-25", type: "correction", quantityDelta: 0, locationId: "home", reason: "盘点确认" }],
    items: [{ id: "item", categoryId: "p", groupId: "lenses", categoryName: "镜片", productId: "product", sourceStockLotId: "lot", label: "原名称", detail: "", location: "家", locationId: "home", locationIntervals: [{ locationId: "home", startDate: "2026-08-25", endDate: null }], startDate: "2026-08-25", endDate: null, status: "active", stateIntervals: [{ startDate: "2026-08-25", endDate: null, status: "active" }] }],
    usageFacts: [], careEvents: []
  };
}

function rename() {
  useTimelineItemStore.setState(({ items }) => ({ items: items.map(item => ({ ...item, label: "新名称" })) }));
  return "result";
}

describe("combined SQLite mutations", () => {
  beforeEach(() => applyAppDataSnapshot(fixture()));
  afterEach(() => { setPersistenceCommandAdapterForTests(null); vi.restoreAllMocks(); });

  it("publishes no candidate to subscribers before commit acknowledgement", async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    setPersistenceCommandAdapterForTests(async <T>() => { await gate; return undefined as T; });
    const listener = vi.fn();
    const unsubscribe = useTimelineItemStore.subscribe(listener);
    try {
      const pending = commitDataMutation(rename);
      const callsBeforeCommit = listener.mock.calls.length;
      expect(collectAppDataSnapshot()).toEqual(fixture());
      release();
      expect(await pending).toBe("result");
      expect(callsBeforeCommit).toBe(0);
      expect(listener).toHaveBeenCalledTimes(1);
      expect(useTimelineItemStore.getState().items[0]?.label).toBe("新名称");
    } finally { unsubscribe(); }
  });

  it("does not publish any intermediate state when SQLite rejects", async () => {
    setPersistenceCommandAdapterForTests(async () => { throw new Error("disk full"); });
    const listener = vi.fn();
    const unsubscribe = useTimelineItemStore.subscribe(listener);
    try {
      await expect(commitDataMutation(rename)).rejects.toThrow("disk full");
      expect(collectAppDataSnapshot()).toEqual(fixture());
      expect(listener).not.toHaveBeenCalled();
    } finally { unsubscribe(); }
  });

  it("rolls back a throwing candidate without invoking SQLite or notifying", async () => {
    const adapter = vi.fn();
    setPersistenceCommandAdapterForTests(adapter);
    const listener = vi.fn();
    const unsubscribe = useTimelineItemStore.subscribe(listener);
    try {
      await expect(commitDataMutation(() => { rename(); throw new Error("invalid action"); })).rejects.toThrow("invalid action");
      expect(collectAppDataSnapshot()).toEqual(fixture());
      expect(adapter).not.toHaveBeenCalled();
      expect(listener).not.toHaveBeenCalled();
    } finally { unsubscribe(); }
  });

  it("rejects changes to collections not supported by the mutation command", async () => {
    const adapter = vi.fn();
    setPersistenceCommandAdapterForTests(adapter);
    await expect(commitDataMutation(() => useInventoryStore.setState(({ locations }) => ({ locations: locations.map(location => ({ ...location, name: "未持久化" })) })))).rejects.toThrow("不支持");
    expect(adapter).not.toHaveBeenCalled();
    expect(collectAppDataSnapshot()).toEqual(fixture());
  });

  it("rejects deleting or overwriting a committed inventory transaction", async () => {
    const adapter = vi.fn();
    setPersistenceCommandAdapterForTests(adapter);
    await expect(commitDataMutation(() => useInventoryStore.setState(({ transactions }) => ({
      transactions: transactions.filter((entry) => entry.id !== "audit-adjustment")
    })))).rejects.toThrow("库存流水不可删除");
    await expect(commitDataMutation(() => useInventoryStore.setState(({ transactions }) => ({
      transactions: transactions.map((entry) => entry.id === "audit-adjustment"
        ? { ...entry, reason: "覆盖历史" }
        : entry)
    })))).rejects.toThrow("库存流水不可覆盖");
    expect(adapter).not.toHaveBeenCalled();
    expect(collectAppDataSnapshot()).toEqual(fixture());
  });

  it("deletes an instance only by appending a reversal and preserving its original ledger", async () => {
    const adapter = vi.fn();
    const commandAdapter: PersistenceCommandAdapter = async <T>(
      command: string,
      args?: Record<string, unknown>
    ) => {
      adapter(command, args);
      return undefined as T;
    };
    setPersistenceCommandAdapterForTests(commandAdapter);
    await commitDataMutation(() => {
      useTimelineItemStore.setState({ items: [] });
      useInventoryStore.setState(({ transactions }) => ({
        transactions: [...transactions, {
          id: "reverse-activate", stockLotId: "lot", occurredDate: "2026-08-26",
          type: "reverse", quantityDelta: 1, reversedTransactionId: "activate",
          reason: "撤销使用实例"
        }]
      }));
    });
    expect(adapter).toHaveBeenCalledWith("commit_app_data_mutation", {
      mutation: expect.objectContaining({
        deleteItemIds: ["item"],
        appendTransactions: [expect.objectContaining({ id: "reverse-activate" })]
      })
    });
    expect(useInventoryStore.getState().transactions.map((entry) => entry.id)).toContain("activate");
    expect(useInventoryStore.getState().transactions.map((entry) => entry.id)).toContain("reverse-activate");
  });
});
