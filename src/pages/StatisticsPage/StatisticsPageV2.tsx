import { useMemo, useState } from "react";
import { eachMonthOfInterval, format, startOfMonth, subDays } from "date-fns";
import {
  daysBetween,
  displayCompactLocalDate,
  parseLocalDate,
  todayLocalDate
} from "../../shared/dates/localDate";
import { effectiveInventoryTransactions, formatMoney, productAvailableUnits, productInventoryValueMinor } from "../../features/inventory/inventory";
import { standardTypeLabels } from "../../features/catalog/catalog";
import type { ItemProfile } from "../../features/catalog/catalog.types";
import {
  fallbackConsumptionRate,
  historicalBatchConsumptionRateUnitsPerDay,
  historicalConsumptionRateMlPerDay
} from "../../features/timeline/domain/forecast";
import { timelineItemActiveDays } from "../../features/timeline/domain/lifecycle";
import { useInventoryStore } from "../../stores/inventoryStore";
import { useItemProfileStore } from "../../stores/itemProfileStore";
import { useTimelineItemStore } from "../../stores/timelineItemStore";
import { useForecastSettingsStore } from "../../stores/forecastSettingsStore";
import { EmptyState } from "../../shared/components/EmptyState";
import styles from "./StatisticsPage.module.css";

type RangePreset = "30" | "90" | "365" | "all";
const pieColors = ["#315cf5", "#18a675", "#8b5cf6", "#f59e0b", "#ef5b72", "#64748b"];
const forecastRangeColumns = [
  { key: "all", label: "所有历史" },
  { key: "recent_year", label: "最近一年" },
  { key: "recent_products", label: "最近 N 个产品" }
] as const;

