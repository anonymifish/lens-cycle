import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyAppDataSnapshot } from "./appDataSnapshot";
import {
  createBackupDocument,
  parseBackupText,
  restoreBackupText
} from "./dataBackup";
import type { AppDataSnapshot } from "./appDataSnapshot";
import { applyPreferences, collectPreferences } from "./preferencesPersistence";
import { setPersistenceCommandAdapterForTests } from "./persistenceGateway";

function snapshot(): AppDataSnapshot {
  return {
    schemaVersion: 1,
    profiles: [{
      id: "profile-1",
      groupId: "periodic",
      managementTemplate: "lens_case",
      standardType: "lens_case",
      name: "镜盒",
      baseUnit: "个",
      defaultDurationDays: 90,
      active: true,
      order: 0
    }],
    products: [{
      id: "product-1",
      itemProfileId: "profile-1",
      standardType: "lens_case",
      brand: "测试镜盒",
      baseUnit: "个",
      unitsPerPackage: 1,
      active: true
    }],
    locations: [{ id: "home", name: "家", active: true, order: 0 }],
    lots: [{
      id: "lot-1",
      productId: "product-1",
      internalLotCode: "20260827-1",
      receivedDate: "2026-08-27",
      locationId: "home",
      initialUnitQuantity: 1,
      unitPriceMinor: 123456,
      currency: "CNY"
    }],
    transactions: [{
      id: "stock-in-1",
      stockLotId: "lot-1",
      occurredDate: "2026-08-27",
      type: "stock_in",
      quantityDelta: 1,
      locationId: "home"
    }],
    items: [],
    usageFacts: [],
    careEvents: []
  };
}

describe("data backup files", () => {
  beforeEach(() => applyAppDataSnapshot(snapshot()));
  afterEach(() => setPersistenceCommandAdapterForTests(null));

  it("round-trips a versioned backup with a checksum", async () => {
    const document = await createBackupDocument(new Date("2026-08-27T10:00:00.000Z"));
    const parsed = await parseBackupText(JSON.stringify(document));

    expect(document.formatVersion).toBe(2);
    expect(document.priceScale).toBe(10_000);
    expect(document.exportedAt).toBe("2026-08-27T10:00:00.000Z");
    expect(document.checksum).toMatch(/^[a-f0-9]{64}$/);
    expect(parsed.data).toEqual(snapshot());
  });

  it("rejects modified content before it can be restored", async () => {
    const document = await createBackupDocument();
    document.data.locations[0]!.name = "被修改";

    await expect(parseBackupText(JSON.stringify(document))).rejects.toThrow("校验失败");
  });

  it("rejects invalid and future-version files", async () => {
    await expect(parseBackupText("{broken")).rejects.toThrow("不是有效的 JSON");
    await expect(parseBackupText(JSON.stringify({ formatVersion: 99 }))).rejects.toThrow(
      "仅支持备份格式版本 1 或 2"
    );
  });

  it("rejects a version-zero backup", async () => {
    const versionZeroBackup = {
      formatVersion: 0,
      exportedAt: "2026-08-27T10:00:00.000Z",
      data: snapshot()
    };
    await expect(parseBackupText(JSON.stringify(versionZeroBackup))).rejects.toThrow(
      "仅支持备份格式版本 1 或 2"
    );
  });

  it("upgrades legacy cent-based backup prices without changing their yuan value", async () => {
    const current = await createBackupDocument(new Date("2026-08-27T10:00:00.000Z"));
    const legacy = structuredClone(current) as unknown as Record<string, unknown>;
    legacy.formatVersion = 1;
    delete legacy.priceScale;
    const data = legacy.data as AppDataSnapshot;
    data.lots[0]!.unitPriceMinor = 1234;
    delete legacy.checksum;
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(JSON.stringify(legacy))
    );
    legacy.checksum = [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");

    const parsed = await parseBackupText(JSON.stringify(legacy));
    expect(parsed.data.lots[0]!.unitPriceMinor).toBe(123400);
  });

  it("refuses to create a backup from broken business references", async () => {
    const broken = snapshot();
    broken.lots[0]!.productId = "missing";
    applyAppDataSnapshot(broken);
    await expect(createBackupDocument()).rejects.toThrow("数据完整性检查失败");
  });

  it("restores business data and preferences in one persisted operation", async () => {
    const document = await createBackupDocument(new Date("2026-08-27T10:00:00.000Z"));
    const restoredPreferences = structuredClone(document.preferences);
    applyPreferences({ ...collectPreferences(), recentProductCount: 11 });
    const adapter = vi.fn();
    setPersistenceCommandAdapterForTests(async <T>(
      command: string,
      args?: Record<string, unknown>
    ): Promise<T> => {
      adapter(command, args);
      return undefined as T;
    });

    await restoreBackupText(JSON.stringify(document));

    expect(adapter).toHaveBeenCalledWith("replace_app_data", {
      snapshot: document.data,
      preferences: restoredPreferences
    });
    expect(collectPreferences()).toEqual(restoredPreferences);
  });

  it("rejects malformed format, collections, records, preferences, and metadata", async () => {
    const document = await createBackupDocument();
    await expect(parseBackupText(JSON.stringify({ ...document, format: "other" })))
      .rejects.toThrow("不支持的备份文件格式");
    const missingCollection = structuredClone(document) as unknown as Record<string, unknown>;
    (missingCollection.data as Record<string, unknown>).lots = null;
    await expect(parseBackupText(JSON.stringify(missingCollection)))
      .rejects.toThrow("业务数据集合缺失");
    const badRecord = structuredClone(document) as unknown as Record<string, unknown>;
    (badRecord.data as Record<string, unknown>).locations = [{}];
    await expect(parseBackupText(JSON.stringify(badRecord)))
      .rejects.toThrow("包含无效记录");
    const badPreferences = structuredClone(document) as unknown as Record<string, unknown>;
    (badPreferences.preferences as Record<string, unknown>).recentProductCount = 0;
    await expect(parseBackupText(JSON.stringify(badPreferences)))
      .rejects.toThrow("预测产品数量无效");
    const badMetadata = structuredClone(document) as unknown as Record<string, unknown>;
    badMetadata.exportedAt = "not-a-date";
    await expect(parseBackupText(JSON.stringify(badMetadata)))
      .rejects.toThrow("结构无效或缺少必要字段");
  });
});

