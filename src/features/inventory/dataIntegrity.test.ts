import { describe, expect, it } from "vitest";
import {
  validateDataIntegrity,
  type DataIntegrityInput
} from "./dataIntegrity";

function validData(): DataIntegrityInput {
  return {
    profiles: [
      {
        id: "profile-1",
        groupId: "lenses",
        managementTemplate: "rigid_long_term",
        standardType: "scleral",
        name: "巩膜镜（L）",
        side: "L",
        defaultDurationDays: 365,
        active: true,
        order: 0
      }
    ],
    products: [
      {
        id: "product-1",
        itemProfileId: "profile-1",
        standardType: "scleral",
        brand: "测试品牌",
        baseUnit: "片",
        unitsPerPackage: 1,
        defaultDurationDays: 365,
        active: true
      }
    ],
    locations: [
      { id: "home", name: "家", active: true, order: 0 },
      { id: "office", name: "办公室", active: true, order: 1 }
    ],
    lots: [
      {
        id: "lot-1",
        productId: "product-1",
        internalLotCode: "20260801-1",
        manufacturedDate: "2026-07-01",
        receivedDate: "2026-08-01",
        locationId: "home",
        initialUnitQuantity: 2,
        expectedUsageDays: 365,
        unitPriceMinor: 10000,
        currency: "CNY"
      }
    ],
    transactions: [
      {
        id: "stock-in-1",
        stockLotId: "lot-1",
        occurredDate: "2026-08-01",
        type: "stock_in",
        quantityDelta: 2,
        locationId: "home"
      },
      {
        id: "activate-1",
        stockLotId: "lot-1",
        occurredDate: "2026-08-02",
        type: "activate",
        quantityDelta: -1,
        relatedInstanceId: "item-1",
        locationId: "home"
      }
    ],
    items: [
      {
        id: "item-1",
        categoryId: "profile-1",
        groupId: "lenses",
        categoryName: "巩膜镜（L）",
        productId: "product-1",
        sourceStockLotId: "lot-1",
        label: "左眼镜片",
        detail: "使用中",
        location: "家",
        locationId: "home",
        locationIntervals: [
          { locationId: "home", startDate: "2026-08-02", endDate: null }
        ],
        startDate: "2026-08-02",
        endDate: null,
        predictionDate: "2027-08-01",
        status: "active",
        stateIntervals: [
          { startDate: "2026-08-02", endDate: null, status: "active" }
        ]
      }
    ],
    usageFacts: [],
    careEvents: []
  };
}

function messages(data: DataIntegrityInput) {
  return validateDataIntegrity(data).map((issue) => issue.message);
}

