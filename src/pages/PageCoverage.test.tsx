// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { InventoryPage } from "./InventoryPage/InventoryPage";
import { StatisticsPage } from "./StatisticsPage/StatisticsPage";
import { TimelinePage } from "./TimelinePage/TimelinePage";
import { ManageItemsDialog } from "../features/catalog/components/ManageItemsDialog";
import { useItemProfileStore } from "../stores/itemProfileStore";
import { useInventoryStore } from "../stores/inventoryStore";
import { useTimelineItemStore } from "../stores/timelineItemStore";
import { useTimelineCareEventStore } from "../stores/timelineCareEventStore";
import { useUsageFactStore } from "../stores/usageFactStore";
import { useTimelineViewportStore } from "../stores/timelineViewportStore";
import { setPersistenceCommandAdapterForTests } from "../features/inventory/persistenceGateway";
import type { ItemProfile } from "../features/catalog/catalog.types";
import type { Product, StockLot, InventoryTransaction } from "../features/inventory/inventory.types";
import type { TimelineItem } from "../features/timeline/timeline.types";

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date(2026, 8, 6, 12));
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
  Object.defineProperty(SVGElement.prototype, "setPointerCapture", {
    configurable: true, value: vi.fn()
  });
  useItemProfileStore.setState({
    profiles: [{
      id: "profile-1", groupId: "lenses", managementTemplate: "rigid_long_term",
      standardType: "scleral", name: "巩膜镜（L）", baseUnit: "片", side: "L",
      defaultDurationDays: 365, active: true, order: 0
    }]
  });
  useInventoryStore.setState({
    products: [{
      id: "product-1", itemProfileId: "profile-1", standardType: "scleral",
      brand: "测试品牌", model: "型号 A", specification: "左眼",
      baseUnit: "片", unitsPerPackage: 1, defaultDurationDays: 365, active: true
    }],
    locations: [
      { id: "home", name: "家", active: true, order: 0 },
      { id: "office", name: "办公室", active: true, order: 1 }
    ],
    lots: [{
      id: "lot-1", productId: "product-1", internalLotCode: "20260101-1",
      lotNumber: "LOT-A", manufacturedDate: "2025-01-01", expiryDate: "2028-01-01",
      expectedUsageDays: 365, receivedDate: "2026-01-01", locationId: "home",
      initialUnitQuantity: 2, initialPackageQuantity: 2, initialLooseUnitQuantity: 0,
      unitsPerPackageAtReceipt: 1, unitPriceMinor: 1_200_000, currency: "CNY"
    }, {
      id: "lot-2", productId: "product-1", internalLotCode: "20260201-1",
      receivedDate: "2026-02-01", locationId: "home", initialUnitQuantity: 3,
      initialPackageQuantity: 3, initialLooseUnitQuantity: 0, unitsPerPackageAtReceipt: 1,
      unitPriceMinor: 900_000, currency: "CNY"
    }],
    transactions: [
      {
        id: "stock-in-1", stockLotId: "lot-1", occurredDate: "2026-01-01",
        type: "stock_in", quantityDelta: 2, locationId: "home"
      },
      {
        id: "activate-1", stockLotId: "lot-1", occurredDate: "2026-01-02",
        type: "activate", quantityDelta: -1, relatedInstanceId: "item-1",
        locationId: "home", reversibleWithInstance: true
      },
      {
        id: "stock-in-2", stockLotId: "lot-2", occurredDate: "2026-02-01",
        type: "stock_in", quantityDelta: 3, locationId: "home"
      }
    ]
  });
  useTimelineItemStore.setState({
    items: [{
      id: "item-1", categoryId: "profile-1", groupId: "lenses",
      categoryName: "巩膜镜（L）", productId: "product-1", sourceStockLotId: "lot-1",
      label: "左眼巩膜镜", detail: "日常使用", location: "家", locationId: "home",
      locationIntervals: [{ locationId: "home", startDate: "2026-01-02", endDate: null }],
      startDate: "2026-01-02", endDate: null, predictionDate: "2027-01-01",
      status: "active", eyeSides: ["L"],
      eyeAssignmentIntervals: [{ startDate: "2026-01-02", endDate: null, eyeSides: ["L"] }],
      stateIntervals: [{ startDate: "2026-01-02", endDate: null, status: "active" }]
    }]
  });
  useTimelineCareEventStore.setState({
    events: [{
      id: "care-1", itemId: "item-1", kind: "review", plannedDate: "2026-09-10"
    }]
  });
  useUsageFactStore.setState({ facts: [] });
  useTimelineViewportStore.setState({
    viewport: { centerDate: "2026-09-06", pixelsPerDay: 8, viewportWidth: 900 },
    expandedGroups: { lenses: true, periodic: true, consumables: true }
  });
});