export function StatisticsPage({
  onNavigateToInventory
}: {
  onNavigateToInventory?: () => void;
}) {
  const products = useInventoryStore((state) => state.products);
  const lots = useInventoryStore((state) => state.lots);
  const transactions = useInventoryStore((state) => state.transactions);
  const profiles = useItemProfileStore((state) => state.profiles);
  const items = useTimelineItemStore((state) => state.items);
  const recentProductCount = useForecastSettingsStore((state) => state.recentProductCount);
  const consumptionHistoryScope = useForecastSettingsStore((state) => state.consumptionHistoryScope);
  const consumptionHistoryRange = useForecastSettingsStore((state) => state.consumptionHistoryRange);
  const [rangePreset, setRangePreset] = useState<RangePreset>("365");
  const today = todayLocalDate();
  const startDate = useMemo(() => rangePreset === "all" ? "0000-01-01" : format(subDays(parseLocalDate(today), Number(rangePreset) - 1), "yyyy-MM-dd"), [rangePreset, today]);
  const effectiveTransactions = effectiveInventoryTransactions(transactions);
  const hasPurchaseData = effectiveTransactions.some(
    (entry) => entry.type === "stock_in"
  );
  const periodTransactions = effectiveTransactions.filter((entry) => entry.occurredDate >= startDate);
  const lotById = new Map(lots.map((lot) => [lot.id, lot]));
  const productById = new Map(products.map((product) => [product.id, product]));
  const profileById = new Map(profiles.map((profile) => [profile.id, profile]));

  function transactionCost(type: "purchase" | "usage" | "loss") {
    return periodTransactions.reduce((total, entry) => {
      const lot = lotById.get(entry.stockLotId);
      if (!lot) return total;
      if (type === "purchase" && entry.type === "stock_in") return total + entry.quantityDelta * lot.unitPriceMinor;
      if (type === "usage" && (entry.type === "activate" || entry.type === "consume")) return total + Math.abs(entry.quantityDelta) * lot.unitPriceMinor;
      if (type === "loss" && (entry.type === "loss" || entry.type === "discard")) return total + Math.abs(entry.quantityDelta) * lot.unitPriceMinor;
      return total;
    }, 0);
  }

  const purchaseSpending = transactionCost("purchase");
  const usageCost = transactionCost("usage");
  const lossCost = transactionCost("loss");
  const inventoryValue = products.reduce((total, product) => total + productInventoryValueMinor(product.id, lots, transactions), 0);
  const expiryWarnings = lots
    .filter((lot) => lot.expiryDate && productAvailableUnits(lot.productId, [lot], transactions) > 0)
    .map((lot) => ({ lot, product: productById.get(lot.productId), days: daysBetween(today, lot.expiryDate!) }))
    .filter((entry) => entry.days <= 90)
    .sort((a, b) => a.days - b.days);
  const lowStockWarnings = products
    .map((product) => ({
      product,
      available: productAvailableUnits(product.id, lots, transactions)
    }))
    .filter((entry) => entry.available <= 1)
    .sort((a, b) => a.available - b.available);
  const expiredCount = expiryWarnings.filter((entry) => entry.days < 0).length;
  const dueSoonCount = expiryWarnings.filter((entry) => entry.days >= 0 && entry.days <= 30).length;
  const watchCount = expiryWarnings.filter((entry) => entry.days > 30).length;
  const warningCount = expiryWarnings.length + lowStockWarnings.length;

  const monthlySpending = (() => {
    const purchases = periodTransactions.filter((entry) => entry.type === "stock_in");
    const firstDate = rangePreset === "all" ? purchases.map((entry) => entry.occurredDate).sort()[0] ?? today : startDate;
    return eachMonthOfInterval({ start: startOfMonth(parseLocalDate(firstDate)), end: startOfMonth(parseLocalDate(today)) }).map((month) => {
      const key = format(month, "yyyy-MM");
      const amount = purchases.reduce((sum, entry) => entry.occurredDate.startsWith(key) ? sum + entry.quantityDelta * (lotById.get(entry.stockLotId)?.unitPriceMinor ?? 0) : sum, 0);
      return { label: format(month, "yy.MM"), amount };
    });
  })();

  const categorySpending = Array.from(periodTransactions.filter((entry) => entry.type === "stock_in").reduce((totals, entry) => {
    const lot = lotById.get(entry.stockLotId);
    const product = lot ? productById.get(lot.productId) : undefined;
    if (!lot || !product) return totals;
    const label = profileById.get(product.itemProfileId ?? "")?.standardTypeName ?? standardTypeLabels[product.standardType];
    totals.set(label, (totals.get(label) ?? 0) + entry.quantityDelta * lot.unitPriceMinor);
    return totals;
  }, new Map<string, number>())).map(([label, amount]) => ({ label, amount })).sort((a, b) => b.amount - a.amount);

  const forecastRows = products.flatMap((product) => {
    const profile = profileById.get(product.itemProfileId ?? "");
    if (!profile || !forecastable(profile)) return [];
    const target = {
      scope: consumptionHistoryScope,
      standardType: profile.standardType,
      profileId: profile.id,
      productId: product.id
    };
    if (profile.managementTemplate === "opened_container") {
      if (!product.capacityMl) return [];
      const values = (["all", "recent_year", "recent_products"] as const).map((range) => {
        const rate = historicalConsumptionRateMlPerDay(
          items,
          profiles,
          { range, recentProductCount },
          today,
          target
        ) ?? fallbackConsumptionRate(product, profile);
        return rate ? Math.ceil(product.capacityMl! / rate) : null;
      });
      return [{
        product,
        profile,
        values
      }];
    }

    const ledgerAvailable = productAvailableUnits(product.id, lots, transactions);
    const activeBatchItems = items
      .filter(
        (item) =>
          item.productId === product.id &&
          item.status !== "completed"
      );
    const activeRates = activeBatchItems
      .filter((item) => (item.usageRatePerDay ?? 0) > 0)
      .map((item) => item.usageRatePerDay!);
    const fallbackRate = activeRates.length
      ? activeRates.reduce((sum, rate) => sum + rate, 0) / activeRates.length
      : 1;
    const values = (["all", "recent_year", "recent_products"] as const).map(
      (range) => {
        const rate =
          historicalBatchConsumptionRateUnitsPerDay(
            items,
            profiles,
            { range, recentProductCount },
            today,
            target
          ) ?? fallbackRate;
        const projectedConsumed = activeBatchItems.reduce(
          (total, item) =>
            total +
            Math.min(
              item.initialUnitQuantity ?? Number.POSITIVE_INFINITY,
              timelineItemActiveDays(item, today) * rate
            ),
          0
        );
        return Math.ceil(Math.max(0, ledgerAvailable - projectedConsumed) / rate);
      }
    );
    return [{
      product,
      profile,
      values
    }];
  });

  return (
    <section className={styles.page}>
      <header className={styles.header}>
        <div>
          <span>LENS CYCLE</span>
          <h1>统计</h1>
        </div>
        <label>
          支出统计范围
          <select
            onChange={(event) => setRangePreset(event.target.value as RangePreset)}
            value={rangePreset}
          >
            <option value="30">最近 30 天</option>
            <option value="90">最近 90 天</option>
            <option value="365">最近一年</option>
            <option value="all">全部时间</option>
          </select>
        </label>
      </header>

      {!hasPurchaseData ? (
        <div className={styles.statisticsEmpty}>
          <EmptyState
            description={
              products.length === 0
                ? "统计结果来自真实的产品、批次和库存流水。创建产品并完成首次入库后，这里会自动生成预警、支出和预测。"
                : "已有产品资料，但还没有入库流水。完成首次入库后，这里会开始计算库存价值与每月购买支出。"
            }
            eyebrow={products.length === 0 ? "尚未产生统计数据" : "等待首次入库"}
            icon="chart"
            primaryAction={
              onNavigateToInventory
                ? { label: "前往库存", onClick: onNavigateToInventory }
                : undefined
            }
            steps={
              products.length === 0
                ? ["创建产品", "录入库存批次", "开始记录使用"]
                : ["选择产品入库", "填写数量与价格", "查看统计变化"]
            }
            title={
              products.length === 0
                ? "完成基础资料后再查看统计"
                : "为现有产品录入首批库存"
            }
          />
        </div>
      ) : (
        <>
      <SectionHeading
        index="01"
        title="库存预警"
      />
      <section className={`${styles.card} ${styles.warningCard}`}>
        {warningCount > 0 && (
          <div className={styles.warningSummary}>
            <div>
              <strong>{warningCount} 项提醒</strong>
            </div>
            <div className={styles.warningBadges}>
              <WarningMetric label="已过期" tone="danger" value={expiredCount} />
              <WarningMetric label="30 天内到期" tone="urgent" value={dueSoonCount} />
              <WarningMetric label="31—90 天到期" tone="watch" value={watchCount} />
              <WarningMetric label="低库存" tone="stock" value={lowStockWarnings.length} />
            </div>
          </div>
        )}
        {expiryWarnings.length > 0 && (
          <div className={styles.warningGroup}>
            <div className={styles.warningGroupHeading}>
              <strong>保质期提醒</strong>
              <span>{expiryWarnings.length} 个批次</span>
            </div>
            <div className={styles.warningList}>
              {expiryWarnings.map(({ lot, product, days }) => (
                <article key={lot.id}>
                  <span
                    className={
                      days < 0
                        ? styles.expired
                        : days <= 30
                          ? styles.warningUrgent
                          : styles.warningDot
                    }
                  />
                  <div>
                    <strong>
                      {product?.brand ?? "未知产品"}
                      {product?.model ? ` · ${product.model}` : ""}
                    </strong>
                    <small>
                      批次 {lot.internalLotCode} · 到期日{" "}
                      {displayCompactLocalDate(lot.expiryDate)}
                    </small>
                  </div>
                  <b>
                    {days < 0
                      ? `已过期 ${Math.abs(days)} 天`
                      : days === 0
                        ? "今天到期"
                        : `${days} 天后到期`}
                  </b>
                </article>
              ))}
            </div>
          </div>
        )}
        {lowStockWarnings.length > 0 && (
          <div className={styles.lowStockList}>
            <span>低库存产品</span>
            <div>
              {lowStockWarnings.map(({ product, available }) => (
                <span key={product.id}>
                  <strong>
                    {product.brand}
                    {product.model ? ` · ${product.model}` : ""}
                  </strong>
                  <small>
                    剩余 {available} {product.baseUnit}
                  </small>
                </span>
              ))}
            </div>
          </div>
        )}
        {expiryWarnings.length === 0 && lowStockWarnings.length === 0 && (
          <div className={styles.emptyStateSuccess}>
            <strong>目前没有库存预警</strong>
            <span>未来 90 天内没有临期批次，所有产品库存均高于预警线。</span>
          </div>
        )}
      </section>

      <SectionHeading
        index="02"
        title="支出统计"
      />
      <div className={styles.metrics}>
        <Metric label="购买支出" tone="purchase" value={formatMoney(purchaseSpending)} />
        <Metric label="使用成本" tone="usage" value={formatMoney(usageCost)} />
        <Metric label="损耗成本" tone="loss" value={formatMoney(lossCost)} />
        <Metric label="库存价值" tone="inventory" value={formatMoney(inventoryValue)} />
      </div>
      <div className={styles.chartGrid}>
        <section className={styles.card}>
          <CardHeading title="每月购买支出" />
          <MonthlyLineChart values={monthlySpending} />
        </section>
        <section className={styles.card}>
          <CardHeading title="品类支出占比" />
          <SpendingPie values={categorySpending} />
        </section>
      </div>
      <SectionHeading
        index="03"
        title="使用预测"
      />
      <section className={`${styles.card} ${styles.forecastCard}`}>
        <div className={styles.forecastTable}>
          <div className={styles.forecastHeader}>
            <span>产品</span>
            {forecastRangeColumns.map((column) => (
              <span
                className={
                  consumptionHistoryRange === column.key
                    ? styles.forecastSelectedHeader
                    : undefined
                }
                key={column.key}
              >
                {column.key === "recent_products"
                  ? `最近 ${recentProductCount} 个产品`
                  : column.label}
                {consumptionHistoryRange === column.key && <small>当前采用</small>}
              </span>
            ))}
          </div>
          {forecastRows.length ? (
            forecastRows.map(({ product, profile, values }) => (
              <div className={styles.forecastRow} key={product.id}>
                <span>
                  <strong>
                    {product.brand}
                    {product.model ? ` · ${product.model}` : ""}
                  </strong>
                  <small>{profile.name}</small>
                </span>
                {values.map((days, index) => {
                  const column = forecastRangeColumns[index];
                  if (!column) return null;
                  return (
                    <span
                      className={
                        consumptionHistoryRange === column.key
                          ? styles.forecastSelectedValue
                          : undefined
                      }
                      key={column.key}
                    >
                      {days !== null ? `${days} 天` : "历史不足"}
                    </span>
                  );
                })}
              </div>
            ))
          ) : (
            <div className={styles.emptyState}>暂无具有预测周期的产品</div>
          )}
        </div>
        <p className={styles.forecastNote}>
          “最近 {recentProductCount} 个产品”的数量可在设置页面修改。历史不足时使用默认估计。
        </p>
      </section>
        </>
      )}
    </section>
  );
}

