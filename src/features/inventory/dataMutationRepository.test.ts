import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyAppDataSnapshot, collectAppDataSnapshot, type AppDataSnapshot } from "./appDataSnapshot";
import {
  completeBatchConsumableTimelineItem,
  commitTimelineItemInventoryUpdate,
  commitTimelineItemUpdates,
  commitDataMutation,
  deleteMistakenTimelineItem,
  reopenDiscardedTimelineItems
} from "./dataMutationRepository";
import {
  setPersistenceCommandAdapterForTests,
  type PersistenceCommandAdapter
} from "./persistenceGateway";
import { useTimelineItemStore } from "../../stores/timelineItemStore";
import { useInventoryStore } from "../../stores/inventoryStore";
import { useUsageFactStore } from "../../stores/usageFactStore";
import { useTimelineCareEventStore } from "../../stores/timelineCareEventStore";

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

  it("deletes a mistaken instance incrementally after SQLite acknowledges the mutation", async () => {
    const source = fixture();
    source.transactions.push({
      id: "consume",
      stockLotId: "lot",
      occurredDate: "2026-08-26",
      type: "consume",
      quantityDelta: -1,
      locationId: "home",
      relatedInstanceId: "item"
    });
    source.usageFacts.push({
      id: "fact",
      itemId: "item",
      stockLotId: "lot",
      transactionId: "consume",
      date: "2026-08-26",
      kind: "wear",
      quantity: 1
    });
    source.careEvents.push({
      id: "care",
      itemId: "item",
      kind: "review",
      plannedDate: "2026-08-27"
    });
    applyAppDataSnapshot(source);

    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const adapter = vi.fn();
    setPersistenceCommandAdapterForTests(async <T>(
      command: string,
      args?: Record<string, unknown>
    ) => {
      adapter(command, args);
      await gate;
      return undefined as T;
    });
    const clone = vi.spyOn(globalThis, "structuredClone");

    const pending = deleteMistakenTimelineItem("item", "2026-08-28");
    expect(useTimelineItemStore.getState().items).toHaveLength(1);
    expect(useUsageFactStore.getState().facts).toHaveLength(1);
    expect(useTimelineCareEventStore.getState().events).toHaveLength(1);
    expect(clone).not.toHaveBeenCalled();

    release();
    await pending;

    expect(useTimelineItemStore.getState().items).toHaveLength(0);
    expect(useUsageFactStore.getState().facts).toHaveLength(0);
    expect(useTimelineCareEventStore.getState().events).toHaveLength(0);
    const transactions = useInventoryStore.getState().transactions;
    expect(transactions.filter((entry) => entry.type === "reverse")).toEqual([
      expect.objectContaining({
        stockLotId: "lot",
        quantityDelta: 1,
        reversedTransactionId: "activate",
        locationId: "home"
      }),
      expect.objectContaining({
        stockLotId: "lot",
        quantityDelta: 1,
        reversedTransactionId: "consume",
        locationId: "home"
      })
    ]);
    expect(adapter).toHaveBeenCalledWith("commit_app_data_mutation", {
      mutation: expect.objectContaining({
        deleteItemIds: ["item"],
        deleteUsageFactIds: ["fact"],
        deleteCareEventIds: ["care"],
        appendTransactions: expect.arrayContaining([
          expect.objectContaining({ reversedTransactionId: "activate" }),
          expect.objectContaining({ reversedTransactionId: "consume" })
        ])
      })
    });
  });

  it("keeps all stores unchanged when incremental mistaken-item deletion fails", async () => {
    setPersistenceCommandAdapterForTests(async () => {
      throw new Error("database locked");
    });
    const before = collectAppDataSnapshot();

    await expect(
      deleteMistakenTimelineItem("item", "2026-08-28")
    ).rejects.toThrow("database locked");

    expect(collectAppDataSnapshot()).toEqual(before);
  });

  it("deletes a rescheduled care-solution item and reverses every current stock effect", async () => {
    const source = fixture();
    source.profiles[0] = {
      ...source.profiles[0]!,
      groupId: "consumables",
      managementTemplate: "opened_container",
      standardType: "care_solution",
      name: "护理液"
    };
    source.products[0] = {
      ...source.products[0]!,
      standardType: "care_solution",
      brand: "测试护理液",
      baseUnit: "瓶"
    };
    source.items[0] = {
      ...source.items[0]!,
      groupId: "consumables",
      categoryName: "护理液",
      label: "护理液实例"
    };
    source.transactions.push(
      {
        id: "reverse-old-activation",
        stockLotId: "lot",
        occurredDate: "2026-08-26",
        type: "reverse",
        quantityDelta: 1,
        relatedInstanceId: "item",
        reversedTransactionId: "activate",
        locationId: "home"
      },
      {
        id: "rescheduled-activation",
        stockLotId: "lot",
        occurredDate: "2026-08-26",
        type: "activate",
        quantityDelta: -1,
        relatedInstanceId: "item",
        locationId: "home"
      },
      {
        id: "instance-correction",
        stockLotId: "lot",
        occurredDate: "2026-08-27",
        type: "correction",
        quantityDelta: 1,
        relatedInstanceId: "item",
        locationId: "home"
      }
    );
    applyAppDataSnapshot(source);
    const adapter = vi.fn();
    setPersistenceCommandAdapterForTests(async <T>(
      command: string,
      args?: Record<string, unknown>
    ) => {
      adapter(command, args);
      return undefined as T;
    });

    await deleteMistakenTimelineItem("item", "2026-08-28");

    expect(adapter).toHaveBeenCalledWith("commit_app_data_mutation", {
      mutation: expect.objectContaining({
        deleteItemIds: ["item"],
        appendTransactions: expect.arrayContaining([
          expect.objectContaining({
            reversedTransactionId: "rescheduled-activation",
            quantityDelta: 1
          }),
          expect.objectContaining({
            reversedTransactionId: "instance-correction",
            quantityDelta: -1
          })
        ])
      })
    });
    const appendedReversals = useInventoryStore
      .getState()
      .transactions.filter((entry) => entry.type === "reverse");
    expect(appendedReversals).toHaveLength(3);
    expect(
      appendedReversals.filter(
        (entry) => entry.reversedTransactionId === "activate"
      )
    ).toEqual([expect.objectContaining({ id: "reverse-old-activation" })]);
  });

  it("publishes lifecycle changes incrementally only after SQLite acknowledges them", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    setPersistenceCommandAdapterForTests(async <T>() => {
      await gate;
      return undefined as T;
    });
    const clone = vi.spyOn(globalThis, "structuredClone");

    const pending = commitTimelineItemUpdates((items) =>
      items.map((item) =>
        item.id === "item"
          ? {
              ...item,
              status: "paused" as const,
              stateIntervals: [
                {
                  startDate: item.startDate,
                  endDate: "2026-08-26",
                  status: "active" as const
                },
                {
                  startDate: "2026-08-26",
                  endDate: null,
                  status: "paused" as const
                }
              ]
            }
          : item
      )
    );
    expect(useTimelineItemStore.getState().items[0]?.status).toBe("active");
    expect(clone).not.toHaveBeenCalled();

    release();
    await pending;
    expect(useTimelineItemStore.getState().items[0]?.status).toBe("paused");
    expect(clone).not.toHaveBeenCalled();
  });

  it("publishes a location and inventory transfer together after SQLite acknowledges", async () => {
    useInventoryStore.setState((state) => ({
      locations: [
        ...state.locations,
        { id: "office", name: "办公室", active: true, order: 1 }
      ]
    }));
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    setPersistenceCommandAdapterForTests(async <T>() => {
      await gate;
      return undefined as T;
    });
    const source = useTimelineItemStore.getState().items[0]!;
    const moved = {
      ...source,
      locationId: "office",
      location: "办公室",
      locationIntervals: [
        { locationId: "home", startDate: "2026-08-25" as const, endDate: "2026-08-26" as const },
        { locationId: "office", startDate: "2026-08-26" as const, endDate: null }
      ]
    };
    const transfer = {
      id: "transfer-all",
      stockLotId: "lot",
      occurredDate: "2026-08-26" as const,
      type: "transfer" as const,
      quantityDelta: 0,
      fromLocationId: "home",
      toLocationId: "office",
      transferQuantity: 1
    };
    const clone = vi.spyOn(globalThis, "structuredClone");

    const pending = commitTimelineItemInventoryUpdate(moved, [transfer]);
    expect(useTimelineItemStore.getState().items[0]?.locationId).toBe("home");
    expect(useInventoryStore.getState().transactions).toHaveLength(3);
    expect(clone).not.toHaveBeenCalled();

    release();
    await pending;
    expect(useTimelineItemStore.getState().items[0]?.locationId).toBe("office");
    expect(useInventoryStore.getState().transactions.at(-1)).toEqual(transfer);
    expect(clone).not.toHaveBeenCalled();
  });

  it("rejects an incremental transfer to an inactive location before SQLite", async () => {
    useInventoryStore.setState((state) => ({
      locations: [
        ...state.locations,
        { id: "office", name: "办公室", active: false, order: 1 }
      ]
    }));
    const adapter = vi.fn();
    setPersistenceCommandAdapterForTests(adapter);
    await expect(commitTimelineItemInventoryUpdate(
      useTimelineItemStore.getState().items[0]!,
      [{
        id: "invalid-transfer",
        stockLotId: "lot",
        occurredDate: "2026-08-26",
        type: "transfer",
        quantityDelta: 0,
        fromLocationId: "home",
        toLocationId: "office",
        transferQuantity: 1
      }]
    )).rejects.toThrow("不可用");
    expect(adapter).not.toHaveBeenCalled();
    expect(useInventoryStore.getState().transactions).toHaveLength(3);
  });

  it("ends a batch consumable with a user-confirmed loss after SQLite acknowledges", async () => {
    const source = fixture();
    source.profiles[0] = {
      ...source.profiles[0]!, groupId: "consumables",
      managementTemplate: "batch_consumable", standardType: "saline",
      name: "擦手纸", baseUnit: "张"
    };
    source.products[0] = {
      ...source.products[0]!, standardType: "saline", baseUnit: "张"
    };
    source.transactions = source.transactions.filter((entry) => entry.id !== "activate");
    source.items[0] = {
      ...source.items[0]!, groupId: "consumables", categoryName: "擦手纸",
      initialUnitQuantity: 2, usageRatePerDay: 1
    };
    applyAppDataSnapshot(source);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    setPersistenceCommandAdapterForTests(async <T>() => {
      await gate;
      return undefined as T;
    });
    const clone = vi.spyOn(globalThis, "structuredClone");

    const pending = completeBatchConsumableTimelineItem("item", "2026-08-26", 0);
    expect(useTimelineItemStore.getState().items[0]?.status).toBe("active");
    expect(useInventoryStore.getState().transactions).toHaveLength(2);
    expect(useUsageFactStore.getState().facts).toHaveLength(0);
    expect(clone).not.toHaveBeenCalled();

    release();
    await expect(pending).resolves.toMatchObject({
      ledgerRemaining: 2, actualRemainingQuantity: 0, difference: -2
    });
    expect(useTimelineItemStore.getState().items[0]).toMatchObject({
      status: "completed", endDate: "2026-08-27"
    });
    expect(useInventoryStore.getState().transactions.at(-1)).toMatchObject({
      type: "loss", quantityDelta: -2, locationId: "home",
      relatedInstanceId: "item"
    });
    expect(useUsageFactStore.getState().facts[0]).toMatchObject({
      itemId: "item", kind: "extra_loss", quantity: 2, date: "2026-08-26"
    });
    expect(clone).not.toHaveBeenCalled();
  });

  it("uses a correction when the confirmed batch quantity exceeds the ledger", async () => {
    const source = fixture();
    source.profiles[0] = {
      ...source.profiles[0]!, groupId: "consumables",
      managementTemplate: "batch_consumable", standardType: "saline"
    };
    source.products[0] = { ...source.products[0]!, standardType: "saline" };
    source.transactions = source.transactions.filter((entry) => entry.id !== "activate");
    source.items[0] = {
      ...source.items[0]!, groupId: "consumables", initialUnitQuantity: 2,
      usageRatePerDay: 1
    };
    applyAppDataSnapshot(source);
    setPersistenceCommandAdapterForTests(async <T>() => undefined as T);

    await completeBatchConsumableTimelineItem("item", "2026-08-26", 3);

    expect(useInventoryStore.getState().transactions.at(-1)).toMatchObject({
      type: "correction", quantityDelta: 1, locationId: "home"
    });
    expect(useUsageFactStore.getState().facts).toHaveLength(0);
  });

  it("ends a batch consumable without an adjustment when the count matches", async () => {
    const source = fixture();
    source.profiles[0] = {
      ...source.profiles[0]!, groupId: "consumables",
      managementTemplate: "batch_consumable", standardType: "saline"
    };
    source.products[0] = { ...source.products[0]!, standardType: "saline" };
    source.transactions = source.transactions.filter((entry) => entry.id !== "activate");
    source.items[0] = {
      ...source.items[0]!, groupId: "consumables", initialUnitQuantity: 2,
      usageRatePerDay: 1
    };
    applyAppDataSnapshot(source);
    const adapter = vi.fn();
    setPersistenceCommandAdapterForTests(adapter);

    await expect(
      completeBatchConsumableTimelineItem("item", "2026-08-26", 2)
    ).resolves.toMatchObject({ difference: 0 });

    expect(useInventoryStore.getState().transactions).toHaveLength(2);
    expect(useUsageFactStore.getState().facts).toHaveLength(0);
    expect(adapter).toHaveBeenCalledWith("commit_app_data_mutation", {
      mutation: expect.objectContaining({ appendTransactions: [], upsertUsageFacts: [] })
    });
  });

  it("keeps batch state unchanged when completion persistence fails", async () => {
    const source = fixture();
    source.profiles[0] = {
      ...source.profiles[0]!, groupId: "consumables",
      managementTemplate: "batch_consumable", standardType: "saline"
    };
    source.products[0] = { ...source.products[0]!, standardType: "saline" };
    source.transactions = source.transactions.filter((entry) => entry.id !== "activate");
    source.items[0] = {
      ...source.items[0]!, groupId: "consumables", initialUnitQuantity: 2,
      usageRatePerDay: 1
    };
    applyAppDataSnapshot(source);
    const before = collectAppDataSnapshot();
    setPersistenceCommandAdapterForTests(async () => {
      throw new Error("batch write failed");
    });

    await expect(
      completeBatchConsumableTimelineItem("item", "2026-08-26", 0)
    ).rejects.toThrow("batch write failed");
    expect(collectAppDataSnapshot()).toEqual(before);
  });

  it("reopens a discarded item and reverses its fact without a full snapshot", async () => {
    const source = fixture();
    source.transactions.push({
      id: "discard",
      stockLotId: "lot",
      occurredDate: "2026-08-26",
      type: "loss",
      quantityDelta: -1,
      locationId: "home",
      relatedInstanceId: "item"
    });
    source.usageFacts.push({
      id: "discard-fact",
      itemId: "item",
      stockLotId: "lot",
      transactionId: "discard",
      date: "2026-08-26",
      kind: "extra_loss",
      quantity: 1
    });
    source.items[0] = {
      ...source.items[0]!,
      status: "completed",
      endDate: "2026-08-27",
      endReason: "提前结束/丢弃",
      completionUsageFactId: "discard-fact",
      stateIntervals: [
        {
          startDate: "2026-08-25",
          endDate: "2026-08-27",
          status: "active"
        }
      ],
      locationIntervals: [
        {
          locationId: "home",
          startDate: "2026-08-25",
          endDate: "2026-08-27"
        }
      ]
    };
    applyAppDataSnapshot(source);
    const adapter = vi.fn();
    const commandAdapter: PersistenceCommandAdapter = async <T>(
      command: string,
      args?: Record<string, unknown>
    ) => {
      adapter(command, args);
      return undefined as T;
    };
    setPersistenceCommandAdapterForTests(commandAdapter);
    const reopened = {
      ...source.items[0]!,
      status: "active" as const,
      endDate: null,
      stateIntervals: [
        { startDate: "2026-08-25" as const, endDate: null, status: "active" as const }
      ],
      locationIntervals: [
        { locationId: "home", startDate: "2026-08-25" as const, endDate: null }
      ]
    };
    delete reopened.endReason;
    delete reopened.completionUsageFactId;
    const clone = vi.spyOn(globalThis, "structuredClone");

    await reopenDiscardedTimelineItems(
      "discard-fact",
      "2026-08-28",
      [reopened]
    );

    expect(useTimelineItemStore.getState().items[0]?.status).toBe("active");
    expect(useUsageFactStore.getState().facts).toHaveLength(0);
    expect(useInventoryStore.getState().transactions.at(-1)).toEqual(
      expect.objectContaining({
        type: "reverse",
        reversedTransactionId: "discard",
        locationId: "home"
      })
    );
    expect(clone).not.toHaveBeenCalled();
  });
});
