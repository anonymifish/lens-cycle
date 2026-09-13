import type { DataIntegrityInput, DataIntegrityIssue } from "./dataIntegrity";
import {
  availableUnits,
  availableUnitsAtLocation,
  effectiveInventoryTransactions
} from "./inventory";
import { templatesByGroup, typesByTemplate } from "../catalog/catalog";

type DatedInterval = { startDate: string; endDate: string | null };

const positiveInteger = (value: number) =>
  Number.isInteger(value) && value > 0;
const nonNegativeInteger = (value: number) =>
  Number.isInteger(value) && value >= 0;

function validDate(value: string | undefined): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month! - 1 &&
    date.getUTCDate() === day
  );
}

function duplicates(values: string[]) {
  const seen = new Set<string>();
  const result = new Set<string>();
  values.forEach((value) => {
    if (seen.has(value)) result.add(value);
    seen.add(value);
  });
  return result;
}

function intervalIssue(
  intervals: DatedInterval[],
  startDate: string,
  endDate: string | null
) {
  if (intervals.length === 0) return "区间记录为空";
  if (intervals[0]?.startDate !== startDate)
    return "首个区间未从实例启用日开始";
  for (let index = 0; index < intervals.length; index += 1) {
    const current = intervals[index]!;
    const next = intervals[index + 1];
    if (
      !validDate(current.startDate) ||
      (current.endDate !== null && !validDate(current.endDate))
    )
      return "区间包含无效日期";
    if (current.endDate !== null && current.endDate <= current.startDate)
      return "区间结束日期必须晚于开始日期";
    if (next && current.endDate !== next.startDate)
      return "相邻区间不连续";
  }
  if (intervals.at(-1)?.endDate !== endDate)
    return "末尾区间与实例结束日期不一致";
  return null;
}