function forecastable(profile: ItemProfile) {
  return ["opened_container", "batch_consumable"].includes(
    profile.managementTemplate
  );
}

function MonthlyLineChart({ values }: { values: Array<{ label: string; amount: number }> }) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const width = 720;
  const height = 224;
  const padding = { top: 28, right: 24, bottom: 34, left: 58 };
  const maximum = Math.max(1, ...values.map((value) => value.amount));
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const points = values.map((value, index) => ({
    ...value,
    x: padding.left + (index * plotWidth) / Math.max(1, values.length - 1),
    y: padding.top + plotHeight - (value.amount / maximum) * plotHeight
  }));
  const hoveredPoint = hoveredIndex === null ? null : points[hoveredIndex];
  const areaPoints = points.length
    ? `${padding.left},${padding.top + plotHeight} ${points.map((point) => `${point.x},${point.y}`).join(" ")} ${points.at(-1)?.x},${padding.top + plotHeight}`
    : "";

  return (
    <div className={styles.lineChart}>
      <svg aria-label="每月购买支出曲线" role="img" viewBox={`0 0 ${width} ${height}`}>
        {[0, 0.5, 1].map((ratio) => {
          const y = padding.top + ratio * plotHeight;
          return (
            <g className={styles.lineGuide} key={ratio}>
              <line x1={padding.left} x2={width - padding.right} y1={y} y2={y} />
              <text x={padding.left - 9} y={y + 3}>
                {formatMoney(Math.round(maximum * (1 - ratio)))}
              </text>
            </g>
          );
        })}
        {areaPoints && <polygon className={styles.lineArea} points={areaPoints} />}
        <polyline points={points.map((point) => `${point.x},${point.y}`).join(" ")} />
        {points.map((point, index) => (
          <g
            className={styles.linePoint}
            key={`${point.label}-${index}`}
            onBlur={() => setHoveredIndex(null)}
            onFocus={() => setHoveredIndex(index)}
            onMouseEnter={() => setHoveredIndex(index)}
            onMouseLeave={() => setHoveredIndex(null)}
            tabIndex={0}
          >
            <circle cx={point.x} cy={point.y} r={hoveredIndex === index ? 6 : 4} />
            {(values.length <= 12 || index % Math.ceil(values.length / 8) === 0 || index === values.length - 1) && (
              <text className={styles.lineLabel} x={point.x} y={height - 8}>
                {point.label}
              </text>
            )}
          </g>
        ))}
      </svg>
      {hoveredPoint && (
        <div
          className={styles.chartTooltip}
          style={{
            left: `${(hoveredPoint.x / width) * 100}%`,
            top: `${(hoveredPoint.y / height) * 100}%`
          }}
        >
          <span>{hoveredPoint.label}</span>
          <strong>{formatMoney(hoveredPoint.amount)}</strong>
        </div>
      )}
    </div>
  );
}