afterEach(() => {
  cleanup();
  setPersistenceCommandAdapterForTests(null);
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("populated page rendering", () => {
  it("opens a long-term rigid-lens record from a normal unpackaged lot", () => {
    useInventoryStore.setState((state) => {
      const lots = state.lots.map((source) => {
        const { initialPackageQuantity, initialLooseUnitQuantity,
          unitsPerPackageAtReceipt, ...lot } = source;
        void initialPackageQuantity;
        void initialLooseUnitQuantity;
        void unitsPerPackageAtReceipt;
        return lot;
      });
      return {
        ...state,
        products: [...state.products, {
          ...state.products[0]!, id: "product-2", brand: "备用品牌"
        }],
        lots: [...lots, {
          ...lots[0]!, id: "lot-3", productId: "product-2",
          internalLotCode: "20260301-1"
        }],
        transactions: [...state.transactions, {
          id: "stock-in-3", stockLotId: "lot-3", occurredDate: "2026-03-01",
          type: "stock_in", quantityDelta: 2, locationId: "home"
        }]
      };
    });
    useTimelineItemStore.setState({ items: [] });
    useTimelineCareEventStore.setState({ events: [] });

    render(<TimelinePage />);
    fireEvent.click(screen.getByRole("button", {
      name: "向巩膜镜（L）添加记录"
    }));

    expect(screen.getByRole("heading", {
      name: "向“巩膜镜（L）”添加记录"
    })).toBeTruthy();
    const product = screen.getByLabelText("具体产品");
    fireEvent.change(product, { target: { value: "product-2" } });
    expect((product as HTMLSelectElement).value).toBe("product-2");
    fireEvent.change(product, { target: { value: "product-1" } });
    const lot = screen.getByLabelText("来源批次");
    fireEvent.change(lot, { target: { value: "lot-2" } });
    expect((lot as HTMLSelectElement).value).toBe("lot-2");
  });

  it("renders inventory details and opens the product batch list", () => {
    const { container } = render(<InventoryPage />);
    expect(container.textContent).toContain("¥390.00");
    fireEvent.click(screen.getByRole("button", { name: "新建产品" }));
    expect(screen.getByRole("heading", { name: "新建产品" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));

    fireEvent.click(screen.getAllByRole("button", { name: "入库" })[0]!);
    expect(screen.getByRole("heading", { name: "添加库存批次" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));

    fireEvent.click(screen.getByRole("button", { name: "编辑" }));
    expect(screen.getByRole("heading", { name: "编辑产品" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));

    fireEvent.click(screen.getByRole("button", { name: "批次 2" }));
    expect(screen.getByText("20260101-1")).toBeTruthy();
    expect(screen.getByText("LOT-A")).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: "编辑" })[1]!);
    expect(screen.getByRole("heading", { name: "编辑库存批次" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));

    fireEvent.click(screen.getAllByRole("button", { name: "转移" })[1]!);
    expect(screen.getByRole("heading", { name: "转移库存" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));

    const voidButtons = screen.getAllByRole("button", { name: "作废" });
    fireEvent.click(voidButtons.find((button) => !button.hasAttribute("disabled"))!);
    expect(screen.getByRole("heading", { name: /作废批次/ })).toBeTruthy();
  });

  it("creates, receives, edits, and transfers inventory through committed repositories", async () => {
    setPersistenceCommandAdapterForTests(async <T,>(command: string, args?: Record<string, unknown>): Promise<T> => {
      if (command === "create_product" || command === "update_product")
        return structuredClone(args?.product) as T;
      if (command === "receive_stock") return structuredClone(args?.lot) as T;
      if (command === "transfer_stock") return structuredClone(args?.inventoryTransaction) as T;
      if (command === "update_stock_lot")
        return { lot: structuredClone(args?.lot), transactions: [] } as T;
      if (command === "reorder_products") return undefined as T;
      throw new Error(`Unexpected command ${command}`);
    });
    render(<InventoryPage />);
    fireEvent.click(screen.getByRole("button", { name: "新建产品" }));
    fireEvent.change(screen.getByLabelText("品牌"), { target: { value: "新增品牌" } });
    fireEvent.change(screen.getByLabelText("型号"), { target: { value: "B2" } });
    fireEvent.change(screen.getByLabelText(/镜片规格/), { target: { value: "右眼" } });
    fireEvent.click(screen.getByRole("button", { name: "创建并继续入库" }));
    expect(await screen.findByRole("heading", { name: "添加库存批次" })).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/入库数量/), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText(/平均每.*价格/), { target: { value: "88.5" } });
    fireEvent.change(screen.getByLabelText("生产批号（选填）"), { target: { value: "NEW-LOT" } });
    fireEvent.click(screen.getByRole("button", { name: "确认入库" }));
    expect(await screen.findByText("新增品牌 已完成入库")).toBeTruthy();
    expect(useInventoryStore.getState().products).toHaveLength(2);
    expect(useInventoryStore.getState().lots).toHaveLength(3);
    expect(useInventoryStore.getState().lots.at(-1)?.unitPriceMinor).toBe(885_000);

    const productCard = screen.getByText(/新增品牌 · B2/).closest("article")!;
    fireEvent.click(within(productCard).getByRole("button", { name: "编辑" }));
    fireEvent.change(screen.getByLabelText("品牌"), { target: { value: "更新品牌" } });
    fireEvent.click(screen.getByRole("button", { name: "保存产品" }));
    expect(await screen.findByText("产品资料已更新")).toBeTruthy();

    const updatedCard = screen.getByText(/更新品牌 · B2/).closest("article")!;
    fireEvent.click(within(updatedCard).getByRole("button", { name: "批次 1" }));
    let lotRow = screen.getByText("NEW-LOT").closest("div")!;
    fireEvent.click(within(lotRow).getByRole("button", { name: "编辑" }));
    fireEvent.change(screen.getByLabelText(/平均每.*价格/), { target: { value: "90" } });
    fireEvent.click(screen.getByRole("button", { name: "保存批次" }));
    expect(await screen.findByText("批次信息已更新")).toBeTruthy();
    expect(useInventoryStore.getState().lots.at(-1)?.unitPriceMinor).toBe(900_000);

    lotRow = screen.getByText("NEW-LOT").closest("div")!;
    fireEvent.click(within(lotRow).getByRole("button", { name: "转移" }));
    fireEvent.change(screen.getByLabelText(/转移数量/), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("备注（选填）"), { target: { value: " 备用 " } });
    fireEvent.click(screen.getByRole("button", { name: "确认转移" }));
    await waitFor(() => expect(screen.getByText("库存地点已更新")).toBeTruthy());
    expect(useInventoryStore.getState().transactions.at(-1)).toMatchObject({
      type: "transfer", transferQuantity: 1, reason: "备用"
    });
  });

  it("rejects duplicate lots and excessive transfers before persistence", async () => {
    setPersistenceCommandAdapterForTests(async <T,>(): Promise<T> => {
      throw new Error("validation should run first");
    });
    render(<InventoryPage />);
    fireEvent.click(screen.getAllByRole("button", { name: "入库" })[0]!);
    fireEvent.change(screen.getByLabelText("系统批号"), { target: { value: "20260101-1" } });
    fireEvent.change(screen.getByLabelText(/入库数量/), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText(/平均每.*价格/), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: "确认入库" }));
    expect(await screen.findByText("同一产品的系统批号不能重复")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));

    fireEvent.click(screen.getByRole("button", { name: "批次 2" }));
    fireEvent.click(screen.getAllByRole("button", { name: "转移" })[1]!);
    fireEvent.change(screen.getByLabelText(/转移数量/), { target: { value: "99" } });
    fireEvent.click(screen.getByRole("button", { name: "确认转移" }));
    expect(await screen.findByText(/普通可转移库存不足/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));

    let lotRow = screen.getByText("20260201-1").closest("div")!;
    fireEvent.click(within(lotRow).getByRole("button", { name: "编辑" }));
    let form = screen.getByRole("heading", { name: "编辑库存批次" }).closest("form")!;
    fireEvent.change(within(form).getByLabelText("系统批号"), { target: { value: "20260101-1" } });
    fireEvent.submit(form);
    expect(within(form).getByText("同一产品的系统批号不能重复")).toBeTruthy();
    fireEvent.click(within(form).getByRole("button", { name: "取消" }));

    lotRow = screen.getByText("20260101-1").closest("div")!;
    fireEvent.click(within(lotRow).getByRole("button", { name: "编辑" }));
    form = screen.getByRole("heading", { name: "编辑库存批次" }).closest("form")!;
    fireEvent.change(within(form).getByLabelText(/入库数量/), { target: { value: "0" } });
    fireEvent.submit(form);
    expect(within(form).getByText("该批次已经使用或损耗 1 片，入库数量不能低于这个数")).toBeTruthy();
  });

  it("keeps inventory dialogs and data stable when repository writes fail", async () => {
    const extraProduct: Product = {
      ...useInventoryStore.getState().products[0]!,
      id: "unused-failure-product", brand: "失败测试产品", model: "F1", sortOrder: 1
    };
    useInventoryStore.setState((state) => ({ products: [
      { ...state.products[0]!, sortOrder: 0 }, extraProduct
    ] }));
    const originalState = useInventoryStore.getState();
    const original = {
      products: structuredClone(originalState.products),
      lots: structuredClone(originalState.lots),
      transactions: structuredClone(originalState.transactions)
    };
    setPersistenceCommandAdapterForTests(async <T,>() => Promise.reject("non-error write failure") as Promise<T>);
    render(<InventoryPage />);

    fireEvent.click(screen.getAllByRole("button", { name: "编辑" })[0]!);
    let form = screen.getByRole("heading", { name: "编辑产品" }).closest("form")!;
    fireEvent.submit(form);
    expect(await within(form).findByText("产品更新失败")).toBeTruthy();
    fireEvent.click(within(form).getByRole("button", { name: "关闭" }));

    fireEvent.click(screen.getAllByRole("button", { name: "入库" })[0]!);
    form = screen.getByRole("heading", { name: "添加库存批次" }).closest("form")!;
    fireEvent.change(within(form).getByLabelText(/平均每.*价格/), { target: { value: "1" } });
    fireEvent.submit(form);
    expect(await within(form).findByText("入库失败")).toBeTruthy();
    fireEvent.click(within(form).getByRole("button", { name: "关闭" }));

    fireEvent.click(screen.getByRole("button", { name: "批次 2" }));
    const firstLot = screen.getByText("20260101-1").closest("div")!;
    fireEvent.click(within(firstLot).getByRole("button", { name: "编辑" }));
    form = screen.getByRole("heading", { name: "编辑库存批次" }).closest("form")!;
    fireEvent.submit(form);
    expect(await within(form).findByText("批次更新失败")).toBeTruthy();
    fireEvent.click(within(form).getByRole("button", { name: "关闭" }));

    fireEvent.click(screen.getAllByRole("button", { name: "转移" })[1]!);
    form = screen.getByRole("heading", { name: "转移库存" }).closest("form")!;
    fireEvent.submit(form);
    expect(await within(form).findByText("库存转移失败")).toBeTruthy();
    fireEvent.click(within(form).getByRole("button", { name: "关闭" }));

    const unusedRow = screen.getByText(/失败测试产品 · F1/).closest("article")!;
    fireEvent.click(within(unusedRow).getByRole("button", { name: "删除" }));
    fireEvent.click(screen.getByRole("button", { name: "确认删除" }));
    expect(await screen.findByText("操作失败")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "取消" }));

    fireEvent.click(screen.getByRole("button", { name: "上移 失败测试产品 F1" }));
    expect(await screen.findByText("产品排序失败")).toBeTruthy();
    expect(useInventoryStore.getState().products).toEqual(original.products);
    expect(useInventoryStore.getState().lots).toEqual(original.lots);
    expect(useInventoryStore.getState().transactions).toEqual(original.transactions);
  });

  it("reorders and deletes an unused product and voids an unused stock lot", async () => {
    useInventoryStore.setState((state) => ({
      products: [
        { ...state.products[0]!, sortOrder: 0 },
        { ...state.products[0]!, id: "unused-product", brand: "未使用产品", sortOrder: 1 }
      ]
    }));
    setPersistenceCommandAdapterForTests(async <T,>(command: string, args?: Record<string, unknown>): Promise<T> => {
      if (command === "reorder_products" || command === "delete_product") return undefined as T;
      if (command === "void_unused_stock_lot") {
        const lot = useInventoryStore.getState().lots.find((entry) => entry.id === args?.id)!;
        const reversalId = String(args?.reversalId);
        return {
          lot: { ...lot, voidedAt: args?.voidedAt, voidedByTransactionId: reversalId },
          transactions: [{
            id: reversalId, stockLotId: lot.id, occurredDate: args?.voidedAt,
            type: "reverse", quantityDelta: -3, reversedTransactionId: "stock-in-2"
          }]
        } as T;
      }
      throw new Error(`Unexpected command ${command}`);
    });
    render(<InventoryPage />);

    fireEvent.click(screen.getByRole("button", { name: "上移 未使用产品 型号 A" }));
    await waitFor(() => expect(useInventoryStore.getState().products.find((entry) => entry.id === "unused-product")?.sortOrder).toBe(0));
    const unusedCard = screen.getByText(/未使用产品 · 型号 A/).closest("article")!;
    fireEvent.click(within(unusedCard).getByRole("button", { name: "删除" }));
    fireEvent.click(screen.getByRole("button", { name: "确认删除" }));
    await waitFor(() => expect(useInventoryStore.getState().products.some((entry) => entry.id === "unused-product")).toBe(false));

    fireEvent.click(screen.getByRole("button", { name: "批次 2" }));
    const lotRow = screen.getByText("20260201-1").closest("div")!;
    fireEvent.click(within(lotRow).getByRole("button", { name: "作废" }));
    fireEvent.click(screen.getByRole("button", { name: "确认作废" }));
    await waitFor(() => expect(useInventoryStore.getState().lots.find((entry) => entry.id === "lot-2")?.voidedAt).toBe("2026-09-06"));
    expect(screen.getByText(/批次 20260201-1 已作废/)).toBeTruthy();
  });

  it("creates and edits packaged soft-lens products and stock snapshots", async () => {
    useItemProfileStore.setState({ profiles: [{
      id: "daily-profile", groupId: "lenses", managementTemplate: "soft_daily",
      standardType: "soft_daily", standardTypeName: "日抛", name: "日抛（R）",
      baseUnit: "片", side: "R", active: true, order: 0
    }] });
    useInventoryStore.setState({
      products: [], lots: [], transactions: [],
      locations: [{ id: "home", name: "家", active: true, order: 0 }]
    });
    useTimelineItemStore.setState({ items: [] });
    useTimelineCareEventStore.setState({ events: [] });
    useUsageFactStore.setState({ facts: [] });
    setPersistenceCommandAdapterForTests(async <T,>(command: string, args?: Record<string, unknown>): Promise<T> => {
      if (command === "create_product" || command === "update_product")
        return structuredClone(args?.product) as T;
      if (command === "receive_stock") return structuredClone(args?.lot) as T;
      if (command === "update_stock_lot")
        return { lot: structuredClone(args?.lot), transactions: [] } as T;
      throw new Error(`Unexpected command ${command}`);
    });
    render(<InventoryPage />);
    fireEvent.click(screen.getByRole("button", { name: "新建产品" }));
    fireEvent.change(screen.getByLabelText("品牌"), { target: { value: "日抛品牌" } });
    fireEvent.change(screen.getByLabelText("型号"), { target: { value: "D5" } });
    fireEvent.change(screen.getByLabelText("默认每盒片数"), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: "创建并继续入库" }));
    expect(await screen.findByRole("heading", { name: "添加库存批次" })).toBeTruthy();
    const stockForm = screen.getByRole("heading", { name: "添加库存批次" }).closest("form")!;
    fireEvent.change(within(stockForm).getByLabelText("生产日期"), { target: { value: "2026-09-05" } });
    fireEvent.change(within(stockForm).getByLabelText("预计到期日期"), { target: { value: "2026-09-04" } });
    fireEvent.submit(stockForm);
    expect(within(stockForm).getByText("预计到期日期不能早于生产日期")).toBeTruthy();
    fireEvent.change(within(stockForm).getByLabelText("预计到期日期"), { target: { value: "2027-09-05" } });
    fireEvent.change(within(stockForm).getByLabelText("入库盒数"), { target: { value: "0" } });
    fireEvent.submit(stockForm);
    expect(within(stockForm).getByText("本次入库数量必须至少为一个基础单位")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("入库盒数"), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText("本批每盒片数"), { target: { value: "5" } });
    fireEvent.change(screen.getByLabelText("入库散片数"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("平均每片价格（元）"), { target: { value: "3.5" } });
    fireEvent.change(screen.getByLabelText("生产批号（选填）"), { target: { value: "DAILY-LOT" } });
    fireEvent.click(screen.getByRole("button", { name: "确认入库" }));
    await waitFor(() => expect(useInventoryStore.getState().lots[0]).toMatchObject({
      initialUnitQuantity: 11, initialPackageQuantity: 2,
      initialLooseUnitQuantity: 1, unitsPerPackageAtReceipt: 5
    }));

    fireEvent.click(screen.getByRole("button", { name: "批次 1" }));
    const lotRow = screen.getByText(/\d{8}-1/).closest("div")!;
    fireEvent.click(within(lotRow).getByRole("button", { name: "编辑" }));
    const lotForm = screen.getByRole("heading", { name: "编辑库存批次" }).closest("form")!;
    fireEvent.change(within(lotForm).getByLabelText("生产日期"), { target: { value: "2026-09-05" } });
    fireEvent.change(within(lotForm).getByLabelText("预计到期日期"), { target: { value: "2026-09-04" } });
    fireEvent.submit(lotForm);
    expect(within(lotForm).getByText("预计到期日期不能早于生产日期")).toBeTruthy();
    fireEvent.change(within(lotForm).getByLabelText("预计到期日期"), { target: { value: "2027-09-05" } });
    fireEvent.change(screen.getByLabelText("入库盒数"), { target: { value: "3" } });
    fireEvent.change(screen.getByLabelText("入库散片数"), { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: "保存批次" }));
    await waitFor(() => expect(useInventoryStore.getState().lots[0]?.initialUnitQuantity).toBe(15));

    const productCard = screen.getByText(/日抛品牌 · D5/).closest("article")!;
    fireEvent.click(within(productCard).getByRole("button", { name: "编辑" }));
    fireEvent.change(screen.getByLabelText("默认每盒片数"), { target: { value: "6" } });
    fireEvent.click(screen.getByRole("button", { name: "保存产品" }));
    await waitFor(() => expect(useInventoryStore.getState().products[0]?.unitsPerPackage).toBe(6));

    const editedLot = useInventoryStore.getState().lots[0]!;
    act(() => useInventoryStore.setState((state) => ({ transactions: [
      ...state.transactions,
      {
        id: "opened-package", stockLotId: editedLot.id, occurredDate: "2026-09-06",
        type: "package_open", quantityDelta: 0, allocatedUnitQuantity: 5,
        relatedInstanceId: "daily-package"
      },
      {
        id: "allocated-loose", stockLotId: editedLot.id, occurredDate: "2026-09-06",
        type: "loose_allocate", quantityDelta: 0, allocatedUnitQuantity: 1,
        relatedInstanceId: "daily-loose"
      }
    ] })));
    const currentLotRow = screen.getByText(editedLot.internalLotCode).closest("div")!;
    fireEvent.click(within(currentLotRow).getByRole("button", { name: "编辑" }));
    const editForm = screen.getByRole("heading", { name: "编辑库存批次" }).closest("form")!;
    fireEvent.change(within(editForm).getByLabelText("入库盒数"), { target: { value: "0" } });
    fireEvent.submit(editForm);
    expect(within(editForm).getByText("该批次已经启用 1 盒，入库盒数不能低于这个数")).toBeTruthy();

    fireEvent.change(within(editForm).getByLabelText("入库盒数"), { target: { value: "3" } });
    fireEvent.change(within(editForm).getByLabelText("入库散片数"), { target: { value: "0" } });
    fireEvent.submit(editForm);
    expect(within(editForm).getByText("该批次已经分配 1 片散片，入库散片数不能低于这个数")).toBeTruthy();

    fireEvent.change(within(editForm).getByLabelText("入库散片数"), { target: { value: "1" } });
    fireEvent.change(within(editForm).getByLabelText("本批每盒片数"), { target: { value: "6" } });
    fireEvent.submit(editForm);
    expect(within(editForm).getByText("该批次已有开盒记录，不能再修改本批每盒片数")).toBeTruthy();
  });

  it("renders product fields for every inventory management template", () => {
    const templates = [
      ["rigid", "lenses", "rigid_long_term", "scleral", "长期硬镜"],
      ["daily", "lenses", "soft_daily", "soft_daily", "日抛镜片"],
      ["reusable", "lenses", "soft_reusable", "soft_reusable", "复用软镜"],
      ["case", "periodic", "lens_case", "lens_case", "镜盒"],
      ["accessory", "periodic", "lens_accessory", "lens_applicator", "吸棒"],
      ["opened", "consumables", "opened_container", "care_solution", "护理液"],
      ["dose", "consumables", "discrete_dose", "protein_removal_solution", "除蛋白液"],
      ["batch", "consumables", "batch_consumable", "saline", "盐水"]
    ] as const;
    const profiles: ItemProfile[] = templates.map(
      ([id, groupId, managementTemplate, standardType, name], order) => ({
        id: `inventory-${id}`,
        groupId,
        managementTemplate,
        standardType,
        standardTypeName: name,
        name,
        baseUnit: managementTemplate === "opened_container" ? "瓶" : "片",
        ...(groupId === "lenses" ? { side: "L" as const } : {}),
        defaultDurationDays: 30,
        active: true,
        order
      })
    );
    useItemProfileStore.setState({ profiles });
    useInventoryStore.setState({
      products: [], lots: [], transactions: [],
      locations: [{ id: "home", name: "家", active: true, order: 0 }]
    });
    useTimelineItemStore.setState({ items: [] });

    render(<InventoryPage />);
    fireEvent.click(screen.getByRole("button", { name: "新建产品" }));
    const form = screen.getByRole("heading", { name: "新建产品" }).closest("form")!;
    const groupSelect = within(form).getByLabelText("用品大类");
    const profileSelect = within(form).getByLabelText(/^用品配置/);

    expect(within(form).getByLabelText("预计使用时长（天）")).toBeTruthy();
    expect(within(form).getByLabelText("镜片规格（选填）")).toBeTruthy();

    fireEvent.change(profileSelect, { target: { value: "inventory-daily" } });
    expect(within(form).getByLabelText("默认每盒片数")).toHaveProperty("value", "30");
    expect(within(form).queryByLabelText("预计使用时长（天）")).toBeNull();

    fireEvent.change(profileSelect, { target: { value: "inventory-reusable" } });
    expect(within(form).getByLabelText("默认每盒片数")).toHaveProperty("value", "6");
    expect(within(form).getByLabelText("产品使用周期（天）")).toBeTruthy();

    fireEvent.change(groupSelect, { target: { value: "periodic" } });
    expect(within(form).getByLabelText("产品规格（选填）")).toBeTruthy();
    expect(within(form).getByLabelText("默认更换周期（天）")).toBeTruthy();
    fireEvent.change(within(form).getByLabelText(/^用品配置/), { target: { value: "inventory-accessory" } });
    expect(within(form).getByLabelText("默认更换周期（天）")).toBeTruthy();

    fireEvent.change(groupSelect, { target: { value: "consumables" } });
    expect(within(form).getByLabelText(/^净含量（mL）/)).toBeTruthy();
    expect(within(form).getByLabelText("开封后有效期（天）")).toBeTruthy();
    expect(within(form).queryByLabelText("产品规格（选填）")).toBeNull();

    fireEvent.change(within(form).getByLabelText(/^用品配置/), { target: { value: "inventory-dose" } });
    expect(within(form).queryByLabelText(/^净含量（mL）/)).toBeNull();
    expect(within(form).queryByLabelText("默认更换周期（天）")).toBeNull();
    fireEvent.change(within(form).getByLabelText(/^用品配置/), { target: { value: "inventory-batch" } });
    expect(within(form).queryByLabelText("产品规格（选填）")).toBeNull();

    act(() => useItemProfileStore.setState({
      profiles: profiles.map((profile) => ({ ...profile, active: false }))
    }));
    fireEvent.submit(form);
    expect(screen.getByText("请选择一个当前已启用的用品配置标准类型")).toBeTruthy();
  });

  it("renders statistics from purchase, inventory, and active item data", () => {
    const { container } = render(<StatisticsPage />);
    expect(container.textContent).toContain("库存");
    expect(container.textContent).toContain("¥510.00");
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "all" } });
    expect(container.textContent).toContain("所有历史");
  });

  it("renders statistics onboarding, warning severities, costs, and chart hover", () => {
    const onNavigateToInventory = vi.fn();
    useInventoryStore.setState({ products: [], locations: [], lots: [], transactions: [] });
    useItemProfileStore.setState({ profiles: [] });
    useTimelineItemStore.setState({ items: [] });
    render(<StatisticsPage onNavigateToInventory={onNavigateToInventory} />);
    expect(screen.getByText("完成基础资料后再查看统计")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "前往库存" }));
    expect(onNavigateToInventory).toHaveBeenCalledTimes(1);
    cleanup();

    const baseProduct = {
      id: "warning-product", itemProfileId: "profile-1", standardType: "scleral" as const,
      brand: "预警产品", baseUnit: "片", unitsPerPackage: 1, active: true
    };
    useItemProfileStore.setState({ profiles: [{
      id: "profile-1", groupId: "lenses", managementTemplate: "rigid_long_term",
      standardType: "scleral", name: "预警配置", baseUnit: "片", active: true, order: 0
    }] });
    useInventoryStore.setState({ products: [baseProduct], locations: [], lots: [], transactions: [] });
    render(<StatisticsPage onNavigateToInventory={onNavigateToInventory} />);
    expect(screen.getByText("为现有产品录入首批库存")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "前往库存" }));
    expect(onNavigateToInventory).toHaveBeenCalledTimes(2);
    cleanup();

    const expiryDates = ["2026-09-05", "2026-09-06", "2026-10-16"] as const;
    const warningLots: StockLot[] = expiryDates.map((expiryDate, index) => ({
      id: `warning-lot-${index}`, productId: baseProduct.id,
      internalLotCode: `WARNING-${index}`, receivedDate: "2026-08-01",
      expiryDate, locationId: "home", initialUnitQuantity: 3,
      unitPriceMinor: 1000, currency: "CNY"
    }));
    const warningTransactions: InventoryTransaction[] = warningLots.flatMap((lot, index) => ([{
      id: `warning-stock-${index}`, stockLotId: lot.id, occurredDate: "2026-08-01",
      type: "stock_in" as const, quantityDelta: 3, locationId: "home"
    }, ...(index === 0 ? [{
      id: "warning-use", stockLotId: lot.id, occurredDate: "2026-09-01",
      type: "consume" as const, quantityDelta: -1, locationId: "home"
    }, {
      id: "warning-loss", stockLotId: lot.id, occurredDate: "2026-09-02",
      type: "loss" as const, quantityDelta: -1, locationId: "home"
    }] : [])
    ]));
    const lowProduct = { ...baseProduct, id: "low-product", brand: "低库存产品" };
    const emptyProduct = { ...baseProduct, id: "empty-product", brand: "零库存产品" };
    useInventoryStore.setState({
      products: [baseProduct, lowProduct, emptyProduct], locations: [], lots: warningLots,
      transactions: [...warningTransactions, {
        id: "orphan-stock", stockLotId: "missing", occurredDate: "2026-08-01",
        type: "stock_in", quantityDelta: 1, locationId: "home"
      }]
    });
    const { container } = render(<StatisticsPage />);
    expect(container.textContent).toContain("已过期 1 天");
    expect(container.textContent).toContain("今天到期");
    expect(container.textContent).toContain("40 天后到期");
    expect(container.textContent).toContain("低库存产品");
    expect(container.textContent).toContain("使用成本");
    expect(container.textContent).toContain("损耗成本");
    const point = container.querySelector('svg[aria-label="每月购买支出曲线"] g[tabindex="0"]')!;
    fireEvent.mouseEnter(point);
    expect(container.querySelector('[class*="chartTooltip"]')).toBeTruthy();
    fireEvent.mouseLeave(point);
    fireEvent.focus(point);
    fireEvent.blur(point);
  });

  it("renders opened-container and batch forecasts and groups minor pie categories", () => {
    const profileSpecs = [
      ["opened", "opened_container", "care_solution"],
      ["batch", "batch_consumable", "saline"],
      ["extra-1", "rigid_long_term", "scleral"],
      ["extra-2", "rigid_long_term", "rgp"],
      ["extra-3", "rigid_long_term", "ortho_k"],
      ["extra-4", "rigid_long_term", "rigid_other"],
      ["extra-5", "lens_accessory", "lens_applicator"]
    ] as const;
    const profiles: ItemProfile[] = profileSpecs.map(([id, managementTemplate, standardType], index) => ({
      id: `stats-profile-${id}`, groupId: managementTemplate === "lens_accessory" ? "periodic" : "consumables",
      managementTemplate, standardType, standardTypeName: `统计类别 ${index + 1}`,
      name: `统计配置 ${index + 1}`, baseUnit: index === 0 ? "瓶" : "份",
      defaultDurationDays: 30, active: true, order: index
    }));
    const products: Product[] = profiles.map((profile, index) => ({
      id: `stats-product-${index}`, itemProfileId: profile.id,
      standardType: profile.standardType, brand: `预测品牌 ${index + 1}`,
      baseUnit: profile.baseUnit!, unitsPerPackage: 1,
      ...(index === 0 ? { capacityMl: 120, defaultDurationDays: 30 } : {}),
      active: true
    }));
    const lots: StockLot[] = products.map((product, index) => ({
      id: `stats-lot-${index}`, productId: product.id, internalLotCode: `STATS-${index}`,
      receivedDate: "2026-08-01", locationId: "home", initialUnitQuantity: 3,
      unitPriceMinor: 1000 - index * 50, currency: "CNY"
    }));
    const transactions: InventoryTransaction[] = lots.map((lot, index) => ({
      id: `stats-stock-${index}`, stockLotId: lot.id, occurredDate: "2026-08-01",
      type: "stock_in", quantityDelta: 3, locationId: "home"
    }));
    const items: TimelineItem[] = [{
      id: "stats-opened", categoryId: profiles[0]!.id, groupId: "consumables",
      categoryName: profiles[0]!.name, productId: products[0]!.id,
      sourceStockLotId: lots[0]!.id, label: "护理液使用", detail: "",
      location: "家", locationId: "home", startDate: "2026-08-01",
      endDate: "2026-08-31", status: "completed", capacityMl: 120,
      stateIntervals: [{ startDate: "2026-08-01", endDate: "2026-08-31", status: "active" }]
    }, {
      id: "stats-batch", categoryId: profiles[1]!.id, groupId: "consumables",
      categoryName: profiles[1]!.name, productId: products[1]!.id,
      sourceStockLotId: lots[1]!.id, label: "盐水使用", detail: "",
      location: "家", locationId: "home", startDate: "2026-09-01",
      endDate: null, status: "active", initialUnitQuantity: 8, usageRatePerDay: 1,
      stateIntervals: [{ startDate: "2026-09-01", endDate: null, status: "active" }]
    }];
    useItemProfileStore.setState({ profiles });
    useInventoryStore.setState({
      products, lots, transactions,
      locations: [{ id: "home", name: "家", active: true, order: 0 }]
    });
    useTimelineItemStore.setState({ items });

    const { container } = render(<StatisticsPage />);
    expect(container.textContent).toContain("预测品牌 1");
    expect(container.textContent).toContain("预测品牌 2");
    expect(container.textContent).toContain("30 天");
    expect(container.textContent).toContain("其他");
    expect(container.textContent).toContain("目前没有库存预警");
  });

  it("renders the timeline, item details, and management dialog", () => {
    const { container } = render(<TimelinePage />);
    expect(container.textContent).toContain("左眼巩膜镜");
    expect(container.textContent).toContain("巩膜镜（L）");
    const lifecycleBar = container.querySelector('g[role="button"]');
    expect(lifecycleBar).toBeTruthy();
    fireEvent.click(lifecycleBar!);
    const drawer = screen.getByLabelText("用品详情");
    expect(drawer.textContent).toContain("测试品牌");
    fireEvent.click(within(drawer).getByRole("button", { name: "编辑资料" }));
    expect(screen.getByLabelText("实例名称")).toBeTruthy();
    fireEvent.click(within(drawer).getByRole("button", { name: "取消" }));
    fireEvent.click(within(drawer).getByRole("button", { name: "暂停使用" }));
    expect(screen.getByRole("heading", { name: "暂停使用" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    fireEvent.click(within(drawer).getByRole("button", { name: "删除误录记录" }));
    expect(screen.getByText(/删除“左眼巩膜镜”/)).toBeTruthy();
    cleanup();
    const onClose = vi.fn();
    render(<ManageItemsDialog onClose={onClose} />);
    expect(screen.getByText("巩膜镜（L）")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "新建配置" }));
    expect(screen.getByLabelText("显示名称")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("管理模板"), {
      target: { value: "soft_daily" }
    });
    expect(screen.getByDisplayValue("日抛软性隐形眼镜（L）")).toBeTruthy();
  });

  it("renders incomplete timeline references with safe fallback text", () => {
    const secondItem = {
      ...useTimelineItemStore.getState().items[0]!,
      id: "second-item",
      label: "第二副硬镜"
    };
    delete secondItem.predictionDate;
    useTimelineItemStore.setState({ items: [{
      id: "orphan-item", categoryId: "profile-1", groupId: "lenses",
      categoryName: "旧硬镜配置", productId: "missing-product",
      sourceStockLotId: "missing-lot", label: "缺失关联实例", detail: "",
      location: "旧地点", locationId: "missing-location",
      locationIntervals: [{ locationId: "missing-location", startDate: "2026-01-01", endDate: null }],
      startDate: "2026-01-01", endDate: null, status: "active"
    }, secondItem] });

    const { container } = render(<TimelinePage />);
    expect(container.textContent).toContain("缺失关联实例");
    expect(container.textContent).toContain("未设置预计更换日期");
    fireEvent.click(container.querySelectorAll('g[role="button"]')[0]!);
    const drawer = screen.getByLabelText("用品详情");
    expect(within(drawer).getByRole("heading", { name: "缺失关联实例" })).toBeTruthy();
    expect(within(drawer).getByText("产品记录缺失")).toBeTruthy();
    expect(drawer.textContent).toContain("批次 记录缺失");
    expect(within(drawer).getByText("未知地点")).toBeTruthy();
  });

  it("renders paused and completed long-term lifecycle variants", () => {
    const base = structuredClone(useTimelineItemStore.getState().items[0]!);
    useTimelineCareEventStore.setState({ events: [] });

    useTimelineItemStore.setState({ items: [{
      ...base,
      status: "paused",
      stateIntervals: [
        { startDate: base.startDate, endDate: "2026-09-01", status: "active" },
        { startDate: "2026-09-01", endDate: null, status: "paused" }
      ]
    }] });
    const pausedView = render(<TimelinePage />);
    fireEvent.click(pausedView.container.querySelector('g[role="button"]')!);
    let drawer = screen.getByLabelText("用品详情");
    expect(within(drawer).getByRole("button", { name: "恢复使用" })).toBeTruthy();
    expect(drawer.textContent).toContain("暂停使用");
    fireEvent.click(within(drawer).getByRole("button", { name: "关闭详情" }));
    pausedView.unmount();

    useTimelineItemStore.setState({ items: [{
      ...base,
      status: "completed",
      endDate: "2026-09-02",
      endReason: "正常结束",
      stateIntervals: [{ startDate: base.startDate, endDate: "2026-09-02", status: "active" }],
      locationIntervals: [{ locationId: "home", startDate: base.startDate, endDate: "2026-09-02" }],
      eyeAssignmentIntervals: [{ startDate: base.startDate, endDate: "2026-09-02", eyeSides: ["L"] }]
    }] });
    const completedView = render(<TimelinePage />);
    fireEvent.click(completedView.container.querySelector('g[role="button"]')!);
    drawer = screen.getByLabelText("用品详情");
    expect(within(drawer).getByRole("button", { name: "撤销结束" })).toBeTruthy();
    expect(drawer.textContent).toContain("实际结束");
  });

  it("shows and edits lifecycle history for a non-rigid paused item", async () => {
    useItemProfileStore.setState({ profiles: [{
      id: "profile-1", groupId: "consumables", managementTemplate: "opened_container",
      standardType: "care_solution", name: "护理液", baseUnit: "瓶",
      active: true, order: 0
    }] });
    useInventoryStore.setState((state) => ({
      ...state,
      products: [{
        ...state.products[0]!, itemProfileId: "profile-1",
        standardType: "care_solution", baseUnit: "瓶"
      }]
    }));
    useTimelineItemStore.setState((state) => ({ items: [{
      ...state.items[0]!, groupId: "consumables", categoryName: "护理液",
      label: "护理液实例", status: "paused",
      stateIntervals: [
        { startDate: "2026-01-02", endDate: "2026-08-20", status: "active" },
        { startDate: "2026-08-20", endDate: "2026-08-22", status: "paused" },
        { startDate: "2026-08-22", endDate: "2026-09-01", status: "active" },
        { startDate: "2026-09-01", endDate: null, status: "paused" }
      ]
    }] }));
    let persistenceFailure: unknown = new Error("history write failed");
    setPersistenceCommandAdapterForTests(async <T,>() => {
      if (persistenceFailure) return Promise.reject(persistenceFailure);
      return undefined as T;
    });

    const { container } = render(<TimelinePage />);
    fireEvent.click(container.querySelector('g[role="button"]')!);
    const drawer = screen.getByLabelText("用品详情");
    const history = within(drawer).getByText("使用历史").closest("section")!;
    expect(within(history).getByText("启用")).toBeTruthy();
    expect(within(history).getAllByText("暂停使用")).toHaveLength(2);
    expect(within(history).getAllByText("恢复使用")).toHaveLength(1);
    expect(within(history).getAllByRole("button", { name: "编辑阶段" })).toHaveLength(2);
    expect(within(drawer).queryByText("护理事件")).toBeNull();

    fireEvent.click(within(history).getAllByRole("button", { name: "编辑阶段" })[0]!);
    fireEvent.change(screen.getByLabelText("暂停日期"), {
      target: { value: "2026-08-19" }
    });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(await screen.findByText("history write failed")).toBeTruthy();
    expect(useTimelineItemStore.getState().items[0]?.stateIntervals?.[1]?.startDate)
      .toBe("2026-08-20");

    persistenceFailure = null;
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(
      useTimelineItemStore.getState().items[0]?.stateIntervals?.[1]?.startDate
    ).toBe("2026-08-19"));
  });

  it("moves all remaining discrete-dose stock with a timeline location change", async () => {
    useItemProfileStore.setState({ profiles: [{
      id: "profile-dose", groupId: "consumables", managementTemplate: "discrete_dose",
      standardType: "protein_removal_solution", name: "除蛋白液", baseUnit: "对",
      active: true, order: 0
    }] });
    useInventoryStore.setState({
      products: [{
        id: "product-dose", itemProfileId: "profile-dose",
        standardType: "protein_removal_solution", brand: "测试除蛋白液",
        baseUnit: "对", unitsPerPackage: 10, active: true
      }],
      locations: [
        { id: "home", name: "家", active: true, order: 0 },
        { id: "office", name: "办公室", active: true, order: 1 }
      ],
      lots: [{
        id: "lot-dose", productId: "product-dose", internalLotCode: "DOSE-1",
        receivedDate: "2026-08-01", locationId: "home", initialUnitQuantity: 10,
        unitPriceMinor: 100, currency: "CNY"
      }, {
        id: "lot-dose-other", productId: "product-dose", internalLotCode: "DOSE-2",
        receivedDate: "2026-08-02", locationId: "home", initialUnitQuantity: 4,
        unitPriceMinor: 100, currency: "CNY"
      }],
      transactions: [{
        id: "stock-dose", stockLotId: "lot-dose", occurredDate: "2026-08-01",
        type: "stock_in", quantityDelta: 10, locationId: "home"
      }, {
        id: "transfer-dose-existing", stockLotId: "lot-dose", occurredDate: "2026-08-05",
        type: "transfer", quantityDelta: 0, fromLocationId: "home",
        toLocationId: "office", transferQuantity: 2
      }, {
        id: "consume-dose", stockLotId: "lot-dose", occurredDate: "2026-09-01",
        type: "consume", quantityDelta: -3, locationId: "home",
        relatedInstanceId: "item-dose"
      }, {
        id: "stock-dose-other", stockLotId: "lot-dose-other", occurredDate: "2026-08-02",
        type: "stock_in", quantityDelta: 4, locationId: "home"
      }]
    });
    useTimelineItemStore.setState({ items: [{
      id: "item-dose", categoryId: "profile-dose", groupId: "consumables",
      categoryName: "除蛋白液", productId: "product-dose",
      sourceStockLotId: "lot-dose", label: "除蛋白液批次", detail: "使用中",
      location: "家", locationId: "home",
      locationIntervals: [{ locationId: "home", startDate: "2026-08-10", endDate: null }],
      startDate: "2026-08-10", endDate: null, status: "active",
      stateIntervals: [{ startDate: "2026-08-10", endDate: null, status: "active" }]
    }] });
    useUsageFactStore.setState({ facts: [{
      id: "fact-dose", itemId: "item-dose", stockLotId: "lot-dose",
      transactionId: "consume-dose", date: "2026-09-01", kind: "dose", quantity: 3
    }] });
    useTimelineCareEventStore.setState({ events: [] });
    let persistenceFailure: unknown = new Error("transfer write failed");
    setPersistenceCommandAdapterForTests(async <T,>() => {
      if (persistenceFailure) return Promise.reject(persistenceFailure);
      return undefined as T;
    });

    const { container } = render(<TimelinePage />);
    fireEvent.click(container.querySelector('g[role="button"]')!);
    let drawer = screen.getByLabelText("用品详情");
    fireEvent.click(within(drawer).getByRole("button", { name: "编辑资料" }));
    fireEvent.change(screen.getByLabelText("当前地点"), {
      target: { value: "office" }
    });
    fireEvent.click(within(drawer).getByRole("button", { name: "保存资料" }));
    expect(await within(drawer).findByText("transfer write failed")).toBeTruthy();
    expect(useTimelineItemStore.getState().items[0]?.locationId).toBe("home");
    expect(useInventoryStore.getState().transactions.filter(
      (transaction) => transaction.type === "transfer"
    )).toHaveLength(1);

    persistenceFailure = null;
    fireEvent.click(within(drawer).getByRole("button", { name: "保存资料" }));
    await waitFor(() => expect(
      useTimelineItemStore.getState().items[0]?.locationId
    ).toBe("office"));
    expect(useInventoryStore.getState().transactions.at(-1)).toMatchObject({
      stockLotId: "lot-dose", type: "transfer", quantityDelta: 0,
      fromLocationId: "home", toLocationId: "office", transferQuantity: 5
    });
    expect(useInventoryStore.getState().transactions.filter(
      (transaction) => transaction.stockLotId === "lot-dose-other"
    )).toHaveLength(1);
    expect(useTimelineItemStore.getState().items[0]?.locationIntervals).toEqual([
      { locationId: "home", startDate: "2026-08-10", endDate: "2026-09-06" },
      { locationId: "office", startDate: "2026-09-06", endDate: null }
    ]);
    expect(useInventoryStore.getState().transactions.find(
      (transaction) => transaction.id === "consume-dose"
    )?.locationId).toBe("home");
    drawer = screen.getByLabelText("用品详情");
    expect(drawer.textContent).toContain("办公室");
  });

  it("reconciles batch stock from an explicit end count and labels actual inventory", async () => {
    useItemProfileStore.setState({ profiles: [{
      id: "profile-batch", groupId: "consumables", managementTemplate: "batch_consumable",
      standardType: "saline", name: "擦手纸", baseUnit: "包",
      active: true, order: 0
    }] });
    useInventoryStore.setState({
      products: [{
        id: "product-batch", itemProfileId: "profile-batch", standardType: "saline",
        brand: "测试擦手纸", baseUnit: "包", unitsPerPackage: 1, active: true
      }],
      locations: [{ id: "home", name: "家", active: true, order: 0 }],
      lots: [{
        id: "lot-batch", productId: "product-batch", internalLotCode: "PAPER-1",
        receivedDate: "2026-09-01", locationId: "home", initialUnitQuantity: 10,
        unitPriceMinor: 500, currency: "CNY"
      }],
      transactions: [{
        id: "stock-batch", stockLotId: "lot-batch", occurredDate: "2026-09-01",
        type: "stock_in", quantityDelta: 10, locationId: "home"
      }]
    });
    useTimelineItemStore.setState({ items: [{
      id: "item-batch", categoryId: "profile-batch", groupId: "consumables",
      categoryName: "擦手纸", productId: "product-batch", sourceStockLotId: "lot-batch",
      label: "擦手纸批次", detail: "使用中", location: "家", locationId: "home",
      locationIntervals: [{ locationId: "home", startDate: "2026-09-04", endDate: null }],
      startDate: "2026-09-04", endDate: null, predictionDate: "2026-09-08",
      initialUnitQuantity: 10, usageRatePerDay: 2, status: "active",
      stateIntervals: [{ startDate: "2026-09-04", endDate: null, status: "active" }]
    }] });
    useUsageFactStore.setState({ facts: [] });
    useTimelineCareEventStore.setState({ events: [] });
    setPersistenceCommandAdapterForTests(async <T,>() => undefined as T);

    const { container } = render(<TimelinePage />);
    const activeBarWidth = container
      .querySelector('g[role="button"] > rect')
      ?.getAttribute("width");
    expect(activeBarWidth).toBeTruthy();
    fireEvent.click(container.querySelector('g[role="button"]')!);
    let drawer = screen.getByLabelText("用品详情");
    expect(drawer.textContent).toContain("预计剩余 4 包");
    fireEvent.click(within(drawer).getByRole("button", { name: "结束使用" }));
    const form = screen.getByRole("heading", { name: "结束使用" }).closest("form")!;
    expect(within(form).getByText(/预计剩余 4 包；账面库存 10 包/)).toBeTruthy();
    expect((within(form).getByLabelText(/^实际剩余数量/) as HTMLInputElement).value)
      .toBe("");
    fireEvent.submit(form);
    expect(await within(form).findByText("请填写实际剩余数量")).toBeTruthy();

    fireEvent.change(within(form).getByLabelText(/^实际剩余数量/), {
      target: { value: "6" }
    });
    fireEvent.submit(form);
    await waitFor(() => expect(
      useTimelineItemStore.getState().items[0]?.status
    ).toBe("completed"));
    expect(useTimelineItemStore.getState().items[0]?.endDate).toBe("2026-09-07");
    expect(
      container.querySelector('g[role="button"] > rect')?.getAttribute("width")
    ).toBe(activeBarWidth);
    expect(useInventoryStore.getState().transactions.at(-1)).toMatchObject({
      stockLotId: "lot-batch", type: "loss", quantityDelta: -4,
      locationId: "home", relatedInstanceId: "item-batch"
    });
    expect(useUsageFactStore.getState().facts[0]).toMatchObject({
      itemId: "item-batch", kind: "extra_loss", quantity: 4
    });
    drawer = screen.getByLabelText("用品详情");
    expect(drawer.textContent).toContain("实际剩余 6 包");
    expect(screen.getByText("实际库存 6 包")).toBeTruthy();

    fireEvent.click(within(drawer).getByRole("button", { name: "撤销结束" }));
    fireEvent.click(screen.getByRole("button", { name: "确认恢复" }));
    await waitFor(() => expect(
      useTimelineItemStore.getState().items[0]?.status
    ).toBe("active"));
    expect(useInventoryStore.getState().transactions.at(-1)?.quantityDelta).toBe(-4);
    expect(useUsageFactStore.getState().facts).toHaveLength(1);
  });

  it("operates timeline search, filters, scale, zoom, pan, and group controls", () => {
    const { container } = render(<TimelinePage />);

    fireEvent.click(screen.getByRole("button", { name: "搜索" }));
    const search = screen.getByPlaceholderText("搜索用品、位置");
    fireEvent.change(search, { target: { value: "不存在的用品" } });
    expect(screen.getByText("没有找到时间轴记录")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "清除筛选" }));
    expect((search as HTMLInputElement).value).toBe("");
    fireEvent.click(screen.getByRole("button", { name: "搜索" }));
    expect(screen.queryByPlaceholderText("搜索用品、位置")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "筛选" }));
    fireEvent.click(screen.getByRole("button", { name: "暂停使用" }));
    expect(screen.getByText("没有找到时间轴记录")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "清除筛选" }));

    const initial = useTimelineViewportStore.getState().viewport;
    fireEvent.click(screen.getByRole("button", { name: "月" }));
    expect(useTimelineViewportStore.getState().viewport.pixelsPerDay).not.toBe(initial.pixelsPerDay);
    fireEvent.click(screen.getByRole("button", { name: "全部" }));
    fireEvent.click(screen.getByRole("button", { name: "放大" }));
    const zoomed = useTimelineViewportStore.getState().viewport.pixelsPerDay;
    fireEvent.click(screen.getByRole("button", { name: "缩小" }));
    expect(useTimelineViewportStore.getState().viewport.pixelsPerDay).toBeLessThan(zoomed);
    fireEvent.click(screen.getByRole("button", { name: "今天" }));
    expect(useTimelineViewportStore.getState().viewport.centerDate).toBe("2026-09-06");

    const svg = container.querySelector('svg[aria-label="用品生命周期时间轴"]')!;
    const plot = svg.parentElement!;
    fireEvent.wheel(plot, { ctrlKey: true, deltaY: -80, clientX: 200 });
    const wheelZoom = useTimelineViewportStore.getState().viewport.pixelsPerDay;
    fireEvent.wheel(plot, { metaKey: true, deltaY: 20, clientX: 300 });
    fireEvent.wheel(plot, { deltaX: 40, deltaY: 1, clientX: 200 });
    fireEvent.wheel(plot, { shiftKey: true, deltaY: 60, clientX: 200 });
    expect(useTimelineViewportStore.getState().viewport.pixelsPerDay).toBeLessThan(wheelZoom);

    const beforePointerPan = useTimelineViewportStore.getState().viewport.centerDate;
    fireEvent.pointerMove(svg, { pointerId: 10, clientX: 120 });
    fireEvent.pointerDown(svg, { button: 1, pointerId: 10, clientX: 100 });
    fireEvent.pointerDown(svg, { button: 0, pointerId: 11, clientX: 100 });
    fireEvent.pointerMove(svg, { pointerId: 11, clientX: 180 });
    fireEvent.pointerUp(svg, { pointerId: 11, clientX: 180 });
    expect(useTimelineViewportStore.getState().viewport.centerDate).not.toBe(beforePointerPan);

    const lensGroup = screen.getByRole("button", { name: /镜片.*1 个配置/ });
    fireEvent.click(lensGroup);
    expect(useTimelineViewportStore.getState().expandedGroups.lenses).toBe(false);
    fireEvent.click(lensGroup);
    expect(useTimelineViewportStore.getState().expandedGroups.lenses).toBe(true);
  });

  it("drags an activation to a new date and supports undo", async () => {
    useTimelineItemStore.setState((state) => ({ items: state.items.map((item) => ({
      ...item,
      stateIntervals: [
        { startDate: "2026-01-02", endDate: "2026-02-01", status: "paused" as const },
        { startDate: "2026-02-01", endDate: null, status: "active" as const }
      ],
      locationIntervals: [
        { locationId: "home", startDate: "2026-01-02", endDate: "2026-03-01" },
        { locationId: "office", startDate: "2026-03-01", endDate: null }
      ],
      locationId: "office",
      location: "办公室",
      eyeAssignmentIntervals: [
        { startDate: "2026-01-02", endDate: "2026-04-01", eyeSides: ["L" as const] },
        { startDate: "2026-04-01", endDate: null, eyeSides: ["R" as const] }
      ],
      eyeSides: ["R" as const]
    })) }));
    const originalItem = structuredClone(useTimelineItemStore.getState().items[0]!);
    let persistenceFailure: unknown = null;
    setPersistenceCommandAdapterForTests(async <T,>(command: string): Promise<T> => {
      if (command === "commit_app_data_mutation") {
        if (persistenceFailure) return Promise.reject(persistenceFailure);
        return undefined as T;
      }
      throw new Error(`Unexpected command ${command}`);
    });
    const { container } = render(<TimelinePage />);
    const svg = container.querySelector('svg[aria-label="用品生命周期时间轴"]')!;
    const bar = container.querySelector('g[role="button"]')!;
    fireEvent.pointerMove(svg, { pointerId: 1, clientX: 100 });
    fireEvent.pointerDown(bar, { button: 1, pointerId: 1, clientX: 100 });
    fireEvent.pointerDown(bar, { button: 0, pointerId: 1, clientX: 100 });
    fireEvent.pointerUp(svg, { pointerId: 1, clientX: 100 });
    expect(screen.queryByRole("heading", { name: "确认修改日期？" })).toBeNull();
    fireEvent.pointerDown(bar, { button: 0, pointerId: 1, clientX: 100 });
    fireEvent.pointerMove(svg, { pointerId: 1, clientX: 116 });
    fireEvent.pointerUp(svg, { pointerId: 1, clientX: 116 });
    expect(screen.getByRole("heading", { name: "确认修改日期？" })).toBeTruthy();
    expect(screen.getByText(/向后移动 2 天/)).toBeTruthy();
    persistenceFailure = "write failed";
    fireEvent.click(screen.getByRole("button", { name: "确认修改" }));
    expect(await screen.findByText("时间调整保存失败")).toBeTruthy();
    expect(useTimelineItemStore.getState().items[0]).toEqual(originalItem);
    persistenceFailure = null;
    fireEvent.click(screen.getByRole("button", { name: "确认修改" }));
    await waitFor(() => expect(useTimelineItemStore.getState().items[0]?.startDate).toBe("2026-01-04"));
    expect(useTimelineItemStore.getState().items[0]).toMatchObject({
      stateIntervals: [{ endDate: "2026-02-03" }, { endDate: null }],
      locationIntervals: [{ endDate: "2026-03-03" }, { endDate: null }],
      eyeAssignmentIntervals: [{ endDate: "2026-04-03" }, { endDate: null }]
    });
    persistenceFailure = new Error("undo move locked");
    fireEvent.click(screen.getByRole("button", { name: "撤销" }));
    expect(await screen.findByText("undo move locked")).toBeTruthy();
    expect(useTimelineItemStore.getState().items[0]?.startDate).toBe("2026-01-04");
    persistenceFailure = null;
    fireEvent.click(screen.getByRole("button", { name: "撤销" }));
    await waitFor(() => expect(useTimelineItemStore.getState().items[0]).toEqual(originalItem));
  });

  it("renders each timeline onboarding stage and its available navigation", () => {
    const profile = useItemProfileStore.getState().profiles[0]!;
    const product = useInventoryStore.getState().products[0]!;
    const lot = useInventoryStore.getState().lots[0]!;
    const stockIn = useInventoryStore.getState().transactions[0]!;
    const onNavigateToInventory = vi.fn();

    useTimelineItemStore.setState({ items: [] });
    useItemProfileStore.setState({ profiles: [] });
    useInventoryStore.setState({ products: [], locations: [], lots: [], transactions: [] });
    render(<TimelinePage onNavigateToInventory={onNavigateToInventory} />);
    expect(screen.getByText("先建立第一条用品配置")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "管理用品配置" }));
    expect(screen.getByRole("heading", { name: "管理用品" })).toBeTruthy();
    cleanup();

    useItemProfileStore.setState({ profiles: [profile] });
    render(<TimelinePage onNavigateToInventory={onNavigateToInventory} />);
    expect(screen.getByText("为用品配置创建产品")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "前往库存创建产品" }));
    expect(onNavigateToInventory).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "向巩膜镜（L）添加记录" }));
    expect(screen.getByText("暂无关联产品")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "前往库存" }));
    expect(onNavigateToInventory).toHaveBeenCalledTimes(2);
    cleanup();

    useInventoryStore.setState({ products: [product], locations: [], lots: [], transactions: [] });
    render(<TimelinePage onNavigateToInventory={onNavigateToInventory} />);
    expect(screen.getByText("录入首批可用库存")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "前往库存入库" }));
    expect(onNavigateToInventory).toHaveBeenCalledTimes(3);
    fireEvent.click(screen.getByRole("button", { name: "向巩膜镜（L）添加记录" }));
    expect(screen.getByText("该产品暂无可用库存")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "前往入库" }));
    expect(onNavigateToInventory).toHaveBeenCalledTimes(4);
    cleanup();

    useInventoryStore.setState({
      products: [product], lots: [lot], transactions: [stockIn],
      locations: [{ id: "home", name: "家", active: true, order: 0 }]
    });
    render(<TimelinePage onNavigateToInventory={onNavigateToInventory} />);
    expect(screen.getByText("添加第一条时间轴记录")).toBeTruthy();
    expect(screen.getByRole("button", { name: "向巩膜镜（L）添加记录" })).toBeTruthy();
  });

  it("activates available stock into a new timeline record", async () => {
    setPersistenceCommandAdapterForTests(async <T,>(command: string): Promise<T> => {
      if (command === "commit_app_data_mutation") return undefined as T;
      throw new Error(`Unexpected command ${command}`);
    });
    render(<TimelinePage />);
    fireEvent.click(screen.getByRole("button", { name: "向巩膜镜（L）添加记录" }));
    fireEvent.change(screen.getByLabelText("实例名称"), { target: { value: "新启用硬镜" } });
    fireEvent.click(screen.getByRole("button", { name: "启用并添加到时间轴" }));
    await waitFor(() => expect(useTimelineItemStore.getState().items).toHaveLength(2));
    expect(screen.getByText("新启用硬镜 已启用并添加到巩膜镜（L）")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
  });

  it("requires eye selection when activating a lens case", async () => {
    useItemProfileStore.setState({ profiles: [{
      id: "profile-case", groupId: "periodic", managementTemplate: "lens_case",
      standardType: "lens_case", name: "镜盒", baseUnit: "个",
      defaultDurationDays: 90, active: true, order: 0
    }] });
    useInventoryStore.setState({
      products: [{
        id: "product-case", itemProfileId: "profile-case", standardType: "lens_case",
        brand: "镜盒品牌", baseUnit: "个", unitsPerPackage: 1,
        defaultDurationDays: 90, active: true
      }],
      locations: [{ id: "home", name: "家", active: true, order: 0 }],
      lots: [{
        id: "lot-case", productId: "product-case", internalLotCode: "CASE-1",
        receivedDate: "2026-08-01", locationId: "home", initialUnitQuantity: 2,
        initialPackageQuantity: 2, initialLooseUnitQuantity: 0,
        unitsPerPackageAtReceipt: 1, unitPriceMinor: 1000, currency: "CNY"
      }],
      transactions: [{
        id: "stock-case", stockLotId: "lot-case", occurredDate: "2026-08-01",
        type: "stock_in", quantityDelta: 2, locationId: "home"
      }]
    });
    useTimelineItemStore.setState({ items: [] });
    useTimelineCareEventStore.setState({ events: [] });
    useUsageFactStore.setState({ facts: [] });
    setPersistenceCommandAdapterForTests(async <T,>(command: string): Promise<T> => {
      if (command === "commit_app_data_mutation") return undefined as T;
      throw new Error(`Unexpected command ${command}`);
    });

    render(<TimelinePage />);
    fireEvent.click(screen.getByRole("button", { name: "向镜盒添加记录" }));
    const form = screen.getByRole("heading", { name: "向“镜盒”添加记录" }).closest("form")!;
    fireEvent.submit(form);
    expect(within(form).getByText("镜盒启用时请至少选择左眼或右眼")).toBeTruthy();
    fireEvent.click(within(form).getByLabelText("左眼"));
    fireEvent.click(within(form).getByLabelText("右眼"));
    fireEvent.submit(form);
    await waitFor(() => expect(useTimelineItemStore.getState().items[0]).toMatchObject({
      eyeSides: ["L", "R"],
      eyeAssignmentIntervals: [{ startDate: "2026-09-06", endDate: null, eyeSides: ["L", "R"] }]
    }));
  });

  it("recalculates add-record defaults when product, lot, and start date change", () => {
    useInventoryStore.setState((state) => ({
      products: [
        ...state.products,
        {
          ...state.products[0]!, id: "product-2", brand: "备选品牌",
          model: "型号 B", defaultDurationDays: 60
        }
      ],
      lots: [
        ...state.lots,
        {
          id: "lot-3", productId: "product-2", internalLotCode: "20260301-1",
          expectedUsageDays: 45, receivedDate: "2026-03-01", locationId: "home",
          initialUnitQuantity: 2, initialPackageQuantity: 2,
          initialLooseUnitQuantity: 0, unitsPerPackageAtReceipt: 1,
          unitPriceMinor: 8000, currency: "CNY"
        },
        {
          id: "lot-4", productId: "product-2", internalLotCode: "20260401-1",
          expectedUsageDays: 30, receivedDate: "2026-04-01", locationId: "office",
          initialUnitQuantity: 1, initialPackageQuantity: 1,
          initialLooseUnitQuantity: 0, unitsPerPackageAtReceipt: 1,
          unitPriceMinor: 7000, currency: "CNY"
        }
      ],
      transactions: [
        ...state.transactions,
        { id: "stock-in-3", stockLotId: "lot-3", occurredDate: "2026-03-01", type: "stock_in", quantityDelta: 2, locationId: "home" },
        { id: "stock-in-4", stockLotId: "lot-4", occurredDate: "2026-04-01", type: "stock_in", quantityDelta: 1, locationId: "office" }
      ]
    }));

    render(<TimelinePage />);
    fireEvent.click(screen.getByRole("button", { name: "向巩膜镜（L）添加记录" }));
    const productSelect = screen.getByLabelText("具体产品");
    fireEvent.change(productSelect, { target: { value: "product-2" } });
    const lotSelect = screen.getByLabelText("来源批次") as HTMLSelectElement;
    expect(["lot-3", "lot-4"]).toContain(lotSelect.value);
    fireEvent.change(lotSelect, { target: { value: "lot-4" } });

    const form = screen.getByRole("heading", { name: "向“巩膜镜（L）”添加记录" }).closest("form")!;
    const startDate = form.querySelector<HTMLInputElement>('input[name="startDate"]')!;
    const expectedEndDate = form.querySelector<HTMLInputElement>('input[name="expectedEndDate"]')!;
    fireEvent.change(startDate, { target: { value: "2026-09-01" } });
    expect(expectedEndDate.value).toBe("2026-09-30");
    fireEvent.click(within(form).getByRole("button", { name: "取消" }));
  });

  it("commits rigid-lens lifecycle, detail, location, and care-event changes", async () => {
    useTimelineCareEventStore.setState({ events: [{
      id: "care-1", itemId: "item-1", kind: "review", plannedDate: "2026-09-06"
    }] });
    setPersistenceCommandAdapterForTests(async <T,>(command: string): Promise<T> => {
      if (command === "commit_app_data_mutation") return undefined as T;
      throw new Error(`Unexpected command ${command}`);
    });
    vi.stubGlobal("confirm", vi.fn(() => true));
    const { container } = render(<TimelinePage />);
    fireEvent.click(container.querySelector('g[role="button"]')!);
    let drawer = screen.getByLabelText("用品详情");

    fireEvent.click(within(drawer).getByRole("button", { name: "编辑资料" }));
    fireEvent.change(screen.getByLabelText("实例名称"), { target: { value: "更新后的硬镜" } });
    fireEvent.click(within(drawer).getByRole("button", { name: "保存资料" }));
    await waitFor(() => expect(useTimelineItemStore.getState().items[0]?.label).toBe("更新后的硬镜"));

    drawer = screen.getByLabelText("用品详情");
    const locationHistory = within(drawer).getByText("地点历史").closest("section")!;
    fireEvent.click(within(locationHistory).getByRole("button", { name: "编辑" }));
    fireEvent.change(screen.getByLabelText("地点"), { target: { value: "office" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(useTimelineItemStore.getState().items[0]?.locationId).toBe("office"));

    drawer = screen.getByLabelText("用品详情");
    fireEvent.click(within(drawer).getByRole("button", { name: "暂停使用" }));
    fireEvent.change(screen.getByLabelText("暂停日期"), { target: { value: "2026-09-04" } });
    fireEvent.click(screen.getByRole("button", { name: "确认" }));
    await waitFor(() => expect(useTimelineItemStore.getState().items[0]?.status).toBe("paused"));

    drawer = screen.getByLabelText("用品详情");
    fireEvent.click(within(drawer).getByRole("button", { name: "恢复使用" }));
    fireEvent.change(screen.getByLabelText("恢复日期"), { target: { value: "2026-09-05" } });
    fireEvent.click(screen.getByRole("button", { name: "确认" }));
    await waitFor(() => expect(useTimelineItemStore.getState().items[0]?.status).toBe("active"));

    drawer = screen.getByLabelText("用品详情");
    fireEvent.click(within(drawer).getByRole("button", { name: "编辑阶段" }));
    fireEvent.change(screen.getByLabelText("暂停日期"), { target: { value: "2026-09-03" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(
      useTimelineItemStore.getState().items[0]?.stateIntervals?.find((interval) => interval.status === "paused")?.startDate
    ).toBe("2026-09-03"));

    drawer = screen.getByLabelText("用品详情");
    fireEvent.click(within(drawer).getByRole("button", { name: "结束使用" }));
    fireEvent.click(screen.getByRole("button", { name: "确认结束使用" }));
    await waitFor(() => expect(useTimelineItemStore.getState().items[0]?.status).toBe("completed"));
    drawer = screen.getByLabelText("用品详情");
    fireEvent.click(within(drawer).getByRole("button", { name: "撤销结束" }));
    fireEvent.click(screen.getByRole("button", { name: "确认恢复" }));
    await waitFor(() => expect(useTimelineItemStore.getState().items[0]?.status).toBe("active"));

    drawer = screen.getByLabelText("用品详情");
    fireEvent.click(within(drawer).getByRole("button", { name: /添加/ }));
    fireEvent.change(screen.getByLabelText("事件类型"), { target: { value: "protein" } });
    fireEvent.change(screen.getByLabelText("记录状态"), { target: { value: "completed" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(useTimelineCareEventStore.getState().events).toHaveLength(2));

    drawer = screen.getByLabelText("用品详情");
    const proteinRecord = within(drawer).getByText("除蛋白").closest("article")!;
    fireEvent.click(within(proteinRecord).getByRole("button", { name: "编辑" }));
    fireEvent.change(screen.getByLabelText("事件日期"), { target: { value: "2026-09-05" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(useTimelineCareEventStore.getState().events.some((event) =>
      event.kind === "protein" && event.completedDate === "2026-09-05"
    )).toBe(true));

    drawer = screen.getByLabelText("用品详情");
    fireEvent.click(within(drawer).getByRole("button", { name: "确认完成" }));
    fireEvent.click(screen.getAllByRole("button", { name: "确认完成" })
      .find((button) => button.getAttribute("type") === "submit")!);
    await waitFor(() => expect(useTimelineCareEventStore.getState().events[0]?.completedDate).toBe("2026-09-06"));
    const plannedRecord = within(drawer).getAllByText("复查")[0]!.closest("article")!;
    fireEvent.click(within(plannedRecord).getByRole("button", { name: "删除" }));
    await waitFor(() => expect(useTimelineCareEventStore.getState().events).toHaveLength(1));
  }, 10_000);

  it("deletes an incorrectly activated timeline instance and restores its inventory", async () => {
    setPersistenceCommandAdapterForTests(async <T,>(command: string): Promise<T> => {
      if (command === "commit_app_data_mutation") return undefined as T;
      throw new Error(`Unexpected command ${command}`);
    });
    const { container } = render(<TimelinePage />);
    fireEvent.click(container.querySelector('g[role="button"]')!);
    fireEvent.click(within(screen.getByLabelText("用品详情")).getByRole("button", { name: "删除误录记录" }));
    expect(screen.getByText("撤销原始启用或库存分配流水，恢复对应库存形态；")).toBeTruthy();
    expect(screen.getByText("删除关联的 1 条护理事件。")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "确认删除记录" }));
    await waitFor(() => expect(useTimelineItemStore.getState().items).toHaveLength(0));
    expect(useTimelineCareEventStore.getState().events).toHaveLength(0);
    expect(useInventoryStore.getState().transactions.some((entry) =>
      entry.reversedTransactionId === "activate-1"
    )).toBe(true);
    expect(useInventoryStore.getState().transactions.find((entry) =>
      entry.reversedTransactionId === "activate-1"
    )).not.toHaveProperty("relatedInstanceId");
    expect(screen.getByRole("status").textContent).toContain("关联库存已同步恢复");
  });

  it("rejects invalid lifecycle and care-event dates without persisting", async () => {
    const { container } = render(<TimelinePage />);
    fireEvent.click(container.querySelector('g[role="button"]')!);
    let drawer = screen.getByLabelText("用品详情");

    fireEvent.click(within(drawer).getByRole("button", { name: "结束使用" }));
    let form = screen.getByRole("heading", { name: "结束使用" }).closest("form")!;
    fireEvent.change(within(form).getByLabelText("实际结束日期"), { target: { value: "2025-12-31" } });
    fireEvent.submit(form);
    expect(await screen.findByText("结束日期不能早于启用日期")).toBeTruthy();
    fireEvent.click(within(form).getByRole("button", { name: "取消" }));

    drawer = screen.getByLabelText("用品详情");
    fireEvent.click(within(drawer).getByRole("button", { name: /添加/ }));
    form = screen.getByRole("heading", { name: "添加护理事件" }).closest("form")!;
    fireEvent.change(within(form).getByLabelText("事件日期"), { target: { value: "" } });
    fireEvent.submit(form);
    expect(screen.getByText("请填写完整的护理事件信息")).toBeTruthy();
    fireEvent.change(within(form).getByLabelText("事件日期"), { target: { value: "2025-12-31" } });
    fireEvent.submit(form);
    expect(screen.getByText("护理事件日期不能早于镜片启用日期")).toBeTruthy();
    fireEvent.change(within(form).getByLabelText("记录状态"), { target: { value: "completed" } });
    fireEvent.change(within(form).getByLabelText("事件日期"), { target: { value: "2027-01-01" } });
    fireEvent.submit(form);
    expect(screen.getByText("实际完成日期不能晚于今天")).toBeTruthy();
    fireEvent.click(within(form).getByRole("button", { name: "取消" }));

    drawer = screen.getByLabelText("用品详情");
    fireEvent.click(within(drawer).getByRole("button", { name: "确认完成" }));
    form = screen.getByRole("heading", { name: "确认已完成复查" }).closest("form")!;
    fireEvent.change(within(form).getByLabelText("实际完成日期"), { target: { value: "" } });
    fireEvent.submit(form);
    expect(screen.getByText("请填写实际完成日期")).toBeTruthy();
    fireEvent.change(within(form).getByLabelText("实际完成日期"), { target: { value: "2025-12-31" } });
    fireEvent.submit(form);
    expect(screen.getByText("实际完成日期不能早于镜片启用日期")).toBeTruthy();
    fireEvent.change(within(form).getByLabelText("实际完成日期"), { target: { value: "2027-01-01" } });
    fireEvent.submit(form);
    expect(screen.getByText("实际完成日期不能晚于今天")).toBeTruthy();
    fireEvent.click(within(form).getByRole("button", { name: "取消" }));
    expect(useTimelineCareEventStore.getState().events).toHaveLength(1);
  });

  it("rejects care-event plans and completions after an item has ended", () => {
    useTimelineItemStore.setState((state) => ({ items: state.items.map((item) => ({
      ...item,
      endDate: "2026-09-05",
      status: "completed" as const,
      stateIntervals: [{ startDate: item.startDate, endDate: "2026-09-05", status: "active" as const }]
    })) }));
    useTimelineCareEventStore.setState({ events: [{
      id: "care-1", itemId: "item-1", kind: "review", plannedDate: "2026-09-04"
    }] });

    const { container } = render(<TimelinePage />);
    fireEvent.click(container.querySelector('g[role="button"]')!);
    let drawer = screen.getByLabelText("用品详情");
    fireEvent.click(within(drawer).getByRole("button", { name: /添加/ }));
    let form = screen.getByRole("heading", { name: "添加护理事件" }).closest("form")!;
    fireEvent.change(within(form).getByLabelText("事件日期"), { target: { value: "2026-09-04" } });
    fireEvent.submit(form);
    expect(within(form).getByText("已经结束使用的镜片不能新增护理计划，可补录已完成事件")).toBeTruthy();

    fireEvent.change(within(form).getByLabelText("记录状态"), { target: { value: "completed" } });
    fireEvent.change(within(form).getByLabelText("事件日期"), { target: { value: "2026-09-05" } });
    fireEvent.submit(form);
    expect(within(form).getByText("护理事件日期不能晚于镜片的实际结束日期")).toBeTruthy();
    fireEvent.click(within(form).getByRole("button", { name: "取消" }));

    drawer = screen.getByLabelText("用品详情");
    fireEvent.click(within(drawer).getByRole("button", { name: "确认完成" }));
    form = screen.getByRole("heading", { name: "确认已完成复查" }).closest("form")!;
    fireEvent.change(within(form).getByLabelText("实际完成日期"), { target: { value: "2026-09-05" } });
    fireEvent.submit(form);
    expect(within(form).getByText("实际完成日期不能晚于镜片的实际结束日期")).toBeTruthy();
    expect(useTimelineCareEventStore.getState().events[0]?.completedDate).toBeUndefined();
  });

  it("rejects detail edits that conflict with predictions and existing history", () => {
    useUsageFactStore.setState({ facts: [{
      id: "fact-history", itemId: "item-1", stockLotId: "lot-1",
      transactionId: "consume-history", date: "2026-02-01", kind: "wear", quantity: 1
    }] });
    useTimelineCareEventStore.setState({ events: [{
      id: "care-history", itemId: "item-1", kind: "review", plannedDate: "2026-02-02"
    }] });
    const { container } = render(<TimelinePage />);
    fireEvent.click(container.querySelector('g[role="button"]')!);
    const drawer = screen.getByLabelText("用品详情");
    fireEvent.click(within(drawer).getByRole("button", { name: "编辑资料" }));
    expect(screen.getByRole("heading", { name: "编辑实例资料" })).toBeTruthy();
    const form = drawer.querySelector("form")!;
    const label = within(form).getByLabelText("实例名称");
    const startDate = form.querySelector<HTMLInputElement>('input[name="startDate"]')!;
    const predictionDate = form.querySelector<HTMLInputElement>('input[name="predictionDate"]')!;

    fireEvent.change(label, { target: { value: "" } });
    fireEvent.submit(form);
    expect(within(form).getByText("请填写完整的实例名称和地点")).toBeTruthy();

    fireEvent.change(label, { target: { value: "有效名称" } });
    fireEvent.change(predictionDate, { target: { value: "2025-12-31" } });
    fireEvent.submit(form);
    expect(within(form).getByText("预计更换日期不能早于启用日期")).toBeTruthy();

    fireEvent.change(predictionDate, { target: { value: "2027-01-01" } });
    fireEvent.change(startDate, { target: { value: "2026-03-01" } });
    fireEvent.submit(form);
    expect(within(form).getByText("启用日期不能晚于已有的使用或损耗记录")).toBeTruthy();

    act(() => useUsageFactStore.setState({ facts: [] }));
    fireEvent.submit(form);
    expect(within(form).getByText("启用日期不能晚于已有的护理事件")).toBeTruthy();

    act(() => {
      useTimelineCareEventStore.setState({ events: [] });
      useTimelineItemStore.setState((state) => ({ items: state.items.map((item) =>
        item.id === "item-1"
          ? { ...item, stateIntervals: [{ startDate: item.startDate, endDate: "2026-02-15", status: "active" }] }
          : item
      ) }));
    });
    fireEvent.submit(form);
    expect(within(form).getByText("启用日期必须早于第一个状态区间的结束日期")).toBeTruthy();

    act(() => useTimelineItemStore.setState((state) => ({ items: state.items.map((item) => {
      if (item.id !== "item-1") return item;
      const completed = { ...item, status: "completed" as const, endDate: "2026-02-20" as const };
      delete completed.stateIntervals;
      return completed;
    }) })));
    fireEvent.submit(form);
    expect(within(form).getByText("启用日期必须早于实际结束日期")).toBeTruthy();
  });

  it("keeps timeline state unchanged when committed mutations fail", async () => {
    setPersistenceCommandAdapterForTests(async <T,>(command: string): Promise<T> => {
      if (command === "commit_app_data_mutation") throw new Error("database locked");
      throw new Error(`Unexpected command ${command}`);
    });
    const originalItem = structuredClone(useTimelineItemStore.getState().items[0]!);
    const { container } = render(<TimelinePage />);
    fireEvent.click(container.querySelector('g[role="button"]')!);
    let drawer = screen.getByLabelText("用品详情");

    fireEvent.click(within(drawer).getByRole("button", { name: "编辑资料" }));
    fireEvent.change(within(drawer).getByLabelText("实例名称"), { target: { value: "不应保存" } });
    fireEvent.click(within(drawer).getByRole("button", { name: "保存资料" }));
    expect(await within(drawer).findByText("database locked")).toBeTruthy();
    expect(useTimelineItemStore.getState().items[0]).toEqual(originalItem);
    fireEvent.click(within(drawer).getByRole("button", { name: "取消" }));

    drawer = screen.getByLabelText("用品详情");
    const locationHistory = within(drawer).getByText("地点历史").closest("section")!;
    fireEvent.click(within(locationHistory).getByRole("button", { name: "编辑" }));
    let form = screen.getByRole("heading", { name: "编辑地点记录" }).closest("form")!;
    fireEvent.change(within(form).getByLabelText("地点"), { target: { value: "office" } });
    fireEvent.submit(form);
    expect(await within(form).findByText("database locked")).toBeTruthy();
    fireEvent.click(within(form).getByRole("button", { name: "取消" }));

    drawer = screen.getByLabelText("用品详情");
    fireEvent.click(within(drawer).getByRole("button", { name: "暂停使用" }));
    form = screen.getByRole("heading", { name: "暂停使用" }).closest("form")!;
    fireEvent.submit(form);
    expect(await within(form).findByText("database locked")).toBeTruthy();
    fireEvent.click(within(form).getByRole("button", { name: "取消" }));

    drawer = screen.getByLabelText("用品详情");
    fireEvent.click(within(drawer).getByRole("button", { name: /添加/ }));
    form = screen.getByRole("heading", { name: "添加护理事件" }).closest("form")!;
    fireEvent.submit(form);
    expect(await within(form).findByText("database locked")).toBeTruthy();
    fireEvent.click(within(form).getByRole("button", { name: "取消" }));

    drawer = screen.getByLabelText("用品详情");
    fireEvent.click(within(drawer).getByRole("button", { name: "确认完成" }));
    form = screen.getByRole("heading", { name: "确认已完成复查" }).closest("form")!;
    fireEvent.submit(form);
    expect(await within(form).findByText("database locked")).toBeTruthy();
    fireEvent.click(within(form).getByRole("button", { name: "取消" }));

    drawer = screen.getByLabelText("用品详情");
    const careRecord = within(drawer).getByText("计划复查").closest("article")!;
    fireEvent.click(within(careRecord).getByRole("button", { name: "编辑" }));
    form = screen.getByRole("heading", { name: "编辑护理事件" }).closest("form")!;
    fireEvent.change(within(form).getByLabelText("事件日期"), { target: { value: "2026-09-05" } });
    fireEvent.submit(form);
    expect(await within(form).findByText("database locked")).toBeTruthy();
    fireEvent.click(within(form).getByRole("button", { name: "取消" }));

    drawer = screen.getByLabelText("用品详情");
    fireEvent.click(within(drawer).getByRole("button", { name: "删除误录记录" }));
    fireEvent.click(screen.getByRole("button", { name: "确认删除记录" }));
    expect(await screen.findByText("database locked")).toBeTruthy();
    expect(useTimelineItemStore.getState().items[0]).toEqual(originalItem);
  });

  it("expands and collapses long usage and care-event histories", () => {
    useUsageFactStore.setState({ facts: [
      { id: "fact-1", itemId: "item-1", stockLotId: "lot-1", transactionId: "consume-1", date: "2026-09-05", kind: "wear", quantity: 1 },
      { id: "fact-2", itemId: "item-1", stockLotId: "lot-1", transactionId: "consume-2", date: "2026-09-04", kind: "dose", quantity: 1 },
      { id: "fact-3", itemId: "item-1", stockLotId: "lot-1", transactionId: "consume-3", date: "2026-09-03", kind: "extra_loss", quantity: 1, reason: "破损" },
      { id: "fact-4", itemId: "item-1", stockLotId: "lot-1", transactionId: "consume-4", date: "2026-09-02", kind: "extra_loss", quantity: 1 }
    ] });
    useTimelineCareEventStore.setState({ events: [
      { id: "care-future", itemId: "item-1", kind: "review", plannedDate: "2026-09-10" },
      { id: "care-due", itemId: "item-1", kind: "protein", plannedDate: "2026-09-01" },
      { id: "care-complete", itemId: "item-1", kind: "review", plannedDate: "2026-09-02", completedDate: "2026-09-03" },
      { id: "care-later", itemId: "item-1", kind: "protein", plannedDate: "2026-09-12" }
    ] });

    const { container } = render(<TimelinePage />);
    fireEvent.click(container.querySelector('g[role="button"]')!);
    const drawer = screen.getByLabelText("用品详情");
    const usageSection = within(drawer).getByText("使用与损耗记录").closest("section")!;
    expect(within(usageSection).queryByText("额外消耗")).toBeNull();
    fireEvent.click(within(usageSection).getByRole("button", { name: "查看全部 4 条" }));
    expect(within(usageSection).getByText("额外消耗")).toBeTruthy();
    fireEvent.click(within(usageSection).getByRole("button", { name: "收起使用与损耗记录" }));

    const careSection = within(drawer).getByText("护理事件").closest("section")!;
    expect(within(careSection).getByText("到期待确认")).toBeTruthy();
    expect(within(careSection).getAllByText("计划中")).toHaveLength(2);
    fireEvent.click(within(careSection).getByRole("button", { name: "查看全部 4 条" }));
    expect(within(careSection).getByText("已完成")).toBeTruthy();
    fireEvent.click(within(careSection).getByRole("button", { name: "收起护理事件" }));
  });

  it("renders every management template and exposes its lifecycle actions", async () => {
    const templates = [
      ["rigid", "lenses", "rigid_long_term", "scleral", "长期硬镜"],
      ["daily", "lenses", "soft_daily", "soft_daily", "日抛镜片"],
      ["reusable", "lenses", "soft_reusable", "soft_reusable", "复用软镜"],
      ["case", "periodic", "lens_case", "lens_case", "镜盒"],
      ["accessory", "periodic", "lens_accessory", "lens_applicator", "吸棒"],
      ["opened", "consumables", "opened_container", "care_solution", "护理液"],
      ["dose", "consumables", "discrete_dose", "protein_removal_solution", "除蛋白液"],
      ["batch", "consumables", "batch_consumable", "saline", "盐水"]
    ] as const;
    const profiles: ItemProfile[] = templates.map(([id, groupId, managementTemplate, standardType, name], order) => ({
      id: `profile-${id}`, groupId, managementTemplate, standardType, name,
      standardTypeName: name, baseUnit: managementTemplate === "opened_container" ? "瓶" : "片",
      ...(groupId === "lenses" ? { side: "L" as const } : {}),
      defaultDurationDays: 30, active: true, order
    }));
    const products: Product[] = templates.map(([id, , , standardType, name], order) => ({
      id: `product-${id}`, itemProfileId: `profile-${id}`, standardType,
      brand: `${name}品牌`, model: `M${order + 1}`, specification: "测试规格",
      baseUnit: id === "opened" ? "瓶" : "片",
      unitsPerPackage: id === "daily" || id === "reusable" ? 6 : 1,
      defaultDurationDays: 30, active: true
    }));
    const lots: StockLot[] = templates.map(([id], order) => ({
      id: `lot-${id}`, productId: `product-${id}`, internalLotCode: `202608-${order + 1}`,
      receivedDate: "2026-08-01", locationId: "home",
      initialUnitQuantity: id === "daily" || id === "reusable" ? 12 : 8,
      initialPackageQuantity: id === "daily" || id === "reusable" ? 2 : 8,
      initialLooseUnitQuantity: 0,
      unitsPerPackageAtReceipt: id === "daily" || id === "reusable" ? 6 : 1,
      unitPriceMinor: 1000 + order * 100, currency: "CNY"
    }));
    const transactions: InventoryTransaction[] = templates.flatMap(([id]) => ([{
      id: `stock-in-${id}`, stockLotId: `lot-${id}`, occurredDate: "2026-08-01",
      type: "stock_in" as const,
      quantityDelta: id === "daily" || id === "reusable" ? 12 : 8,
      locationId: "home"
    }, {
      id: `activate-${id}`, stockLotId: `lot-${id}`, occurredDate: "2026-08-10",
      type: "activate" as const, quantityDelta: -1, relatedInstanceId: `item-${id}`,
      locationId: "home", reversibleWithInstance: true
    }]));
    const items: TimelineItem[] = templates.map(([id, groupId, managementTemplate, , name]) => ({
      id: `item-${id}`, categoryId: `profile-${id}`, groupId, categoryName: name,
      productId: `product-${id}`, sourceStockLotId: `lot-${id}`, label: `${name}实例`,
      detail: "覆盖测试", location: "家", locationId: "home",
      locationIntervals: [{ locationId: "home", startDate: "2026-08-10", endDate: null }],
      startDate: "2026-08-10", endDate: null,
      predictionDate: managementTemplate === "opened_container" ? "2026-09-20" : "2026-09-09",
      ...(managementTemplate === "opened_container" ? {
        openedExpiryDate: "2026-10-01", depletionPredictionDate: "2026-09-20",
        capacityMl: 120, usageRatePerDay: 2
      } : {}),
      ...(managementTemplate === "batch_consumable" ? {
        initialUnitQuantity: 8, usageRatePerDay: 2
      } : {}),
      ...(managementTemplate === "lens_case" ? {
        eyeSides: ["L"] as Array<"L" | "R">,
        eyeAssignmentIntervals: [{ startDate: "2026-08-10" as const, endDate: null, eyeSides: ["L"] as Array<"L" | "R"> }]
      } : {}),
      ...(managementTemplate === "soft_reusable" ? { reusableLensCycles: [{
        id: "cycle-1", label: "第一片", startDate: "2026-08-10", endDate: null,
        predictionDate: "2026-09-09", status: "active"
      }] as NonNullable<TimelineItem["reusableLensCycles"]> } : {}),
      ...(managementTemplate === "soft_daily" ? {
        initialUnitQuantity: 6, inventorySourceKind: "package" as const
      } : {}),
      status: "active", stateIntervals: [{ startDate: "2026-08-10", endDate: null, status: "active" }]
    }));
    useItemProfileStore.setState({ profiles });
    useInventoryStore.setState({
      products, lots, transactions,
      locations: [{ id: "home", name: "家", active: true, order: 0 }]
    });
    useTimelineItemStore.setState({ items });
    useTimelineCareEventStore.setState({ events: [] });
    useUsageFactStore.setState({ facts: [] });
    let persistenceFailure: unknown = null;
    setPersistenceCommandAdapterForTests(async <T,>() => {
      if (persistenceFailure) return Promise.reject(persistenceFailure);
      return undefined as T;
    });

    const { container } = render(<TimelinePage />);
    for (const [, , managementTemplate, , name] of templates) {
      fireEvent.click(screen.getByRole("button", { name: `向${name}添加记录` }));
      const addForm = screen.getByRole("heading", { name: `向“${name}”添加记录` }).closest("form")!;
      expect(within(addForm).getByLabelText("具体产品")).toBeTruthy();
      expect(within(addForm).getByLabelText("来源批次")).toBeTruthy();
      if (managementTemplate === "soft_daily" || managementTemplate === "soft_reusable") {
        const source = within(addForm).getByLabelText("库存来源");
        fireEvent.change(source, { target: { value: "loose" } });
        if (managementTemplate === "soft_daily") {
          expect(within(addForm).getByLabelText(/^本次分配散片数/)).toBeTruthy();
          expect(within(addForm).getByText("只分配入库时登记的散片，不会占用已开封盒的剩余片数")).toBeTruthy();
        } else {
          expect(addForm.textContent).toContain("从可用散片中启用 1 片");
        }
        fireEvent.change(source, { target: { value: "package" } });
      }
      if (managementTemplate === "batch_consumable") {
        expect(within(addForm).getByLabelText(/预计每日使用量/)).toBeTruthy();
      }
      if (managementTemplate === "lens_case") {
        expect(within(addForm).getByText("启用眼别")).toBeTruthy();
        expect(within(addForm).getByLabelText("预计切换／更换眼别日期")).toBeTruthy();
      }
      if (managementTemplate === "opened_container") {
        expect(within(addForm).getByLabelText("开封后最晚使用日期")).toBeTruthy();
        expect(within(addForm).getByLabelText(/^预计更换日期/)).toBeTruthy();
      }
      fireEvent.click(within(addForm).getByRole("button", { name: "取消" }));
    }
    const bars = [...container.querySelectorAll('g[role="button"]')];
    expect(bars).toHaveLength(8);
    const actionLabels = [
      ["暂停使用", "结束使用"],
      ["记录佩戴", "额外消耗", "提前结束／丢弃"],
      ["盒内镜片损耗", "结束当前镜片"],
      ["切换使用眼别", "更换／结束使用"],
      ["更换／结束使用"],
      ["暂停使用", "结束使用"],
      ["记录使用一对", "提前结束／丢弃"],
      ["暂停使用", "结束使用"]
    ];
    bars.forEach((bar, index) => {
      fireEvent.click(bar);
      const drawer = screen.getByLabelText("用品详情");
      expect(drawer.textContent).toContain(templates[index]![4]);
      for (const label of actionLabels[index]!) {
        fireEvent.click(within(drawer).getByRole("button", { name: label }));
        expect(screen.getByRole("button", { name: "取消" })).toBeTruthy();
        fireEvent.click(screen.getByRole("button", { name: "取消" }));
      }
      fireEvent.click(within(drawer).getByRole("button", { name: "关闭详情" }));
    });

    const openTemplate = (index: number) => {
      fireEvent.click(container.querySelectorAll('g[role="button"]')[index]!);
      return screen.getByLabelText("用品详情");
    };
    let drawer = openTemplate(1);
    fireEvent.click(within(drawer).getByRole("button", { name: "记录佩戴" }));
    let usageForm = screen.getByRole("heading", { name: "记录当天佩戴" }).closest("form")!;
    fireEvent.change(within(usageForm).getByLabelText("日期"), { target: { value: "2026-08-09" } });
    fireEvent.submit(usageForm);
    expect(within(usageForm).getByText("记录日期必须在启用日期和今天之间")).toBeTruthy();
    fireEvent.change(within(usageForm).getByLabelText("日期"), { target: { value: "2026-09-06" } });
    persistenceFailure = "write failed";
    fireEvent.submit(usageForm);
    expect(await within(usageForm).findByText("记录失败")).toBeTruthy();
    expect(useUsageFactStore.getState().facts).toHaveLength(0);
    persistenceFailure = null;
    fireEvent.click(screen.getByRole("button", { name: "确认记录" }));
    await waitFor(() => expect(useUsageFactStore.getState().facts.some((fact) => fact.kind === "wear")).toBe(true));

    drawer = screen.getByLabelText("用品详情");
    fireEvent.click(within(drawer).getByRole("button", { name: "记录佩戴" }));
    usageForm = screen.getByRole("heading", { name: "记录当天佩戴" }).closest("form")!;
    fireEvent.submit(usageForm);
    expect(within(usageForm).getByText("这一天已经记录过正常佩戴，同日第二片请记为额外消耗")).toBeTruthy();
    fireEvent.click(within(usageForm).getByRole("button", { name: "取消" }));

    drawer = screen.getByLabelText("用品详情");
    fireEvent.click(within(drawer).getByRole("button", { name: "额外消耗" }));
    usageForm = screen.getByRole("heading", { name: "记录额外消耗" }).closest("form")!;
    fireEvent.change(within(usageForm).getByLabelText("额外消耗数量"), { target: { value: "99" } });
    fireEvent.submit(usageForm);
    expect(within(usageForm).getByText("盒内只剩 5 片")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("额外消耗数量"), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText("原因（选填）"), { target: { value: "破损" } });
    fireEvent.click(screen.getByRole("button", { name: "确认记录" }));
    await waitFor(() => expect(useUsageFactStore.getState().facts.some((fact) => fact.reason === "破损")).toBe(true));

    drawer = screen.getByLabelText("用品详情");
    const lossRecord = within(drawer).getByText("破损").closest("article")!;
    fireEvent.click(within(lossRecord).getByRole("button", { name: "编辑" }));
    fireEvent.change(screen.getByLabelText("数量"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("原因"), { target: { value: "掉落" } });
    persistenceFailure = new Error("usage edit locked");
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(await screen.findByText("usage edit locked")).toBeTruthy();
    expect(useUsageFactStore.getState().facts.some((fact) => fact.reason === "破损")).toBe(true);
    persistenceFailure = null;
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(useUsageFactStore.getState().facts.some((fact) => fact.reason === "掉落")).toBe(true));

    drawer = screen.getByLabelText("用品详情");
    const wearRecord = within(drawer).getByText("正常佩戴").closest("article")!;
    persistenceFailure = "write failed";
    fireEvent.click(within(wearRecord).getByRole("button", { name: "撤销" }));
    expect(await within(drawer).findByText("撤销记录失败")).toBeTruthy();
    expect(useUsageFactStore.getState().facts.some((fact) => fact.kind === "wear")).toBe(true);
    persistenceFailure = null;
    fireEvent.click(within(wearRecord).getByRole("button", { name: "撤销" }));
    await waitFor(() => expect(within(screen.getByLabelText("用品详情")).queryByText("正常佩戴")).toBeNull());

    drawer = screen.getByLabelText("用品详情");
    fireEvent.click(within(drawer).getByRole("button", { name: "提前结束／丢弃" }));
    fireEvent.change(screen.getByLabelText("原因（选填）"), { target: { value: "旅行前更换" } });
    fireEvent.click(screen.getByRole("button", { name: "确认结束并记为损耗" }));
    await waitFor(() => expect(useTimelineItemStore.getState().items.find((item) => item.id === "item-daily")?.status).toBe("completed"));
    const discardFactId = useTimelineItemStore.getState().items
      .find((item) => item.id === "item-daily")?.completionUsageFactId;
    drawer = screen.getByLabelText("用品详情");
    fireEvent.click(within(drawer).getByRole("button", { name: "撤销丢弃" }));
    expect(screen.getByText("同步撤销本次丢弃产生的库存损耗。")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "确认恢复" }));
    await waitFor(() => expect(
      useTimelineItemStore.getState().items.find((item) => item.id === "item-daily")?.status
    ).toBe("active"));
    expect(discardFactId).toBeTruthy();
    expect(useUsageFactStore.getState().facts.some((fact) => fact.id === discardFactId)).toBe(false);
    fireEvent.click(within(screen.getByLabelText("用品详情")).getByRole("button", { name: "关闭详情" }));

    drawer = openTemplate(6);
    fireEvent.click(within(drawer).getByRole("button", { name: "记录使用一对" }));
    fireEvent.click(screen.getByRole("button", { name: "确认记录" }));
    await waitFor(() => expect(useUsageFactStore.getState().facts.some((fact) => fact.kind === "dose")).toBe(true));
    fireEvent.click(within(screen.getByLabelText("用品详情")).getByRole("button", { name: "关闭详情" }));

    drawer = openTemplate(3);
    fireEvent.click(within(drawer).getByRole("button", { name: "切换使用眼别" }));
    const assignmentForm = screen.getByRole("heading", { name: "切换使用眼别" }).closest("form")!;
    fireEvent.change(within(assignmentForm).getByLabelText("切换日期"), { target: { value: "2026-08-09" } });
    fireEvent.submit(assignmentForm);
    expect(within(assignmentForm).getByText("切换日期必须在当前眼别阶段开始日期和今天之间")).toBeTruthy();
    fireEvent.change(within(assignmentForm).getByLabelText("切换日期"), { target: { value: "2026-09-06" } });
    const eyeOptions = within(assignmentForm).getAllByRole("checkbox");
    fireEvent.click(eyeOptions[0]!);
    fireEvent.submit(assignmentForm);
    expect(within(assignmentForm).getByText("请至少选择左眼或右眼")).toBeTruthy();
    fireEvent.click(eyeOptions[1]!);
    persistenceFailure = new Error("assignment locked");
    fireEvent.submit(assignmentForm);
    expect(await within(assignmentForm).findByText("assignment locked")).toBeTruthy();
    expect(useTimelineItemStore.getState().items.find((item) => item.id === "item-case")?.eyeSides).toEqual(["L"]);
    persistenceFailure = null;
    fireEvent.click(screen.getByRole("button", { name: "保存切换" }));
    await waitFor(() => expect(useTimelineItemStore.getState().items.find((item) => item.id === "item-case")?.eyeSides).toEqual(["R"]));

    drawer = screen.getByLabelText("用品详情");
    const eyeHistory = within(drawer).getByText("眼别使用记录").closest("section")!;
    let eyeRecords = eyeHistory.querySelectorAll("article");
    fireEvent.click(within(eyeRecords[0]!).getByRole("button", { name: "编辑" }));
    let eyeForm = screen.getByRole("heading", { name: "编辑眼别使用记录" }).closest("form")!;
    fireEvent.click(within(eyeForm).getByLabelText("左眼"));
    fireEvent.submit(eyeForm);
    expect(within(eyeForm).getByText("请至少选择左眼或右眼")).toBeTruthy();

    fireEvent.click(within(eyeForm).getByLabelText("左眼"));
    let eyeEndDate = eyeForm.querySelector<HTMLInputElement>('input[name="endDate"]')!;
    fireEvent.change(eyeEndDate, { target: { value: "2026-08-09" } });
    fireEvent.submit(eyeForm);
    expect(within(eyeForm).getByText("结束日期必须晚于开始日期")).toBeTruthy();
    fireEvent.change(eyeEndDate, { target: { value: "" } });
    fireEvent.submit(eyeForm);
    expect(within(eyeForm).getByText("历史眼别记录必须填写结束日期")).toBeTruthy();

    fireEvent.change(eyeEndDate, { target: { value: "2026-09-06" } });
    fireEvent.submit(eyeForm);
    expect(within(eyeForm).getByText("结束日期不能晚于下一段开始日期")).toBeTruthy();

    fireEvent.change(eyeEndDate, { target: { value: "2026-09-05" } });
    fireEvent.click(within(eyeForm).getByLabelText("右眼"));
    persistenceFailure = "write failed";
    fireEvent.submit(eyeForm);
    expect(await within(eyeForm).findByText("眼别记录保存失败")).toBeTruthy();
    persistenceFailure = null;
    fireEvent.submit(eyeForm);
    await waitFor(() => expect(
      useTimelineItemStore.getState().items.find((item) => item.id === "item-case")
        ?.eyeAssignmentIntervals?.[0]?.eyeSides
    ).toEqual(["L", "R"]));

    drawer = screen.getByLabelText("用品详情");
    eyeRecords = within(drawer).getByText("眼别使用记录").closest("section")!.querySelectorAll("article");
    fireEvent.click(within(eyeRecords[1]!).getByRole("button", { name: "编辑" }));
    eyeForm = screen.getByRole("heading", { name: "编辑眼别使用记录" }).closest("form")!;
    const eyeStartDate = eyeForm.querySelector<HTMLInputElement>('input[name="startDate"]')!;
    eyeEndDate = eyeForm.querySelector<HTMLInputElement>('input[name="endDate"]')!;
    fireEvent.change(eyeStartDate, { target: { value: "2026-09-05" } });
    fireEvent.submit(eyeForm);
    expect(within(eyeForm).getByText("开始日期不能早于上一段结束日期")).toBeTruthy();
    fireEvent.change(eyeStartDate, { target: { value: "2026-09-06" } });
    fireEvent.change(eyeEndDate, { target: { value: "2026-09-06" } });
    fireEvent.submit(eyeForm);
    expect(within(eyeForm).getByText("当前使用阶段不填写结束日期，请使用切换眼别创建下一段")).toBeTruthy();
    fireEvent.click(within(eyeForm).getByRole("button", { name: "取消" }));
    fireEvent.click(within(screen.getByLabelText("用品详情")).getByRole("button", { name: "关闭详情" }));

    drawer = openTemplate(2);
    fireEvent.click(within(drawer).getByRole("button", { name: "结束当前镜片" }));
    fireEvent.click(screen.getByRole("button", { name: "确认结束使用" }));
    await waitFor(() => expect(
      useTimelineItemStore.getState().items.find((item) => item.id === "item-reusable")
        ?.reusableLensCycles?.[0]?.status
    ).toBe("completed"));

    drawer = screen.getByLabelText("用品详情");
    let completedCycle = within(drawer).getByText("镜片使用 · 第一片").closest("article")!;
    persistenceFailure = "write failed";
    fireEvent.click(within(completedCycle).getByRole("button", { name: "撤销结束" }));
    expect(await within(drawer).findByText("撤销镜片结束失败")).toBeTruthy();
    expect(useTimelineItemStore.getState().items.find((item) => item.id === "item-reusable")
      ?.reusableLensCycles?.[0]?.status).toBe("completed");
    persistenceFailure = null;
    fireEvent.click(within(completedCycle).getByRole("button", { name: "撤销结束" }));
    await waitFor(() => expect(
      useTimelineItemStore.getState().items.find((item) => item.id === "item-reusable")
        ?.reusableLensCycles?.[0]?.status
    ).toBe("active"));

    drawer = screen.getByLabelText("用品详情");
    fireEvent.click(within(drawer).getByRole("button", { name: "结束当前镜片" }));
    fireEvent.click(screen.getByRole("button", { name: "确认结束使用" }));
    await waitFor(() => expect(
      useTimelineItemStore.getState().items.find((item) => item.id === "item-reusable")
        ?.reusableLensCycles?.[0]?.status
    ).toBe("completed"));

    drawer = screen.getByLabelText("用品详情");
    completedCycle = within(drawer).getByText("镜片使用 · 第一片").closest("article")!;
    fireEvent.click(within(completedCycle).getByRole("button", { name: "编辑" }));
    fireEvent.change(screen.getByLabelText("镜片名称"), { target: { value: "首片" } });
    persistenceFailure = "write failed";
    fireEvent.click(screen.getByRole("button", { name: "保存镜片" }));
    const cycleForm = screen.getByRole("heading", { name: "编辑镜片信息" }).closest("form")!;
    expect(await within(cycleForm).findByText("镜片信息修改失败")).toBeTruthy();
    expect(useTimelineItemStore.getState().items.find((item) => item.id === "item-reusable")
      ?.reusableLensCycles?.[0]?.label).toBe("第一片");
    persistenceFailure = null;
    fireEvent.click(screen.getByRole("button", { name: "保存镜片" }));
    await waitFor(() => expect(
      useTimelineItemStore.getState().items.find((item) => item.id === "item-reusable")
        ?.reusableLensCycles?.[0]?.label
    ).toBe("首片"));

    drawer = screen.getByLabelText("用品详情");
    fireEvent.click(within(drawer).getByRole("button", { name: "启用下一片" }));
    fireEvent.click(screen.getByRole("button", { name: "确认" }));
    await waitFor(() => expect(
      useTimelineItemStore.getState().items.find((item) => item.id === "item-reusable")
        ?.reusableLensCycles
    ).toHaveLength(2));

    drawer = screen.getByLabelText("用品详情");
    vi.stubGlobal("confirm", vi.fn(() => true));
    let nextCycle = within(drawer).getByText("镜片使用 · 镜片 2").closest("article")!;
    persistenceFailure = new Error("cycle delete locked");
    fireEvent.click(within(nextCycle).getByRole("button", { name: "删除" }));
    expect(await within(drawer).findByText("cycle delete locked")).toBeTruthy();
    expect(useTimelineItemStore.getState().items.find((item) => item.id === "item-reusable")
      ?.reusableLensCycles).toHaveLength(2);
    persistenceFailure = null;
    nextCycle = within(drawer).getByText("镜片使用 · 镜片 2").closest("article")!;
    fireEvent.click(within(nextCycle).getByRole("button", { name: "删除" }));
    await waitFor(() => expect(
      useTimelineItemStore.getState().items.find((item) => item.id === "item-reusable")
        ?.reusableLensCycles
    ).toHaveLength(1));
    expect(useInventoryStore.getState().transactions.at(-1)).toMatchObject({
      type: "reverse",
      reason: "删除误录的盒内镜片使用"
    });

    fireEvent.click(within(screen.getByLabelText("用品详情")).getByRole("button", { name: "关闭详情" }));

    drawer = openTemplate(4);
    fireEvent.click(within(drawer).getByRole("button", { name: "更换／结束使用" }));
    fireEvent.click(screen.getByRole("button", { name: "确认结束使用" }));
    await waitFor(() => expect(useTimelineItemStore.getState().items.find((item) => item.id === "item-accessory")?.status).toBe("completed"));
    fireEvent.click(within(screen.getByLabelText("用品详情")).getByRole("button", { name: "关闭详情" }));

    for (const [index, id] of [[5, "opened"], [7, "batch"]] as const) {
      drawer = openTemplate(index);
      fireEvent.click(within(drawer).getByRole("button", { name: "暂停使用" }));
      fireEvent.change(screen.getByLabelText("暂停日期"), { target: { value: "2026-09-04" } });
      fireEvent.click(screen.getByRole("button", { name: "确认" }));
      await waitFor(() => expect(useTimelineItemStore.getState().items.find((item) => item.id === `item-${id}`)?.status).toBe("paused"));

      drawer = screen.getByLabelText("用品详情");
      fireEvent.click(within(drawer).getByRole("button", { name: "恢复使用" }));
      fireEvent.click(screen.getByRole("button", { name: "确认" }));
      await waitFor(() => expect(useTimelineItemStore.getState().items.find((item) => item.id === `item-${id}`)?.status).toBe("active"));
      fireEvent.click(within(screen.getByLabelText("用品详情")).getByRole("button", { name: "关闭详情" }));
    }

    for (const index of [1, 2, 3, 5]) {
      const [, , managementTemplate, , name] = templates[index]!;
      const previousCount = useTimelineItemStore.getState().items.length;
      fireEvent.click(screen.getByRole("button", { name: `向${name}添加记录` }));
      const addForm = screen.getByRole("heading", { name: `向“${name}”添加记录` }).closest("form")!;
      if (managementTemplate === "lens_case") {
        fireEvent.click(within(addForm).getByLabelText("左眼"));
      }
      fireEvent.submit(addForm);
      await waitFor(() => expect(useTimelineItemStore.getState().items).toHaveLength(previousCount + 1));
    }

  }, 50_000);

  it("validates reusable-lens history edits", async () => {
    setPersistenceCommandAdapterForTests(async <T,>(command: string): Promise<T> => {
      if (command === "commit_app_data_mutation") return undefined as T;
      throw new Error(`Unexpected command ${command}`);
    });
    useItemProfileStore.setState({ profiles: [{
      id: "profile-reusable", groupId: "lenses", managementTemplate: "soft_reusable",
      standardType: "soft_reusable", name: "复用软镜（L）", baseUnit: "片",
      side: "L", defaultDurationDays: 30, active: true, order: 0
    }] });
    useInventoryStore.setState({
      products: [{
        id: "product-reusable", itemProfileId: "profile-reusable",
        standardType: "soft_reusable", brand: "测试复用镜", baseUnit: "片",
        unitsPerPackage: 6, defaultDurationDays: 30, active: true
      }],
      locations: [{ id: "home", name: "家", active: true, order: 0 }],
      lots: [{
        id: "lot-reusable", productId: "product-reusable", internalLotCode: "REUSE-1",
        receivedDate: "2026-08-01", locationId: "home", initialUnitQuantity: 6,
        initialPackageQuantity: 1, initialLooseUnitQuantity: 0,
        unitsPerPackageAtReceipt: 6, unitPriceMinor: 6000, currency: "CNY"
      }],
      transactions: [{
        id: "stock-reusable", stockLotId: "lot-reusable", occurredDate: "2026-08-01",
        type: "stock_in", quantityDelta: 6, locationId: "home"
      }, {
        id: "activate-cycle-1", stockLotId: "lot-reusable", occurredDate: "2026-08-01",
        type: "activate", quantityDelta: -1, relatedInstanceId: "item-reusable",
        relatedCycleId: "cycle-1", locationId: "home"
      }, {
        id: "activate-cycle-2", stockLotId: "lot-reusable", occurredDate: "2026-08-10",
        type: "activate", quantityDelta: -1, relatedInstanceId: "item-reusable",
        relatedCycleId: "cycle-2", locationId: "home"
      }]
    });
    useTimelineItemStore.setState({ items: [{
      id: "item-reusable", categoryId: "profile-reusable", groupId: "lenses",
      categoryName: "复用软镜（L）", productId: "product-reusable",
      sourceStockLotId: "lot-reusable", label: "复用软镜盒", detail: "",
      location: "家", locationId: "home",
      locationIntervals: [{ locationId: "home", startDate: "2026-08-01", endDate: null }],
      eyeSides: ["L"],
      eyeAssignmentIntervals: [{ eyeSides: ["L"], startDate: "2026-08-01", endDate: null }],
      startDate: "2026-08-01", endDate: null, predictionDate: "2026-09-08",
      status: "active", stateIntervals: [{ startDate: "2026-08-01", endDate: null, status: "active" }],
      reusableLensCycles: [{
        id: "cycle-1", label: "第一片", startDate: "2026-08-01",
        endDate: "2026-08-10", predictionDate: "2026-08-30", status: "completed"
      }, {
        id: "cycle-2", label: "第二片", startDate: "2026-08-10",
        endDate: null, predictionDate: "2026-09-08", status: "active"
      }]
    }] });
    useTimelineCareEventStore.setState({ events: [] });
    useUsageFactStore.setState({ facts: [] });

    const { container } = render(<TimelinePage />);
    fireEvent.click(container.querySelector('g[role="button"]')!);
    const drawer = screen.getByLabelText("用品详情");
    const firstCycle = within(drawer).getByText("镜片使用 · 第一片").closest("article")!;
    fireEvent.click(within(firstCycle).getByRole("button", { name: "编辑" }));
    const form = screen.getByRole("heading", { name: "编辑镜片信息" }).closest("form")!;
    const label = within(form).getByLabelText("镜片名称");
    const startDate = within(form).getByLabelText("启用日期");
    const predictionDate = within(form).getByLabelText("预计更换日期");
    const endDate = within(form).getByLabelText("实际结束日期");

    fireEvent.change(label, { target: { value: "" } });
    fireEvent.submit(form);
    expect(within(form).getByText("请填写完整的镜片信息")).toBeTruthy();

    fireEvent.change(label, { target: { value: "第一片" } });
    fireEvent.change(startDate, { target: { value: "2026-09-07" } });
    fireEvent.submit(form);
    expect(within(form).getByText("启用日期不能晚于今天")).toBeTruthy();

    fireEvent.change(startDate, { target: { value: "2026-08-01" } });
    fireEvent.change(predictionDate, { target: { value: "2026-07-31" } });
    fireEvent.submit(form);
    expect(within(form).getByText("预计更换日期不能早于启用日期")).toBeTruthy();

    fireEvent.change(predictionDate, { target: { value: "2026-08-30" } });
    fireEvent.change(endDate, { target: { value: "" } });
    fireEvent.submit(form);
    expect(within(form).getByText("已结束镜片必须填写结束日期")).toBeTruthy();

    fireEvent.change(endDate, { target: { value: "2026-07-31" } });
    fireEvent.submit(form);
    expect(within(form).getByText("结束日期不能早于启用日期")).toBeTruthy();

    fireEvent.change(endDate, { target: { value: "2026-08-11" } });
    fireEvent.submit(form);
    expect(within(form).getByText("结束日期不能晚于下一片启用日期")).toBeTruthy();

    fireEvent.click(within(form).getByRole("button", { name: "取消" }));
    const reopenedCycle = within(screen.getByLabelText("用品详情"))
      .getByText("镜片使用 · 第一片").closest("article")!;
    fireEvent.click(within(reopenedCycle).getByRole("button", { name: "编辑" }));
    const reopenedForm = screen.getByRole("heading", { name: "编辑镜片信息" })
      .closest("form")!;
    fireEvent.change(within(reopenedForm).getByLabelText("启用日期"), {
      target: { value: "2026-08-02" }
    });
    fireEvent.change(within(reopenedForm).getByLabelText("实际结束日期"), {
      target: { value: "2026-08-08" }
    });
    fireEvent.submit(reopenedForm);
    await waitFor(() => expect(useTimelineItemStore.getState().items[0]?.startDate)
      .toBe("2026-08-02"));
    expect(useTimelineItemStore.getState().items[0]?.stateIntervals?.[0]?.startDate)
      .toBe("2026-08-02");
    expect(useTimelineItemStore.getState().items[0]?.locationIntervals?.[0]?.startDate)
      .toBe("2026-08-02");
    expect(useTimelineItemStore.getState().items[0]?.eyeAssignmentIntervals?.[0]?.startDate)
      .toBe("2026-08-02");
  });

  it("creates and manages configurable profile rows", async () => {
    useItemProfileStore.setState({ profiles: [{
      id: "left", groupId: "lenses", managementTemplate: "rigid_long_term",
      standardType: "scleral", standardTypeName: "巩膜镜", name: "左侧配置",
      baseUnit: "片", side: "L", active: true, order: 0
    }, {
      id: "right", groupId: "lenses", managementTemplate: "rigid_long_term",
      standardType: "rgp", standardTypeName: "RGP", name: "右侧配置",
      baseUnit: "片", side: "R", active: true, order: 1
    }] });
    useInventoryStore.setState({ products: [], locations: [], lots: [], transactions: [] });
    useTimelineItemStore.setState({ items: [] });
    setPersistenceCommandAdapterForTests(async <T,>(command: string, args?: Record<string, unknown>): Promise<T> => {
      if (command === "create_profile" || command === "update_profile")
        return structuredClone(args?.profile) as T;
      if (command === "reorder_profiles" || command === "delete_profile") return undefined as T;
      throw new Error(`Unexpected command ${command}`);
    });
    const onClose = vi.fn();
    render(<ManageItemsDialog onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "关闭管理用品" }));
    expect(onClose).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole("button", { name: "新建配置" }));
    fireEvent.change(screen.getByLabelText("管理模板"), { target: { value: "soft_reusable" } });
    fireEvent.change(screen.getByLabelText("标准类型"), { target: { value: "custom" } });
    fireEvent.change(screen.getByLabelText("自定义标准类型名称"), { target: { value: "测试软镜" } });
    fireEvent.change(screen.getByLabelText("眼别"), { target: { value: "R" } });
    fireEvent.change(screen.getByLabelText("基础单位"), { target: { value: "枚" } });
    fireEvent.change(screen.getByLabelText("默认周期（天）"), { target: { value: "21" } });
    fireEvent.change(screen.getByLabelText("显示名称"), { target: { value: "自定义右镜" } });
    fireEvent.click(screen.getByRole("button", { name: "创建配置行" }));
    expect(await screen.findByText("自定义右镜")).toBeTruthy();

    let row = screen.getByText("自定义右镜").closest("article")!;
    fireEvent.click(within(row).getByRole("button", { name: "编辑" }));
    expect((screen.getByLabelText("标准类型") as HTMLSelectElement).disabled).toBe(false);
    fireEvent.change(screen.getByLabelText("显示名称"), { target: { value: "已编辑右镜" } });
    fireEvent.click(screen.getByRole("button", { name: "保存配置" }));
    expect(await screen.findByText("已编辑右镜")).toBeTruthy();

    row = screen.getByText("已编辑右镜").closest("article")!;
    fireEvent.click(within(row).getByRole("button", { name: "停用" }));
    await waitFor(() => expect(within(row).getByText("已停用")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "上移已编辑右镜" }));
    await waitFor(() => expect(
      useItemProfileStore.getState().profiles.find((profile) => profile.name === "已编辑右镜")?.order
    ).toBe(1));
    row = screen.getByText("已编辑右镜").closest("article")!;
    fireEvent.click(within(row).getByRole("button", { name: "删除" }));
    await waitFor(() => expect(screen.queryByText("已编辑右镜")).toBeNull());

    fireEvent.click(screen.getByRole("button", { name: /周期更换用品/ }));
    expect(screen.getByText("周期更换用品配置")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /消耗品/ }));
    expect(screen.getByText("消耗品配置")).toBeTruthy();
  });

  it("protects related profile fields and reports configuration action failures", async () => {
    useItemProfileStore.setState({ profiles: [{
      id: "linked", groupId: "lenses", managementTemplate: "rigid_long_term",
      standardType: "scleral", name: "关联配置", baseUnit: "片", side: "L",
      active: true, order: 0
    }] });
    useInventoryStore.setState({
      products: [{
        id: "linked-product", itemProfileId: "linked", standardType: "scleral",
        brand: "品牌", baseUnit: "片", unitsPerPackage: 1, active: true
      }],
      locations: [], lots: [], transactions: []
    });
    useTimelineItemStore.setState({ items: [] });
    setPersistenceCommandAdapterForTests(async <T,>() => Promise.reject("non-error failure") as Promise<T>);

    render(<ManageItemsDialog onClose={vi.fn()} />);
    const linkedRow = screen.getByText("关联配置").closest("article")!;
    const deleteButton = within(linkedRow).getByRole("button", { name: "删除" });
    expect(deleteButton.hasAttribute("disabled")).toBe(true);
    expect(deleteButton.getAttribute("title")).toBe("已有产品或时间轴记录，不能删除");

    fireEvent.click(within(linkedRow).getByRole("button", { name: "编辑" }));
    expect((screen.getByLabelText("管理模板") as HTMLSelectElement).disabled).toBe(true);
    expect((screen.getByLabelText("标准类型") as HTMLSelectElement).disabled).toBe(true);
    expect((screen.getByLabelText("眼别") as HTMLSelectElement).disabled).toBe(true);
    fireEvent.submit(screen.getByRole("button", { name: "保存配置" }).closest("form")!);
    expect((await screen.findByRole("alert")).textContent).toContain("保存用品配置失败");
    fireEvent.click(screen.getByRole("button", { name: "取消" }));

    fireEvent.click(within(linkedRow).getByRole("button", { name: "停用" }));
    expect((await screen.findByRole("alert")).textContent).toContain("更新用品配置失败");

    fireEvent.click(screen.getByRole("button", { name: /周期更换用品/ }));
    fireEvent.click(screen.getByRole("button", { name: "新建配置" }));
    expect(screen.getByRole("button", { name: "创建配置行" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "新建配置" }));
    expect(screen.queryByRole("button", { name: "创建配置行" })).toBeNull();
  });
});