describe("data integrity", () => {
  it("accepts a fully linked and balanced data graph", () => {
    expect(validateDataIntegrity(validData())).toEqual([]);
  });

  it("accepts a voided unused lot only when its stock-in reversal is retained", () => {
    const data = validData();
    data.items = [];
    data.transactions = [
      data.transactions[0]!,
      {
        id: "void-stock-in", stockLotId: "lot-1", occurredDate: "2026-09-06",
        type: "reverse", quantityDelta: -2, reversedTransactionId: "stock-in-1"
      }
    ];
    Object.assign(data.lots[0]!, {
      voidedAt: "2026-09-06",
      voidedByTransactionId: "void-stock-in"
    });
    expect(validateDataIntegrity(data)).toEqual([]);

    data.lots[0]!.voidedByTransactionId = "stock-in-1";
    expect(messages(data)).toContain("批次作废流水引用无效");
  });

  it("reports broken references and reverse transactions", () => {
    const issues = validateDataIntegrity({
      profiles: [],
      products: [],
      locations: [],
      lots: [],
      items: [],
      usageFacts: [],
      careEvents: [],
      transactions: [
        {
          id: "reverse-1",
          stockLotId: "missing-lot",
          occurredDate: "2026-08-01",
          type: "reverse",
          quantityDelta: 1
        }
      ]
    });
    expect(issues.map((issue) => issue.message)).toEqual([
      "库存批次不存在",
      "撤销流水缺少有效原流水"
    ]);
  });

  it("detects duplicate ids, names, lot codes, and malformed package totals", () => {
    const data = validData();
    data.locations.push({
      id: "office",
      name: " 家 ",
      active: true,
      order: 0
    });
    data.lots.push({
      ...data.lots[0]!,
      id: "lot-2",
      initialUnitQuantity: 31,
      initialPackageQuantity: 1,
      initialLooseUnitQuantity: 0,
      unitsPerPackageAtReceipt: 30
    });

    expect(messages(data)).toEqual(
      expect.arrayContaining([
        "ID 重复",
        "地点名称重复",
        "地点排序值重复",
        "同一产品的系统批号重复",
        "盒数、散片数与基础单位总数不一致"
      ])
    );
  });

  it("detects profile hierarchy and eye-side violations", () => {
    const data = validData();
    Object.assign(data.profiles[0]!, {
      groupId: "periodic",
      standardType: "lens_case",
      side: "L",
      defaultDurationDays: 0
    });

    expect(messages(data)).toEqual(
      expect.arrayContaining([
        "默认周期必须是正整数",
        "管理模板与大类不一致",
        "标准类型与管理模板不一致",
        "非镜片配置不应设置眼别"
      ])
    );
  });

  it("detects invalid transaction polarity, duplicate reversals, and negative location stock", () => {
    const data = validData();
    data.transactions.push(
      {
        id: "bad-consume",
        stockLotId: "lot-1",
        occurredDate: "2026-08-03",
        type: "consume",
        quantityDelta: 1
      },
      {
        id: "transfer-too-much",
        stockLotId: "lot-1",
        occurredDate: "2026-08-04",
        type: "transfer",
        quantityDelta: 0,
        fromLocationId: "home",
        toLocationId: "office",
        transferQuantity: 4
      },
      {
        id: "reverse-1",
        stockLotId: "lot-1",
        occurredDate: "2026-08-05",
        type: "reverse",
        quantityDelta: 1,
        reversedTransactionId: "activate-1"
      },
      {
        id: "reverse-2",
        stockLotId: "lot-1",
        occurredDate: "2026-08-06",
        type: "reverse",
        quantityDelta: 1,
        reversedTransactionId: "activate-1"
      }
    );

    expect(messages(data)).toEqual(
      expect.arrayContaining([
        "消耗或损耗流水必须减少库存",
        "同一流水被重复撤销",
        "地点“家”库存为负数"
      ])
    );
  });

  it("detects broken state, location, eye, and reusable-lens intervals", () => {
    const data = validData();
    const item = data.items[0]!;
    item.status = "paused";
    item.locationId = "office";
    item.stateIntervals = [
      { startDate: "2026-08-02", endDate: "2026-08-05", status: "active" },
      { startDate: "2026-08-06", endDate: null, status: "paused" }
    ];
    item.eyeSides = ["L", "L"];
    item.eyeAssignmentIntervals = [
      {
        startDate: "2026-08-02",
        endDate: null,
        eyeSides: []
      }
    ];
    item.reusableLensCycles = [
      {
        id: "cycle-1",
        label: "镜片 1",
        startDate: "2026-08-02",
        endDate: null,
        predictionDate: "2026-08-15",
        status: "active"
      },
      {
        id: "cycle-2",
        label: "镜片 2",
        startDate: "2026-08-03",
        endDate: null,
        predictionDate: "2026-08-16",
        status: "active"
      }
    ];

    expect(messages(data)).toEqual(
      expect.arrayContaining([
        "状态相邻区间不连续",
        "当前地点与末尾地点区间不一致",
        "当前眼别重复",
        "眼别区间为空或包含重复眼别",
        "存在多个使用中的盒内镜片"
      ])
    );
  });

  it("detects usage facts that disagree with their instance or transaction", () => {
    const data = validData();
    data.transactions.push({
      id: "consume-1",
      stockLotId: "lot-1",
      occurredDate: "2026-08-03",
      type: "loss",
      quantityDelta: -1,
      relatedInstanceId: "item-1",
      locationId: "home"
    });
    data.usageFacts.push({
      id: "fact-1",
      itemId: "item-1",
      stockLotId: "lot-1",
      transactionId: "consume-1",
      date: "2026-08-01",
      kind: "wear",
      quantity: 2
    });

    expect(messages(data)).toEqual(
      expect.arrayContaining([
        "使用日期不在实例生命周期内",
        "使用记录与库存流水字段不一致",
        "使用记录种类与库存流水不一致"
      ])
    );
  });

  it("detects empty care events and incorrect opened-container forecasts", () => {
    const data = validData();
    data.careEvents.push({ id: "care-1", itemId: "item-1", kind: "review" });
    Object.assign(data.items[0]!, {
      openedExpiryDate: "2026-09-01",
      depletionPredictionDate: "2026-08-20",
      predictionDate: "2026-09-01"
    });

    expect(messages(data)).toEqual(
      expect.arrayContaining([
        "护理事件缺少计划或完成日期",
        "护理液更换日期不是耗尽与开封期限的较早值"
      ])
    );
  });

  it("reports malformed product, lot, and every inventory transaction shape", () => {
    const data = validData();
    Object.assign(data.profiles[0]!, { name: " ", baseUnit: "", side: undefined });
    Object.assign(data.products[0]!, {
      itemProfileId: "missing-profile", brand: " ", baseUnit: "",
      unitsPerPackage: 0, capacityMl: 0, sortOrder: -1, defaultDurationDays: 0
    });
    Object.assign(data.lots[0]!, {
      productId: "missing-product", locationId: "missing-location", internalLotCode: " ",
      receivedDate: "2026-02-30", manufacturedDate: "bad", expiryDate: "also-bad",
      initialUnitQuantity: -1, unitPriceMinor: Number.NaN, expectedUsageDays: 0,
      initialPackageQuantity: -1, initialLooseUnitQuantity: 0,
      unitsPerPackageAtReceipt: 0, voidedAt: "bad"
    });
    data.transactions = [{
      id: "stock", stockLotId: "lot-1", occurredDate: "bad", type: "stock_in",
      quantityDelta: 0, locationId: "missing-location", relatedInstanceId: "missing-item"
    }, {
      id: "activate", stockLotId: "lot-1", occurredDate: "2026-08-02",
      type: "activate", quantityDelta: 0, relatedInstanceId: "missing-item"
    }, {
      id: "package", stockLotId: "lot-1", occurredDate: "2026-08-03",
      type: "package_open", quantityDelta: 1, allocatedUnitQuantity: 0
    }, {
      id: "transfer", stockLotId: "lot-1", occurredDate: "2026-08-04",
      type: "transfer", quantityDelta: 0.5, fromLocationId: "missing-from",
      toLocationId: "missing-to", transferQuantity: 0
    }, {
      id: "reverse-original", stockLotId: "lot-1", occurredDate: "2026-08-05",
      type: "reverse", quantityDelta: 1, reversedTransactionId: "stock"
    }, {
      id: "reverse-reverse", stockLotId: "lot-1", occurredDate: "2026-08-06",
      type: "reverse", quantityDelta: 2, reversedTransactionId: "reverse-original"
    }, {
      id: "self", stockLotId: "lot-1", occurredDate: "2026-08-07",
      type: "reverse", quantityDelta: 1, reversedTransactionId: "self"
    }];

    expect(messages(data)).toEqual(expect.arrayContaining([
      "用品配置名称为空", "基础单位为空", "镜片配置缺少眼别",
      "缺少用品配置引用", "品牌名称为空", "每包装单位数必须是正整数",
      "来源产品不存在", "库存地点不存在", "入库日期无效",
      "包装库存字段不完整或不是整数", "库存变化量必须是整数",
      "入库流水必须增加库存", "启用流水必须消耗一个基础单位",
      "分配或转移流水不能改变总库存", "分配数量必须是正整数",
      "库存转移流水字段不完整", "不能撤销另一条撤销流水", "流水不能撤销自身"
    ]));
  });

  it("reports malformed instances, usage facts, cycles, and care-event dates", () => {
    const data = validData();
    const item = data.items[0]!;
    Object.assign(item, {
      productId: "missing-product", sourceStockLotId: "missing-lot",
      locationId: "missing-location", startDate: "bad", endDate: "bad",
      status: "active", initialUnitQuantity: 0, usageRatePerDay: 0,
      predictionDate: "bad", stateIntervals: [], locationIntervals: [],
      eyeAssignmentIntervals: [], reusableLensCycles: [{
        id: "duplicate-cycle", label: "坏周期", startDate: "bad",
        endDate: "bad", predictionDate: "bad", status: "active"
      }, {
        id: "duplicate-cycle", label: "重复周期", startDate: "2026-08-03",
        predictionDate: "2026-08-04", status: "completed"
      }]
    });
    data.usageFacts = [{
      id: "bad-fact", itemId: "missing-item", stockLotId: "missing-lot",
      transactionId: "missing-transaction", date: "bad", kind: "wear", quantity: 0
    }, {
      id: "wear-1", itemId: "item-1", stockLotId: "lot-1",
      transactionId: "activate-1", date: "2026-08-02", kind: "wear", quantity: 1
    }, {
      id: "wear-2", itemId: "item-1", stockLotId: "lot-1",
      transactionId: "activate-1", date: "2026-08-02", kind: "wear", quantity: 1
    }];
    data.careEvents = [{
      id: "bad-care", itemId: "missing-item", kind: "review",
      plannedDate: "bad", completedDate: "also-bad"
    }, {
      id: "outside-care", itemId: "item-1", kind: "protein",
      plannedDate: "2020-01-01", completedDate: "2030-01-01"
    }];

    expect(messages(data)).toEqual(expect.arrayContaining([
      "产品不存在", "来源批次不存在", "实例地点不存在", "启用日期无效",
      "未结束实例不应填写结束日期", "实例初始数量必须是正整数",
      "每日用量必须大于零", "预测日期无效", "状态区间记录为空",
      "地点区间记录为空", "盒内镜片 ID 重复", "盒内镜片日期无效",
      "已结束盒内镜片缺少结束日期", "使用实例不存在", "库存流水不存在",
      "使用日期无效", "使用数量必须是正整数",
      "同一实例同一天存在重复正常佩戴记录", "计划日期无效", "完成日期无效"
    ]));
  });
});