function SpendingPie({ values }: { values: Array<{ label: string; amount: number }> }) {
  const visibleValues = values.length > 6
    ? [
        ...values.slice(0, 5),
        {
          label: "其他",
          amount: values.slice(5).reduce((sum, value) => sum + value.amount, 0)
        }
      ]
    : values;
  const total = visibleValues.reduce((sum, value) => sum + value.amount, 0);
  let cursor = 0;
  const gradient = total
    ? visibleValues
        .map((value, index) => {
          const start = cursor;
          cursor += (value.amount / total) * 100;
          return `${pieColors[index % pieColors.length]} ${start}% ${cursor}%`;
        })
        .join(", ")
    : "#e5e7eb 0 100%";

  return (
    <div className={styles.pieWrap}>
      <div
        aria-label={`品类支出占比，总支出 ${formatMoney(total)}`}
        className={styles.pie}
        role="img"
        style={{ background: `conic-gradient(${gradient})` }}
      >
        <span>
          {formatMoney(total)}
          <small>总支出</small>
        </span>
      </div>
      <div className={styles.pieLegend}>
        {visibleValues.length ? (
          visibleValues.map((value, index) => (
            <div key={value.label}>
              <i style={{ background: pieColors[index % pieColors.length] }} />
              <span>{value.label}</span>
              <small>{formatMoney(value.amount)}</small>
              <b>{total ? ((value.amount / total) * 100).toFixed(1) : 0}%</b>
            </div>
          ))
        ) : (
          <small>当前范围内暂无购买支出</small>
        )}
      </div>
    </div>
  );
}

function WarningMetric({
  label,
  value,
  tone
}: {
  label: string;
  value: number;
  tone: "danger" | "urgent" | "watch" | "stock";
}) {
  return (
    <article
      className={`${styles[`warningMetric_${tone}`]} ${value === 0 ? styles.warningMetricEmpty : ""}`}
    >
      <strong>{value}</strong>
      <span>{label}</span>
    </article>
  );
}

function SectionHeading({ index, title }: { index: string; title: string }) {
  return (
    <div className={styles.sectionHeading}>
      <span>{index}</span>
      <div>
        <h2>{title}</h2>
      </div>
    </div>
  );
}

function CardHeading({ title }: { title: string }) {
  return (
    <div className={styles.cardHeading}>
      <h2>{title}</h2>
    </div>
  );
}

function Metric({
  label,
  value,
  tone
}: {
  label: string;
  value: string;
  tone: "purchase" | "usage" | "loss" | "inventory";
}) {
  return (
    <article className={styles[`metric_${tone}`]}>
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}