export function validateDataIntegrityV2(data: DataIntegrityInput) {
  const issues: DataIntegrityIssue[] = [];
  const add = (entity: string, id: string, message: string) =>
    issues.push({ entity, id, message });
  const profiles = new Map(data.profiles.map((entry) => [entry.id, entry]));
  const products = new Map(data.products.map((entry) => [entry.id, entry]));
  const locations = new Map(data.locations.map((entry) => [entry.id, entry]));
  const lots = new Map(data.lots.map((entry) => [entry.id, entry]));
  const items = new Map(data.items.map((entry) => [entry.id, entry]));
  const transactions = new Map(data.transactions.map((entry) => [entry.id, entry]));
  const effective = effectiveInventoryTransactions(data.transactions);
  const effectiveIds = new Set(effective.map((entry) => entry.id));

  const collections: Array<[string, Array<{ id: string }>]> = [
    ["profile", data.profiles],
    ["product", data.products],
    ["location", data.locations],
    ["stock_lot", data.lots],
    ["inventory_transaction", data.transactions],
    ["usage_instance", data.items],
    ["usage_event", data.usageFacts],
    ["care_event", data.careEvents]
  ];
  collections.forEach(([entity, entries]) =>
    duplicates(entries.map((entry) => entry.id)).forEach((id) =>
      add(entity, id, "ID 重复")
    )
  );

  duplicates(
    data.locations.map((entry) => entry.name.trim().toLocaleLowerCase())
  ).forEach((name) => add("location", name, "地点名称重复"));
  duplicates(data.locations.map((entry) => String(entry.order))).forEach(
    (order) => add("location", order, "地点排序值重复")
  );

  data.profiles.forEach((profile) => {
    if (!profile.name.trim()) add("profile", profile.id, "用品配置名称为空");
    if (profile.baseUnit !== undefined && !profile.baseUnit.trim())
      add("profile", profile.id, "基础单位为空");
    if (
      profile.defaultDurationDays !== undefined &&
      !positiveInteger(profile.defaultDurationDays)
    )
      add("profile", profile.id, "默认周期必须是正整数");
    if (!templatesByGroup[profile.groupId].includes(profile.managementTemplate))
      add("profile", profile.id, "管理模板与大类不一致");
    if (!typesByTemplate[profile.managementTemplate].includes(profile.standardType))
      add("profile", profile.id, "标准类型与管理模板不一致");
    if (profile.groupId === "lenses" && !profile.side)
      add("profile", profile.id, "镜片配置缺少眼别");
    if (profile.groupId !== "lenses" && profile.side)
      add("profile", profile.id, "非镜片配置不应设置眼别");
  });

  data.products.forEach((product) => {
    const profile = product.itemProfileId
      ? profiles.get(product.itemProfileId)
      : undefined;
    if (!profile) add("product", product.id, "缺少用品配置引用");
    else if (profile.standardType !== product.standardType)
      add("product", product.id, "标准类型与用品配置不一致");
    if (!product.brand.trim()) add("product", product.id, "品牌名称为空");
    if (!product.baseUnit.trim()) add("product", product.id, "基础单位为空");
    if (!positiveInteger(product.unitsPerPackage))
      add("product", product.id, "每包装单位数必须是正整数");
    if (product.capacityMl !== undefined && !(product.capacityMl > 0))
      add("product", product.id, "净含量必须大于零");
    if (
      product.sortOrder !== undefined &&
      !nonNegativeInteger(product.sortOrder)
    )
      add("product", product.id, "产品排序值必须是非负整数");
    if (
      product.defaultDurationDays !== undefined &&
      !positiveInteger(product.defaultDurationDays)
    )
      add("product", product.id, "产品默认周期必须是正整数");
  });

  const duplicateLotKeys = duplicates(
    data.lots.map(
      (lot) =>
        `${lot.productId}\u0000${lot.internalLotCode.trim().toLocaleLowerCase()}`
    )
  );
  data.lots.forEach((lot) => {
    if (!products.has(lot.productId)) add("stock_lot", lot.id, "来源产品不存在");
    if (!locations.has(lot.locationId)) add("stock_lot", lot.id, "库存地点不存在");
    if (!lot.internalLotCode.trim()) add("stock_lot", lot.id, "系统批号为空");
    if (
      duplicateLotKeys.has(
        `${lot.productId}\u0000${lot.internalLotCode.trim().toLocaleLowerCase()}`
      )
    )
      add("stock_lot", lot.id, "同一产品的系统批号重复");
    if (!validDate(lot.receivedDate)) add("stock_lot", lot.id, "入库日期无效");
    if ((lot.voidedAt === undefined) !== (lot.voidedByTransactionId === undefined))
      add("stock_lot", lot.id, "批次作废信息不完整");
    if (lot.voidedAt !== undefined && !validDate(lot.voidedAt))
      add("stock_lot", lot.id, "批次作废日期无效");
    if (lot.manufacturedDate && !validDate(lot.manufacturedDate))
      add("stock_lot", lot.id, "生产日期无效");
    if (lot.expiryDate && !validDate(lot.expiryDate))
      add("stock_lot", lot.id, "预计到期日期无效");
    if (
      lot.manufacturedDate &&
      lot.expiryDate &&
      lot.expiryDate < lot.manufacturedDate
    )
      add("stock_lot", lot.id, "预计到期日期早于生产日期");
    if (!nonNegativeInteger(lot.initialUnitQuantity))
      add("stock_lot", lot.id, "入库基础单位数必须是非负整数");
    if (!Number.isSafeInteger(lot.unitPriceMinor) || lot.unitPriceMinor < 0)
      add("stock_lot", lot.id, "单位价格必须是非负安全整数");
    if (
      lot.expectedUsageDays !== undefined &&
      !positiveInteger(lot.expectedUsageDays)
    )
      add("stock_lot", lot.id, "预计使用时长必须是正整数");
    const packaged =
      lot.initialPackageQuantity !== undefined ||
      lot.initialLooseUnitQuantity !== undefined ||
      lot.unitsPerPackageAtReceipt !== undefined;
    const lotProduct = products.get(lot.productId);
    const lotProfile = lotProduct
      ? profiles.get(lotProduct.itemProfileId)
      : undefined;
    if (
      lotProfile &&
      ["soft_daily", "soft_reusable"].includes(lotProfile.managementTemplate) &&
      !packaged
    ) add("stock_lot", lot.id, "软镜批次缺少收货时包装快照");
    if (packaged) {
      if (
        !nonNegativeInteger(lot.initialPackageQuantity ?? Number.NaN) ||
        !nonNegativeInteger(lot.initialLooseUnitQuantity ?? Number.NaN) ||
        !positiveInteger(lot.unitsPerPackageAtReceipt ?? Number.NaN)
      )
        add("stock_lot", lot.id, "包装库存字段不完整或不是整数");
      else if (
        lot.initialPackageQuantity! * lot.unitsPerPackageAtReceipt! +
          lot.initialLooseUnitQuantity! !==
        lot.initialUnitQuantity
      )
        add("stock_lot", lot.id, "盒数、散片数与基础单位总数不一致");
    }
  });

  const reverseCounts = new Map<string, number>();
  data.transactions.forEach((entry) => {
    if (!lots.has(entry.stockLotId))
      add("inventory_transaction", entry.id, "库存批次不存在");
    if (!validDate(entry.occurredDate))
      add("inventory_transaction", entry.id, "流水日期无效");
    if (!Number.isInteger(entry.quantityDelta))
      add("inventory_transaction", entry.id, "库存变化量必须是整数");
    if (entry.locationId && !locations.has(entry.locationId))
      add("inventory_transaction", entry.id, "流水地点不存在");
    if (entry.relatedInstanceId && effectiveIds.has(entry.id)) {
      const item = items.get(entry.relatedInstanceId);
      if (!item) add("inventory_transaction", entry.id, "关联实例不存在");
      else if (item.sourceStockLotId !== entry.stockLotId)
        add("inventory_transaction", entry.id, "流水批次与关联实例不一致");
    }
    if (entry.type === "stock_in" && entry.quantityDelta <= 0)
      add("inventory_transaction", entry.id, "入库流水必须增加库存");
    if (entry.type === "activate" && entry.quantityDelta !== -1)
      add("inventory_transaction", entry.id, "启用流水必须消耗一个基础单位");
    if (
      ["consume", "loss", "discard"].includes(entry.type) &&
      entry.quantityDelta >= 0
    )
      add("inventory_transaction", entry.id, "消耗或损耗流水必须减少库存");
    if (
      ["package_open", "loose_allocate", "transfer"].includes(entry.type) &&
      entry.quantityDelta !== 0
    )
      add("inventory_transaction", entry.id, "分配或转移流水不能改变总库存");
    if (
      ["package_open", "loose_allocate"].includes(entry.type) &&
      !positiveInteger(entry.allocatedUnitQuantity ?? Number.NaN)
    )
      add("inventory_transaction", entry.id, "分配数量必须是正整数");

    if (entry.type === "reverse") {
      const original = entry.reversedTransactionId
        ? transactions.get(entry.reversedTransactionId)
        : undefined;
      if (!original)
        add("inventory_transaction", entry.id, "撤销流水缺少有效原流水");
      else {
        reverseCounts.set(original.id, (reverseCounts.get(original.id) ?? 0) + 1);
        if (original.type === "reverse")
          add("inventory_transaction", entry.id, "不能撤销另一条撤销流水");
        if (original.id === entry.id)
          add("inventory_transaction", entry.id, "流水不能撤销自身");
        if (original.stockLotId !== entry.stockLotId)
          add("inventory_transaction", entry.id, "撤销流水与原流水批次不一致");
        if (entry.quantityDelta !== -original.quantityDelta)
          add("inventory_transaction", entry.id, "撤销数量与原流水不匹配");
      }
    }
    if (entry.type === "transfer") {
      if (
        !entry.fromLocationId ||
        !entry.toLocationId ||
        entry.fromLocationId === entry.toLocationId ||
        !positiveInteger(entry.transferQuantity ?? Number.NaN)
      )
        add("inventory_transaction", entry.id, "库存转移流水字段不完整");
      if (entry.fromLocationId && !locations.has(entry.fromLocationId))
        add("inventory_transaction", entry.id, "转出地点不存在");
      if (entry.toLocationId && !locations.has(entry.toLocationId))
        add("inventory_transaction", entry.id, "转入地点不存在");
    }
  });
  reverseCounts.forEach((count, transactionId) => {
    if (count > 1)
      add("inventory_transaction", transactionId, "同一流水被重复撤销");
  });

  data.lots.forEach((lot) => {
    const stockIns = effective.filter(
      (entry) => entry.stockLotId === lot.id && entry.type === "stock_in"
    );
    if (lot.voidedAt) {
      if (stockIns.length !== 0)
        add("stock_lot", lot.id, "已作废批次仍有有效入库流水");
      const reversal = lot.voidedByTransactionId
        ? transactions.get(lot.voidedByTransactionId)
        : undefined;
      const original = reversal?.reversedTransactionId
        ? transactions.get(reversal.reversedTransactionId)
        : undefined;
      if (
        !reversal ||
        reversal.type !== "reverse" ||
        reversal.stockLotId !== lot.id ||
        reversal.occurredDate !== lot.voidedAt ||
        original?.type !== "stock_in" ||
        original.stockLotId !== lot.id
      ) add("stock_lot", lot.id, "批次作废流水引用无效");
    } else if (stockIns.length !== 1) {
      add("stock_lot", lot.id, "批次必须且只能有一条有效入库流水");
    } else if (stockIns[0]?.quantityDelta !== lot.initialUnitQuantity) {
      add("stock_lot", lot.id, "批次入库数量与有效入库流水不一致");
    }
    const total = availableUnits(lot.id, data.transactions);
    if (total < 0) add("stock_lot", lot.id, "批次总库存为负数");
    if (lot.voidedAt && total !== 0)
      add("stock_lot", lot.id, "已作废批次的有效库存必须为零");
    const locationTotal = data.locations.reduce(
      (sum, location) =>
        sum + availableUnitsAtLocation(lot, location.id, data.transactions),
      0
    );
    if (locationTotal !== total)
      add("stock_lot", lot.id, "地点库存合计与批次总库存不一致");
    data.locations.forEach((location) => {
      if (availableUnitsAtLocation(lot, location.id, data.transactions) < 0)
        add("stock_lot", lot.id, `地点“${location.name}”库存为负数`);
    });
  });

  const cycleIds = new Set<string>();
  data.items.forEach((item) => {
    const profile = profiles.get(item.categoryId);
    const product = item.productId ? products.get(item.productId) : undefined;
    const lot = item.sourceStockLotId ? lots.get(item.sourceStockLotId) : undefined;
    if (!profile) add("usage_instance", item.id, "用品配置不存在");
    if (!product) add("usage_instance", item.id, "产品不存在");
    if (!lot) add("usage_instance", item.id, "来源批次不存在");
    if (lot?.voidedAt) add("usage_instance", item.id, "来源批次已经作废");
    if (product && lot && lot.productId !== product.id)
      add("usage_instance", item.id, "产品与来源批次不一致");
    if (product?.itemProfileId && product.itemProfileId !== item.categoryId)
      add("usage_instance", item.id, "产品与用品配置不一致");
    if (profile && profile.groupId !== item.groupId)
      add("usage_instance", item.id, "实例大类与用品配置不一致");
    if (!item.locationId || !locations.has(item.locationId))
      add("usage_instance", item.id, "实例地点不存在");
    if (!validDate(item.startDate)) add("usage_instance", item.id, "启用日期无效");
    if (item.endDate && !validDate(item.endDate))
      add("usage_instance", item.id, "结束日期无效");
    if (item.endDate && item.endDate <= item.startDate)
      add("usage_instance", item.id, "结束边界必须晚于启用日期");
    if (item.status === "completed" && !item.endDate)
      add("usage_instance", item.id, "已结束实例缺少结束日期");
    if (item.status !== "completed" && item.endDate)
      add("usage_instance", item.id, "未结束实例不应填写结束日期");
    if (
      item.initialUnitQuantity !== undefined &&
      !positiveInteger(item.initialUnitQuantity)
    )
      add("usage_instance", item.id, "实例初始数量必须是正整数");
    if (
      item.usageRatePerDay !== undefined &&
      !(Number.isFinite(item.usageRatePerDay) && item.usageRatePerDay > 0)
    )
      add("usage_instance", item.id, "每日用量必须大于零");
    [
      item.predictionDate,
      item.openedExpiryDate,
      item.depletionPredictionDate
    ].forEach((date) => {
      if (date && !validDate(date))
        add("usage_instance", item.id, "预测日期无效");
    });

    if (!item.stateIntervals)
      add("usage_instance", item.id, "缺少状态区间记录");
    if (item.stateIntervals) {
      const problem = intervalIssue(item.stateIntervals, item.startDate, item.endDate);
      if (problem) add("usage_instance", item.id, `状态${problem}`);
      const lastStatus = item.stateIntervals.at(-1)?.status;
      if (
        item.status !== "completed" &&
        item.status !== "planned" &&
        lastStatus !== item.status
      )
        add("usage_instance", item.id, "当前状态与末尾状态区间不一致");
    }
    if (!item.locationIntervals)
      add("usage_instance", item.id, "缺少地点区间记录");
    if (item.locationIntervals) {
      const problem = intervalIssue(
        item.locationIntervals,
        item.startDate,
        item.endDate
      );
      if (problem) add("usage_instance", item.id, `地点${problem}`);
      item.locationIntervals.forEach((interval) => {
        if (!locations.has(interval.locationId))
          add("usage_instance", item.id, "地点历史引用了不存在的地点");
      });
      if (item.locationIntervals.at(-1)?.locationId !== item.locationId)
        add("usage_instance", item.id, "当前地点与末尾地点区间不一致");
    }
    if (item.eyeSides && new Set(item.eyeSides).size !== item.eyeSides.length)
      add("usage_instance", item.id, "当前眼别重复");
    if (item.eyeAssignmentIntervals) {
      const problem = intervalIssue(
        item.eyeAssignmentIntervals,
        item.startDate,
        item.endDate
      );
      if (problem) add("usage_instance", item.id, `眼别${problem}`);
      item.eyeAssignmentIntervals.forEach((interval) => {
        if (
          interval.eyeSides.length === 0 ||
          new Set(interval.eyeSides).size !== interval.eyeSides.length
        )
          add("usage_instance", item.id, "眼别区间为空或包含重复眼别");
      });
    }
    if (profile?.managementTemplate === "lens_case" && !item.eyeAssignmentIntervals)
      add("usage_instance", item.id, "镜盒实例缺少眼别区间记录");
    const cycles = item.reusableLensCycles ?? [];
    if (cycles.filter((cycle) => cycle.status === "active").length > 1)
      add("usage_instance", item.id, "存在多个使用中的盒内镜片");
    cycles.forEach((cycle) => {
      if (cycleIds.has(cycle.id))
        add("usage_instance", item.id, "盒内镜片 ID 重复");
      cycleIds.add(cycle.id);
      if (!validDate(cycle.startDate) || !validDate(cycle.predictionDate))
        add("usage_instance", item.id, "盒内镜片日期无效");
      if (cycle.endDate && cycle.endDate <= cycle.startDate)
        add("usage_instance", item.id, "盒内镜片结束边界无效");
      if (cycle.status === "completed" && !cycle.endDate)
        add("usage_instance", item.id, "已结束盒内镜片缺少结束日期");
      if (cycle.status === "active" && cycle.endDate)
        add("usage_instance", item.id, "使用中盒内镜片不应填写结束日期");
    });
    if (
      item.openedExpiryDate &&
      item.depletionPredictionDate &&
      item.predictionDate !==
        (item.openedExpiryDate < item.depletionPredictionDate
          ? item.openedExpiryDate
          : item.depletionPredictionDate)
    )
      add(
        "usage_instance",
        item.id,
        "护理液更换日期不是耗尽与开封期限的较早值"
      );
  });

  data.usageFacts.forEach((fact) => {
    const item = items.get(fact.itemId);
    const lot = lots.get(fact.stockLotId);
    const transaction = transactions.get(fact.transactionId);
    if (!item) add("usage_event", fact.id, "使用实例不存在");
    if (!lot) add("usage_event", fact.id, "库存批次不存在");
    if (!transaction) add("usage_event", fact.id, "库存流水不存在");
    if (!validDate(fact.date)) add("usage_event", fact.id, "使用日期无效");
    if (!positiveInteger(fact.quantity))
      add("usage_event", fact.id, "使用数量必须是正整数");
    if (item && item.sourceStockLotId !== fact.stockLotId)
      add("usage_event", fact.id, "使用记录批次与实例不一致");
    if (
      item &&
      (fact.date < item.startDate || (item.endDate && fact.date >= item.endDate))
    )
      add("usage_event", fact.id, "使用日期不在实例生命周期内");
    if (transaction) {
      if (!effectiveIds.has(transaction.id))
        add("usage_event", fact.id, "使用记录引用了已撤销流水");
      if (
        transaction.stockLotId !== fact.stockLotId ||
        transaction.relatedInstanceId !== fact.itemId ||
        transaction.occurredDate !== fact.date ||
        transaction.quantityDelta !== -fact.quantity
      )
        add("usage_event", fact.id, "使用记录与库存流水字段不一致");
      const expectedType = fact.kind === "extra_loss" ? "loss" : "consume";
      if (transaction.type !== expectedType)
        add("usage_event", fact.id, "使用记录种类与库存流水不一致");
    }
  });

  const dailyWearKeys = duplicates(
    data.usageFacts
      .filter((fact) => fact.kind === "wear")
      .map((fact) => `${fact.itemId}\u0000${fact.date}`)
  );
  dailyWearKeys.forEach((key) =>
    add("usage_event", key, "同一实例同一天存在重复正常佩戴记录")
  );

  data.careEvents.forEach((event) => {
    const item = items.get(event.itemId);
    if (!item) add("care_event", event.id, "使用实例不存在");
    const profile = item ? profiles.get(item.categoryId) : undefined;
    if (profile && profile.managementTemplate !== "rigid_long_term")
      add("care_event", event.id, "护理事件只能关联长期硬镜实例");
    if (!event.plannedDate && !event.completedDate)
      add("care_event", event.id, "护理事件缺少计划或完成日期");
    if (event.plannedDate && !validDate(event.plannedDate))
      add("care_event", event.id, "计划日期无效");
    if (event.completedDate && !validDate(event.completedDate))
      add("care_event", event.id, "完成日期无效");
    if (
      item &&
      event.plannedDate &&
      (event.plannedDate < item.startDate ||
        (item.endDate && event.plannedDate >= item.endDate))
    )
      add("care_event", event.id, "护理计划日期不在实例生命周期内");
    if (
      item &&
      event.completedDate &&
      (event.completedDate < item.startDate ||
        (item.endDate && event.completedDate >= item.endDate))
    )
      add("care_event", event.id, "护理完成日期不在实例生命周期内");
  });

  return issues;
}
