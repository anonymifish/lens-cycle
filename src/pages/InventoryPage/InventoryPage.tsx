import { useState, type FormEvent } from "react";
import {
  displayCompactLocalDate,
  todayLocalDate
} from "../../shared/dates/localDate";
import { Icon } from "../../shared/components/Icon";
import { EmptyState } from "../../shared/components/EmptyState";
import { LocalDateInput } from "../../shared/components/LocalDateInput";
import {
  groupLabels,
  itemProfileBaseUnit,
  standardTypeLabels
} from "../../features/catalog/catalog";
import type { ItemProfile } from "../../features/catalog/catalog.types";
import {
  allocatedDailyRemainingUnits,
  allocatedLooseUnitQuantity,
  availableLooseUnitQuantity,
  availableReusableLooseUnitQuantity,
  availableUnits,
  availableUnitsAtLocation,
  effectiveInventoryTransactions,
  formatMoney,
  formatUnitPrice,
  lotInitialLooseUnitQuantity,
  lotInitialPackageQuantity,
  lotHasUsageRecords,
  lotUnitsPerPackage,
  lotLocationBalances,
  nextInternalLotCode,
  openedPackageCount,
  productAvailableUnits,
  productInventoryValueMinor,
  sortProductsByProfileOrder,
  unopenedPackageCount,
  yuanTextToMinor
} from "../../features/inventory/inventory";
import type { Product } from "../../features/inventory/inventory.types";
import { createProduct, deleteProduct, moveProduct, updateProduct } from "../../features/inventory/productRepository";
import {
  receiveStock,
  transferStock,
  updateStockLot,
  voidUnusedStockLot
} from "../../features/inventory/stockRepository";
import type { TimelineGroupId } from "../../features/timeline/timeline.types";
import { useInventoryStore } from "../../stores/inventoryStore";
import { useItemProfileStore } from "../../stores/itemProfileStore";
import { useTimelineItemStore } from "../../stores/timelineItemStore";
import { useUsageFactStore } from "../../stores/usageFactStore";
import styles from "./InventoryPage.module.css";

type Dialog = "product" | "editProduct" | "editLot" | "transfer" | "stock" | null;
type PendingDelete =
  | { type: "product"; productId: string }
  | { type: "lot"; productId: string; lotId: string }
  | null;
const productGroups: TimelineGroupId[] = ["lenses", "periodic", "consumables"];

function usesDefaultDuration(profile?: ItemProfile) {
  return (
    profile?.managementTemplate === "rigid_long_term" ||
    profile?.managementTemplate === "soft_reusable" ||
    profile?.managementTemplate === "lens_case" ||
    profile?.managementTemplate === "lens_accessory" ||
    profile?.managementTemplate === "opened_container"
  );
}

function usesPackagedLensInventory(profile?: ItemProfile) {
  return (
    profile?.managementTemplate === "soft_daily" ||
    profile?.managementTemplate === "soft_reusable"
  );
}

function durationLabel(profile?: ItemProfile) {
  if (profile?.managementTemplate === "rigid_long_term") {
    return "预计使用时长（天）";
  }
  if (profile?.managementTemplate === "opened_container") {
    return "开封后有效期（天）";
  }
  if (profile?.managementTemplate === "soft_reusable") {
    return "产品使用周期（天）";
  }
  return "默认更换周期（天）";
}

function specificationLabel(profile?: ItemProfile) {
  if (
    profile?.managementTemplate === "rigid_long_term" ||
    profile?.managementTemplate === "soft_daily" ||
    profile?.managementTemplate === "soft_reusable"
  ) {
    return "镜片规格（选填）";
  }
  return "产品规格（选填）";
}

function showsProductSpecification(profile?: ItemProfile) {
  return (
    profile?.managementTemplate !== "opened_container" &&
    profile?.managementTemplate !== "batch_consumable" &&
    profile?.managementTemplate !== "discrete_dose"
  );
}

export function InventoryPage({
  onNavigateToTimeline
}: {
  onNavigateToTimeline?: () => void;
}) {
  const products = useInventoryStore((state) => state.products);
  const allLots = useInventoryStore((state) => state.lots);
  const lots = allLots.filter((lot) => !lot.voidedAt);
  const transactions = useInventoryStore((state) => state.transactions);
  const locations = useInventoryStore((state) => state.locations);
  const profiles = useItemProfileStore((state) => state.profiles);
  const timelineItems = useTimelineItemStore((state) => state.items);
  const usageFacts = useUsageFactStore((state) => state.facts);
  const orderedProducts = sortProductsByProfileOrder(products, profiles);

  const [dialog, setDialog] = useState<Dialog>(null);
  const [selectedProductId, setSelectedProductId] = useState(
    orderedProducts[0]?.id ?? ""
  );
  const [stockReceivedDate, setStockReceivedDate] = useState(todayLocalDate);
  const [stockInternalLotCode, setStockInternalLotCode] = useState(() =>
    orderedProducts[0]
      ? nextInternalLotCode(orderedProducts[0].id, todayLocalDate(), allLots)
      : ""
  );
  const firstAvailableProfile = profiles
    .filter((profile) => profile.active)
    .sort((a, b) => a.order - b.order)[0];
  const [productGroupId, setProductGroupId] = useState<TimelineGroupId>(
    firstAvailableProfile?.groupId ?? "lenses"
  );
  const [productProfileId, setProductProfileId] = useState(
    firstAvailableProfile?.id ?? ""
  );
  const [expandedProductId, setExpandedProductId] = useState<string | null>(
    null
  );
  const [editingLotId, setEditingLotId] = useState("");
  const [transferFromLocationId, setTransferFromLocationId] = useState("");
  const [lotEditError, setLotEditError] = useState<string | null>(null);
  const [stockError, setStockError] = useState<string | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<PendingDelete>(null);
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const selectedProduct =
    products.find((product) => product.id === selectedProductId) ??
    orderedProducts[0];
  const selectedProductProfile = selectedProduct
    ? profiles.find((profile) => profile.id === selectedProduct.itemProfileId)
    : undefined;
  const editingLot = lots.find((lot) => lot.id === editingLotId);
  const pendingDeleteProduct = pendingDelete
    ? products.find((product) => product.id === pendingDelete.productId)
    : undefined;
  const pendingDeleteLot =
    pendingDelete?.type === "lot"
      ? lots.find((lot) => lot.id === pendingDelete.lotId)
      : undefined;

  const availableProfiles = profiles
    .filter((profile) => profile.active)
    .sort((a, b) =>
      a.groupId === b.groupId
        ? a.order - b.order
        : productGroups.indexOf(a.groupId) - productGroups.indexOf(b.groupId)
    );
  const productProfiles = availableProfiles.filter(
    (profile) => profile.groupId === productGroupId
  );
  const selectedNewProductProfile =
    productProfiles.find((profile) => profile.id === productProfileId) ??
    productProfiles[0];
  const totalValueMinor = products.reduce(
    (total, product) =>
      total + productInventoryValueMinor(product.id, lots, transactions),
    0
  );
  const lowStockProducts = products.filter(
    (product) => productAvailableUnits(product.id, lots, transactions) <= 1
  ).length;

  function transferableQuantity(lotId: string, locationId: string) {
    const lot = lots.find((entry) => entry.id === lotId);
    if (!lot) return 0;
    const reserved = timelineItems
      .filter(
        (item) =>
          item.sourceStockLotId === lotId &&
          item.locationId === locationId &&
          item.status !== "completed"
      )
      .reduce((total, item) => {
        const profile = profiles.find((entry) => entry.id === item.categoryId);
        const facts = usageFacts.filter((fact) => fact.itemId === item.id);
        if (profile?.managementTemplate === "soft_daily") {
          return (
            total +
            Math.max(
              0,
              (item.initialUnitQuantity ?? 0) -
                facts.reduce((sum, fact) => sum + fact.quantity, 0)
            )
          );
        }
        if (profile?.managementTemplate === "soft_reusable") {
          const used =
            (item.reusableLensCycles?.length ?? 1) +
            facts
              .filter((fact) => fact.kind === "extra_loss")
              .reduce((sum, fact) => sum + fact.quantity, 0);
          return total + Math.max(0, (item.initialUnitQuantity ?? 1) - used);
        }
        return total;
      }, 0);
    return Math.max(
      0,
      availableUnitsAtLocation(lot, locationId, transactions) - reserved
    );
  }

  function productDeleteBlockedReason(productId: string) {
    const lotCount = allLots.filter((lot) => lot.productId === productId).length;
    const instanceCount = timelineItems.filter(
      (item) => item.productId === productId
    ).length;
    const reasons = [
      lotCount > 0 ? `包含 ${lotCount} 个库存批次` : "",
      instanceCount > 0 ? `关联 ${instanceCount} 条时间轴记录` : ""
    ].filter(Boolean);
    return reasons.length > 0 ? `${reasons.join("，")}，不能删除` : null;
  }

  function lotDeleteBlockedReason(lotId: string) {
    const instanceCount = timelineItems.filter(
      (item) => item.sourceStockLotId === lotId
    ).length;
    if (instanceCount > 0) {
      return `关联 ${instanceCount} 条时间轴记录，不能作废`;
    }
    if (lotHasUsageRecords(lotId, transactions)) {
      return "批次已有启用、消耗或损耗记录，不能作废";
    }
    return null;
  }

  function openDialog(nextDialog: Exclude<Dialog, null>, product?: Product) {
    const targetProductId = product?.id ?? selectedProduct?.id;
    if (product) setSelectedProductId(product.id);
    if (nextDialog === "stock" && targetProductId) {
      const receivedDate = todayLocalDate();
      setStockReceivedDate(receivedDate);
      setStockInternalLotCode(
        nextInternalLotCode(targetProductId, receivedDate, allLots)
      );
    }
    if (nextDialog === "product") {
      const firstProfile = availableProfiles[0];
      if (firstProfile) {
        setProductGroupId(firstProfile.groupId);
        setProductProfileId(firstProfile.id);
      }
    }
    setDialog(nextDialog);
    setNotice(null);
    setStockError(null);
    setDialogError(null);
  }

  async function handleCreateProduct(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    const formData = new FormData(event.currentTarget);
    const itemProfileId = String(formData.get("itemProfileId"));
    const profile = profiles.find(
      (item) => item.id === itemProfileId && item.active
    );
    if (!profile) {
      setNotice("请选择一个当前已启用的用品配置标准类型");
      return;
    }
    const model = String(formData.get("model") || "");
    const specification = String(formData.get("specification") || "");
    const capacityMl = Number(formData.get("capacityMl") || 0);
    const durationValue = formData.get("durationDays");
    setSubmitting(true);
    setDialogError(null);
    try {
      const productId = await createProduct({
        itemProfileId: profile.id,
        standardType: profile.standardType,
        brand: String(formData.get("brand")),
        ...(model ? { model } : {}),
        ...(specification ? { specification } : {}),
        ...(profile.managementTemplate === "opened_container" && capacityMl > 0
          ? { capacityMl }
          : {}),
        baseUnit: itemProfileBaseUnit(profile),
        unitsPerPackage:
          usesPackagedLensInventory(profile)
            ? Math.max(1, Number(formData.get("unitsPerPackage")))
            : 1,
        ...(durationValue
          ? {
              defaultDurationDays: Math.max(1, Number(durationValue))
            }
          : {})
      });
      setSelectedProductId(productId);
      const receivedDate = todayLocalDate();
      setStockReceivedDate(receivedDate);
      setStockInternalLotCode(
        nextInternalLotCode(productId, receivedDate, allLots)
      );
      setDialog("stock");
      setNotice("产品已创建，请继续录入首批库存");
    } catch (error) {
      setDialogError(error instanceof Error ? error.message : "产品创建失败");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleReceiveStock(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedProduct || submitting) return;
    const formData = new FormData(event.currentTarget);
    const durationValue = formData.get("durationDays");
    const internalLotCode = String(formData.get("internalLotCode")).trim();
    if (
      allLots.some(
        (lot) =>
          lot.productId === selectedProduct.id &&
          lot.internalLotCode === internalLotCode
      )
    ) {
      setStockError("同一产品的系统批号不能重复");
      return;
    }
    const lotNumber = String(formData.get("lotNumber") || "");
    const manufacturedDate = String(formData.get("manufacturedDate") || "");
    const expiryDate = String(formData.get("expiryDate") || "");
    const isRigid =
      selectedProductProfile?.managementTemplate === "rigid_long_term";
    if (
      manufacturedDate &&
      !isRigid &&
      expiryDate &&
      expiryDate < manufacturedDate
    ) {
      setStockError("预计到期日期不能早于生产日期");
      return;
    }
    const isPackagedLens = usesPackagedLensInventory(selectedProductProfile);
    const unitsPerPackage = isPackagedLens
      ? Math.max(1, Number(formData.get("unitsPerPackage")))
      : selectedProduct.unitsPerPackage;
    const quantity = isPackagedLens
      ? Math.max(0, Number(formData.get("packageQuantity"))) * unitsPerPackage +
        Math.max(0, Number(formData.get("looseQuantity") || 0))
      : Math.max(1, Number(formData.get("quantity")));
    if (quantity < 1) {
      setStockError("本次入库数量必须至少为一个基础单位");
      return;
    }
    const receivedProduct: Product = {
      ...selectedProduct,
      ...(durationValue
        ? { defaultDurationDays: Math.max(1, Number(durationValue)) }
        : {}),
      ...(isPackagedLens ? { unitsPerPackage } : {})
    };
    setSubmitting(true);
    setStockError(null);
    try {
      await receiveStock({
      productId: selectedProduct.id,
      internalLotCode,
      ...(lotNumber ? { lotNumber } : {}),
      ...(manufacturedDate
        ? { manufacturedDate: manufacturedDate as `${number}-${number}-${number}` }
        : {}),
      ...(expiryDate
        ? { expiryDate: expiryDate as `${number}-${number}-${number}` }
        : {}),
      ...(isRigid && durationValue
        ? { expectedUsageDays: Math.max(1, Number(durationValue)) }
        : {}),
      receivedDate: String(formData.get("receivedDate")) as `${number}-${number}-${number}`,
      locationId: String(formData.get("locationId")),
      quantity,
      ...(isPackagedLens
        ? {
            packageQuantity: Math.max(
              0,
              Number(formData.get("packageQuantity"))
            ),
            looseUnitQuantity: Math.max(
              0,
              Number(formData.get("looseQuantity") || 0)
            ),
            unitsPerPackageAtReceipt: unitsPerPackage
          }
        : {}),
      unitPriceMinor: yuanTextToMinor(String(formData.get("unitPrice")))
      }, receivedProduct);
      setDialog(null);
      setStockError(null);
      setNotice(`${selectedProduct.brand} 已完成入库`);
    } catch (error) {
      setStockError(error instanceof Error ? error.message : "入库失败");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleEditProduct(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedProduct || submitting) return;
    const formData = new FormData(event.currentTarget);
    const model = String(formData.get("model") || "");
    const specification = String(formData.get("specification") || "");
    const capacityMl = Number(formData.get("capacityMl") || 0);
    const durationValue = formData.get("durationDays");
    setSubmitting(true);
    setDialogError(null);
    try {
      await updateProduct(selectedProduct.id, {
      brand: String(formData.get("brand")),
      ...(model ? { model } : {}),
      ...(specification ? { specification } : {}),
      ...(selectedProductProfile?.managementTemplate === "opened_container" &&
      capacityMl > 0
        ? { capacityMl }
        : {}),
      unitsPerPackage:
        usesPackagedLensInventory(selectedProductProfile)
          ? Math.max(1, Number(formData.get("unitsPerPackage")))
          : selectedProduct.unitsPerPackage,
      ...(durationValue
        ? { defaultDurationDays: Math.max(1, Number(durationValue)) }
        : {})
      });
      setDialog(null);
      setNotice("产品资料已更新");
    } catch (error) {
      setDialogError(error instanceof Error ? error.message : "产品更新失败");
    } finally {
      setSubmitting(false);
    }
  }

  function openLotEditor(lotId: string, product: Product) {
    setSelectedProductId(product.id);
    setEditingLotId(lotId);
    setLotEditError(null);
    setDialog("editLot");
    setNotice(null);
  }

  function openTransfer(lotId: string, product: Product) {
    const lot = lots.find((entry) => entry.id === lotId);
    const firstSource = lot
      ? lotLocationBalances(
          lot,
          locations.map((location) => location.id),
          transactions
        ).find((entry) => transferableQuantity(lotId, entry.locationId) > 0)
      : undefined;
    setSelectedProductId(product.id);
    setEditingLotId(lotId);
    setTransferFromLocationId(firstSource?.locationId ?? "");
    setStockError(null);
    setDialog("transfer");
  }

  async function handleTransfer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingLot || submitting) return;
    const formData = new FormData(event.currentTarget);
    setSubmitting(true);
    setStockError(null);
    try {
      const fromLocationId = String(formData.get("fromLocationId"));
      const quantity = Number(formData.get("quantity"));
      if (transferableQuantity(editingLot.id, fromLocationId) < quantity) {
        throw new Error("来源地点的普通可转移库存不足；已分配给实例的数量需随实例移动");
      }
      await transferStock({
        stockLotId: editingLot.id,
        fromLocationId,
        toLocationId: String(formData.get("toLocationId")),
        quantity,
        occurredDate: String(formData.get("occurredDate")) as `${number}-${number}-${number}`,
        ...(String(formData.get("reason") || "").trim()
          ? { reason: String(formData.get("reason")) }
          : {})
      });
      setDialog(null);
      setNotice("库存地点已更新");
    } catch (error) {
      setStockError(error instanceof Error ? error.message : "库存转移失败");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleEditLot(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingLot || !selectedProduct || submitting) return;
    const formData = new FormData(event.currentTarget);
    const isPackagedLens = usesPackagedLensInventory(selectedProductProfile);
    const isDaily = selectedProductProfile?.managementTemplate === "soft_daily";
    const unitsPerPackageAtReceipt = isPackagedLens
      ? Math.max(1, Number(formData.get("unitsPerPackageAtReceipt")))
      : selectedProduct.unitsPerPackage;
    const packageQuantity = isPackagedLens
      ? Math.max(0, Number(formData.get("packageQuantity")))
      : 0;
    const looseUnitQuantity = isPackagedLens
      ? Math.max(0, Number(formData.get("looseUnitQuantity") || 0))
      : 0;
    const quantity = isPackagedLens
      ? packageQuantity * unitsPerPackageAtReceipt + looseUnitQuantity
      : Math.max(0, Number(formData.get("quantity")));
    const effectiveLotTransactions = effectiveInventoryTransactions(
      transactions
    ).filter((transaction) => transaction.stockLotId === editingLot.id);
    const stockIn = effectiveLotTransactions.find(
      (transaction) => transaction.type === "stock_in"
    );
    const otherQuantity = effectiveLotTransactions
      .filter((transaction) => transaction.id !== stockIn?.id)
      .reduce(
        (total, transaction) => total + transaction.quantityDelta,
        0
      );
    const minimumQuantity = Math.max(0, -otherQuantity);
    const alreadyOpenedPackages = isPackagedLens
      ? openedPackageCount(editingLot, transactions, timelineItems)
      : 0;
    if (isPackagedLens && packageQuantity < alreadyOpenedPackages) {
      setLotEditError(
        `该批次已经启用 ${alreadyOpenedPackages} 盒，入库盒数不能低于这个数`
      );
      return;
    }
    const alreadyAllocatedLooseUnits = isDaily
      ? allocatedLooseUnitQuantity(
          editingLot,
          transactions,
          timelineItems
        )
      : 0;
    if (isDaily && looseUnitQuantity < alreadyAllocatedLooseUnits) {
      setLotEditError(
        `该批次已经分配 ${alreadyAllocatedLooseUnits} ${selectedProduct.baseUnit}散片，入库散片数不能低于这个数`
      );
      return;
    }
    if (
      isPackagedLens &&
      effectiveLotTransactions.some(
        (transaction) => transaction.type === "package_open"
      ) &&
      unitsPerPackageAtReceipt !==
        lotUnitsPerPackage(editingLot, selectedProduct)
    ) {
      setLotEditError("该批次已有开盒记录，不能再修改本批每盒片数");
      return;
    }
    if (quantity < minimumQuantity) {
      setLotEditError(
        `该批次已经使用或损耗 ${minimumQuantity} ${selectedProduct.baseUnit}，入库数量不能低于这个数`
      );
      return;
    }
    const lotNumber = String(formData.get("lotNumber") || "");
    const internalLotCode = String(formData.get("internalLotCode")).trim();
    if (
      allLots.some(
        (lot) =>
          lot.id !== editingLot.id &&
          lot.productId === editingLot.productId &&
          lot.internalLotCode === internalLotCode
      )
    ) {
      setLotEditError("同一产品的系统批号不能重复");
      return;
    }
    const manufacturedDate = String(formData.get("manufacturedDate") || "");
    const expiryDate = String(formData.get("expiryDate") || "");
    const isRigid =
      selectedProductProfile?.managementTemplate === "rigid_long_term";
    const expectedUsageDays = Number(formData.get("expectedUsageDays") || 0);
    if (
      manufacturedDate &&
      !isRigid &&
      expiryDate &&
      expiryDate < manufacturedDate
    ) {
      setLotEditError("预计到期日期不能早于生产日期");
      return;
    }
    setSubmitting(true);
    setLotEditError(null);
    try {
      await updateStockLot(editingLot.id, {
        internalLotCode,
        ...(lotNumber ? { lotNumber } : {}),
        ...(manufacturedDate
          ? { manufacturedDate: manufacturedDate as `${number}-${number}-${number}` }
          : {}),
        ...(expiryDate
          ? { expiryDate: expiryDate as `${number}-${number}-${number}` }
          : {}),
        ...(isRigid && expectedUsageDays
          ? { expectedUsageDays: Math.max(1, expectedUsageDays) }
          : {}),
        receivedDate: String(
          formData.get("receivedDate")
        ) as `${number}-${number}-${number}`,
        locationId: String(formData.get("locationId")),
        quantity,
        ...(isPackagedLens
          ? {
              packageQuantity,
              looseUnitQuantity,
              unitsPerPackageAtReceipt
            }
          : {}),
        unitPriceMinor: yuanTextToMinor(String(formData.get("unitPrice")))
      });
      setDialog(null);
      setEditingLotId("");
      setLotEditError(null);
      setNotice("批次信息已更新");
    } catch (error) {
      setLotEditError(error instanceof Error ? error.message : "批次更新失败");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleConfirmedDelete() {
    if (!pendingDelete || !pendingDeleteProduct || submitting) return;
    setSubmitting(true);
    setDeleteError(null);
    try {
      if (pendingDelete.type === "product") {
        await deleteProduct(pendingDelete.productId);
        setNotice(
          `${pendingDeleteProduct.brand}${pendingDeleteProduct.model ? ` · ${pendingDeleteProduct.model}` : ""} 已删除`
        );
      } else if (pendingDeleteLot) {
        await voidUnusedStockLot(pendingDeleteLot.id);
        setNotice(`批次 ${pendingDeleteLot.internalLotCode} 已作废，原始流水已保留`);
      }
      setPendingDelete(null);
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : "操作失败");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleMoveProduct(productId: string, direction: -1 | 1) {
    try {
      await moveProduct(productId, direction);
      setNotice(null);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "产品排序失败");
    }
  }

  return (
    <section className={styles.page}>
      <header className={styles.header}>
        <div>
          <span>LENS CYCLE</span>
          <h1>库存</h1>
        </div>
        <div className={styles.headerActions}>
          <button
            disabled={availableProfiles.length === 0}
            onClick={() => openDialog("product")}
            title={
              availableProfiles.length === 0
                ? "请先在时间轴的“管理”中创建并启用用品配置"
                : undefined
            }
            type="button"
          >
            <Icon name="plus" size={17} />
            新建产品
          </button>
          <button
            className={styles.primaryButton}
            disabled={products.length === 0}
            onClick={() => openDialog("stock")}
            type="button"
          >
            <Icon name="inventory" size={17} />
            入库
          </button>
        </div>
      </header>

      <div className={styles.metrics}>
        <article>
          <span>产品</span>
          <strong>{products.length}</strong>
        </article>
        <article>
          <span>库存批次</span>
          <strong>{lots.length}</strong>
        </article>
        <article>
          <span>当前库存价值</span>
          <strong>{formatMoney(totalValueMinor)}</strong>
        </article>
        <article className={lowStockProducts > 0 ? styles.lowStockMetric : undefined}>
          <span>低库存</span>
          <strong>{lowStockProducts}</strong>
        </article>
      </div>

      {notice && (
        <div className={styles.notice} role="status">
          <span>{notice}</span>
          <button onClick={() => setNotice(null)} type="button">
            关闭
          </button>
        </div>
      )}

      <div className={styles.inventoryCard}>
        <div className={styles.cardHeading}>
          <div>
            <h2>产品库存</h2>
            <p>顺序跟随时间轴用品配置</p>
          </div>
          <span>{products.length} 个产品</span>
        </div>

        {products.length > 0 && (
          <div className={styles.productTableHeader}>
            <span aria-hidden="true" />
            <span>产品</span>
            <span>可用库存</span>
            <span>使用中</span>
            <span>库存价值</span>
            <span>操作</span>
          </div>
        )}

        <div className={styles.productList}>
          {products.length === 0 && (
            <div className={styles.inventoryEmpty}>
              <EmptyState
                description={
                  availableProfiles.length === 0
                    ? "产品必须依附于时间轴中的用品配置。请先建立需要管理的用品行，再回来创建对应产品。"
                    : "用品配置已经准备好。创建产品后即可录入批次、价格、地点和库存数量。"
                }
                eyebrow={availableProfiles.length === 0 ? "第 1 步" : "第 2 步"}
                icon="inventory"
                primaryAction={
                  availableProfiles.length === 0
                    ? onNavigateToTimeline
                      ? {
                          label: "前往时间轴管理",
                          onClick: onNavigateToTimeline
                        }
                      : undefined
                    : {
                        label: "新建第一个产品",
                        onClick: () => openDialog("product")
                      }
                }
                steps={
                  availableProfiles.length === 0
                    ? ["建立用品配置", "创建关联产品", "录入首批库存"]
                    : ["填写产品资料", "录入首批库存", "从时间轴启用"]
                }
                title={
                  availableProfiles.length === 0
                    ? "先建立用品配置"
                    : "创建第一个库存产品"
                }
              />
            </div>
          )}
          {orderedProducts.map((product) => {
            const productProfile = profiles.find(
              (profile) => profile.id === product.itemProfileId
            );
            const isRigid = productProfile?.managementTemplate === "rigid_long_term";
            const isDaily = productProfile?.managementTemplate === "soft_daily";
            const isReusable = productProfile?.managementTemplate === "soft_reusable";
            const available = productAvailableUnits(product.id, lots, transactions);
            const value = productInventoryValueMinor(product.id, lots, transactions);
            const activeCount = timelineItems.filter(
              (item) => item.productId === product.id && item.status !== "completed"
            ).length;
            const productLots = lots.filter((lot) => lot.productId === product.id);
            const productHasAnyLots = allLots.some(
              (lot) => lot.productId === product.id
            );
            const productHasInstances = timelineItems.some(
              (item) => item.productId === product.id
            );
            const canDeleteProduct =
              !productHasAnyLots && !productHasInstances;
            const profileKey =
              product.itemProfileId;
            const siblingProducts = orderedProducts.filter(
              (entry) =>
                entry.itemProfileId === profileKey
            );
            const siblingIndex = siblingProducts.findIndex(
              (entry) => entry.id === product.id
            );
            return (
              <div
                className={`${styles.productEntry} ${
                  expandedProductId === product.id ? styles.productEntryExpanded : ""
                }`}
                key={product.id}
              >
                <article className={styles.productRow}>
                  <div className={styles.productIcon}>
                    <Icon name="inventory" size={19} />
                  </div>
                  <div className={styles.productName}>
                    <strong>
                      {product.brand}
                      {product.model ? ` · ${product.model}` : ""}
                    </strong>
                    <span>
                      {profiles.find((profile) => profile.id === product.itemProfileId)
                        ?.standardTypeName ?? standardTypeLabels[product.standardType]}
                      {product.capacityMl
                        ? ` · ${product.capacityMl} mL`
                        : product.specification &&
                            productProfile?.managementTemplate !== "batch_consumable" &&
                            productProfile?.managementTemplate !== "discrete_dose"
                          ? ` · ${product.specification}`
                          : ""}
                    </span>
                  </div>
                  <div
                    className={`${styles.quantity} ${
                      available <= 1 ? styles.quantityLow : ""
                    }`}
                  >
                    <strong>
                      {available} {product.baseUnit}
                    </strong>
                  </div>
                  <div className={styles.quantity}>
                    <strong>{activeCount} 个</strong>
                  </div>
                  <div className={styles.quantity}>
                    <strong>{formatMoney(value)}</strong>
                  </div>
                  <div className={styles.rowActions}>
                    <button
                      aria-label={`上移 ${product.brand}${product.model ? ` ${product.model}` : ""}`}
                      className={styles.orderButton}
                      disabled={siblingIndex <= 0}
                      onClick={() => void handleMoveProduct(product.id, -1)}
                      title="在当前用品配置中上移"
                      type="button"
                    >
                      ↑
                    </button>
                    <button
                      aria-label={`下移 ${product.brand}${product.model ? ` ${product.model}` : ""}`}
                      className={styles.orderButton}
                      disabled={siblingIndex >= siblingProducts.length - 1}
                      onClick={() => void handleMoveProduct(product.id, 1)}
                      title="在当前用品配置中下移"
                      type="button"
                    >
                      ↓
                    </button>
                    <button
                      aria-expanded={expandedProductId === product.id}
                      className={styles.batchToggle}
                      onClick={() =>
                        setExpandedProductId((current) =>
                          current === product.id ? null : product.id
                        )
                      }
                      type="button"
                    >
                      <span
                        className={
                          expandedProductId === product.id
                            ? styles.batchChevronExpanded
                            : styles.batchChevron
                        }
                      >
                        <Icon name="chevron" size={13} />
                      </span>
                      批次 {productLots.length}
                    </button>
                    <button
                      onClick={() => openDialog("stock", product)}
                      type="button"
                    >
                      入库
                    </button>
                    <button
                      onClick={() => openDialog("editProduct", product)}
                      type="button"
                    >
                      编辑
                    </button>
                    <span
                      className={styles.deleteButtonWrap}
                      title={productDeleteBlockedReason(product.id) ?? "删除产品"}
                    >
                      <button
                        disabled={!canDeleteProduct}
                        onClick={() => {
                          setPendingDelete({
                            type: "product",
                            productId: product.id
                          });
                          setDeleteError(null);
                        }}
                        type="button"
                      >
                        删除
                      </button>
                    </span>
                  </div>
                </article>
                {expandedProductId === product.id && (
                  <div className={styles.lotPanel}>
                    <div className={styles.lotHeader}>
                      <span>系统批号</span>
                      <span>生产批号</span>
                      <span>地点分布</span>
                      <span>入库日期</span>
                      <span>生产日期</span>
                      <span>{isRigid ? "预计使用时长" : "预计到期日期"}</span>
                      <span>剩余数量</span>
                      <span>单位价格</span>
                      <span>操作</span>
                    </div>
                    {productLots.length === 0 ? (
                      <p className={styles.lotEmpty}>该产品还没有入库批次。</p>
                    ) : (
                      [...productLots]
                        .sort((a, b) =>
                          (a.expiryDate ?? "9999-12-31").localeCompare(
                            b.expiryDate ?? "9999-12-31"
                          )
                        )
                        .map((lot) => (
                          <div className={styles.lotRow} key={lot.id}>
                            <strong>{lot.internalLotCode}</strong>
                            <span>{lot.lotNumber ?? "未填写"}</span>
                            <span>
                              {lotLocationBalances(
                                lot,
                                locations.map((location) => location.id),
                                transactions
                              )
                                .map((entry) => {
                                  const name = locations.find(
                                    (location) => location.id === entry.locationId
                                  )?.name;
                                  return `${name ?? "未知地点"} ${entry.quantity}`;
                                })
                                .join(" · ") || "无可用库存"}
                            </span>
                            <span>{displayCompactLocalDate(lot.receivedDate)}</span>
                            <span>{displayCompactLocalDate(lot.manufacturedDate)}</span>
                            <span>
                              {isRigid
                                ? lot.expectedUsageDays
                                  ? `${lot.expectedUsageDays} 天`
                                  : "未填写"
                                : displayCompactLocalDate(lot.expiryDate)}
                            </span>
                            <span>
                              {isDaily ? (
                                <>
                                  未开封 {unopenedPackageCount(
                                    lot,
                                    product,
                                    transactions,
                                    timelineItems
                                  )} 盒
                                  {" · "}散片 {availableLooseUnitQuantity(
                                    lot,
                                    product,
                                    transactions,
                                    timelineItems
                                  )} {product.baseUnit}
                                  {" · "}已启用剩余 {allocatedDailyRemainingUnits(
                                    lot,
                                    product,
                                    transactions,
                                    timelineItems
                                  )} {product.baseUnit}
                                  {" · "}合计 {availableUnits(
                                    lot.id,
                                    transactions
                                  )} {product.baseUnit}
                                </>
                              ) : isReusable ? (
                                <>
                                  未开封 {unopenedPackageCount(
                                    lot,
                                    product,
                                    transactions,
                                    timelineItems
                                  )} 盒
                                  {" · "}可用散片 {availableReusableLooseUnitQuantity(
                                    lot,
                                    product,
                                    transactions,
                                    timelineItems
                                  )} {product.baseUnit}
                                  {" · "}合计 {availableUnits(
                                    lot.id,
                                    transactions
                                  )} {product.baseUnit}
                                </>
                              ) : (
                                <>
                                  {availableUnits(lot.id, transactions)}{" "}
                                  {product.baseUnit}
                                </>
                              )}
                            </span>
                            <span>
                              {formatUnitPrice(lot.unitPriceMinor)} / {product.baseUnit}
                            </span>
                            <span className={styles.lotActions}>
                              <button
                                disabled={
                                  locations.reduce(
                                    (sum, location) =>
                                      sum +
                                      transferableQuantity(lot.id, location.id),
                                    0
                                  ) < 1
                                }
                                onClick={() => openTransfer(lot.id, product)}
                                type="button"
                              >
                                转移
                              </button>
                              <button
                                onClick={() => openLotEditor(lot.id, product)}
                                type="button"
                              >
                                编辑
                              </button>
                              <span
                                className={styles.deleteButtonWrap}
                                title={
                                  lotDeleteBlockedReason(lot.id) ??
                                  "作废没有使用记录的误录批次"
                                }
                              >
                                <button
                                  disabled={Boolean(lotDeleteBlockedReason(lot.id))}
                                  onClick={() => {
                                    setPendingDelete({
                                      type: "lot",
                                      productId: product.id,
                                      lotId: lot.id
                                    });
                                    setDeleteError(null);
                                  }}
                                  type="button"
                                >
                                  作废
                                </button>
                              </span>
                            </span>
                          </div>
                        ))
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {dialog && (
        <div className={styles.backdrop}>
          {dialog === "product" ? (
            <form className={styles.modal} onSubmit={handleCreateProduct}>
              <ModalHeading onClose={() => setDialog(null)} title="新建产品" />
              {dialogError && <div className={styles.formError}>{dialogError}</div>}
              <label>
                用品大类
                <select
                  onChange={(event) => {
                    const nextGroup = event.target.value as TimelineGroupId;
                    const firstProfile = availableProfiles.find(
                      (profile) => profile.groupId === nextGroup
                    );
                    setProductGroupId(nextGroup);
                    setProductProfileId(firstProfile?.id ?? "");
                  }}
                  value={productGroupId}
                >
                  {productGroups.map((group) => (
                    <option
                      disabled={
                        !availableProfiles.some(
                          (profile) => profile.groupId === group
                        )
                      }
                      key={group}
                      value={group}
                    >
                      {groupLabels[group]}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                用品配置
                <select
                  name="itemProfileId"
                  onChange={(event) => setProductProfileId(event.target.value)}
                  required
                  value={selectedNewProductProfile?.id ?? ""}
                >
                  {productProfiles.map((profile) => (
                    <option key={profile.id} value={profile.id}>
                      {profile.standardTypeName ??
                        standardTypeLabels[profile.standardType]}
                      {" · "}
                      {profile.name}
                    </option>
                  ))}
                </select>
                <small>只显示时间轴“用品与状态”中已建立且启用的行</small>
              </label>
              <div className={styles.formGrid}>
                <label>
                  品牌
                  <input name="brand" required />
                </label>
                <label>
                  型号
                  <input name="model" />
                </label>
                {showsProductSpecification(selectedNewProductProfile) && (
                  <label>
                    {specificationLabel(selectedNewProductProfile)}
                    <input name="specification" placeholder="请输入产品规格" />
                  </label>
                )}
                {selectedNewProductProfile?.managementTemplate === "opened_container" && (
                  <label>
                    净含量（mL）
                    <input min="0.01" name="capacityMl" required step="0.01" type="number" />
                    <small>用于根据历史每日用量估计更换日期</small>
                  </label>
                )}
                <label>
                  基础单位
                  <input
                    readOnly
                    value={itemProfileBaseUnit(selectedNewProductProfile)}
                  />
                </label>
                {usesPackagedLensInventory(selectedNewProductProfile) && (
                  <label>
                    默认每盒片数
                    <input
                      defaultValue={
                        selectedNewProductProfile?.managementTemplate ===
                        "soft_reusable"
                          ? 6
                          : 30
                      }
                      key={`units-per-package-${selectedNewProductProfile?.id}`}
                      min="1"
                      name="unitsPerPackage"
                      required
                      type="number"
                    />
                  </label>
                )}
                {usesDefaultDuration(selectedNewProductProfile) && (
                  <label>
                    {durationLabel(selectedNewProductProfile)}
                    <input
                      defaultValue={
                        selectedNewProductProfile?.defaultDurationDays ?? 90
                      }
                      key={`duration-${selectedNewProductProfile?.id}`}
                      min="1"
                      name="durationDays"
                      required
                      type="number"
                    />
                  </label>
                )}
              </div>
              <ModalActions
                label="创建并继续入库"
                onCancel={() => setDialog(null)}
                submitting={submitting}
              />
            </form>
          ) : dialog === "editProduct" && selectedProduct ? (
            <form
              className={styles.modal}
              key={`edit-${selectedProduct.id}`}
              onSubmit={handleEditProduct}
            >
              <ModalHeading
                onClose={() => setDialog(null)}
                subtitle="产品关联的用品配置保持不变"
                title="编辑产品"
              />
              {dialogError && <div className={styles.formError}>{dialogError}</div>}
              <label>
                用品配置
                <input
                  readOnly
                  value={selectedProductProfile?.name ?? "配置记录缺失"}
                />
              </label>
              <div className={styles.formGrid}>
                <label>
                  品牌
                  <input
                    defaultValue={selectedProduct.brand}
                    name="brand"
                    required
                  />
                </label>
                <label>
                  型号
                  <input defaultValue={selectedProduct.model} name="model" />
                </label>
                {showsProductSpecification(selectedProductProfile) && (
                  <label>
                    {specificationLabel(selectedProductProfile)}
                    <input
                      defaultValue={selectedProduct.specification}
                      name="specification"
                    />
                  </label>
                )}
                {selectedProductProfile?.managementTemplate === "opened_container" && (
                  <label>
                    净含量（mL）
                    <input
                      defaultValue={selectedProduct.capacityMl}
                      min="0.01"
                      name="capacityMl"
                      required
                      step="0.01"
                      type="number"
                    />
                    <small>修改后会用于后续历史用量预测</small>
                  </label>
                )}
                <label>
                  基础单位
                  <input readOnly value={selectedProduct.baseUnit} />
                </label>
                {usesPackagedLensInventory(selectedProductProfile) && (
                  <label>
                    默认每盒片数
                    <input
                      defaultValue={selectedProduct.unitsPerPackage}
                      min="1"
                      name="unitsPerPackage"
                      required
                      type="number"
                    />
                  </label>
                )}
                {usesDefaultDuration(selectedProductProfile) && (
                  <label>
                    {durationLabel(selectedProductProfile)}
                    <input
                      defaultValue={
                        selectedProduct.defaultDurationDays ??
                        selectedProductProfile?.defaultDurationDays ??
                        90
                      }
                      min="1"
                      name="durationDays"
                      required
                      type="number"
                    />
                  </label>
                )}
              </div>
              <ModalActions
                label="保存产品"
                onCancel={() => setDialog(null)}
                submitting={submitting}
              />
            </form>
          ) : dialog === "transfer" && selectedProduct && editingLot ? (
            <form className={styles.modal} onSubmit={handleTransfer}>
              <ModalHeading
                onClose={() => setDialog(null)}
                subtitle={`${selectedProduct.brand} · 批次 ${editingLot.internalLotCode}`}
                title="转移库存"
              />
              {stockError && <div className={styles.formError}>{stockError}</div>}
              <label>
                来源地点
                <select
                  name="fromLocationId"
                  onChange={(event) =>
                    setTransferFromLocationId(event.target.value)
                  }
                  required
                  value={transferFromLocationId}
                >
                  {lotLocationBalances(
                    editingLot,
                    locations.map((location) => location.id),
                    transactions
                  )
                    .filter(
                      (entry) =>
                        transferableQuantity(editingLot.id, entry.locationId) > 0
                    )
                    .map((entry) => (
                    <option key={entry.locationId} value={entry.locationId}>
                      {locations.find((location) => location.id === entry.locationId)
                        ?.name ?? "未知地点"}（可转移 {transferableQuantity(
                          editingLot.id,
                          entry.locationId
                        )} {selectedProduct.baseUnit}）
                    </option>
                  ))}
                </select>
              </label>
              <label>
                目标地点
                <select name="toLocationId" required>
                  {locations
                    .filter(
                      (location) =>
                        location.active &&
                        location.id !== transferFromLocationId
                    )
                    .map((location) => (
                      <option key={location.id} value={location.id}>
                        {location.name}
                      </option>
                    ))}
                </select>
              </label>
              <div className={styles.formGrid}>
                <label>
                  转移数量（{selectedProduct.baseUnit}）
                  <input min="1" name="quantity" required type="number" />
                </label>
                <label>
                  转移日期
                  <LocalDateInput
                    defaultValue={todayLocalDate()}
                    name="occurredDate"
                    required
                  />
                </label>
              </div>
              <label>
                备注（选填）
                <input name="reason" placeholder="例如：带到办公室备用" />
              </label>
              <ModalActions
                label="确认转移"
                onCancel={() => setDialog(null)}
                submitting={submitting}
              />
            </form>
          ) : dialog === "editLot" && selectedProduct && editingLot ? (
            <form
              className={styles.modal}
              key={`edit-lot-${editingLot.id}`}
              onSubmit={handleEditLot}
            >
              <ModalHeading
                onClose={() => setDialog(null)}
                subtitle={`${selectedProduct.brand}${selectedProduct.model ? ` · ${selectedProduct.model}` : ""}`}
                title="编辑库存批次"
              />
              {lotEditError && (
                <div className={styles.formError}>{lotEditError}</div>
              )}
              <div className={styles.formGrid}>
                <label>
                  系统批号
                  <input
                    defaultValue={editingLot.internalLotCode}
                    name="internalLotCode"
                    required
                  />
                </label>
                {usesPackagedLensInventory(selectedProductProfile) ? (
                  <>
                    <label>
                      入库盒数
                      <input
                        defaultValue={lotInitialPackageQuantity(editingLot)}
                        min="0"
                        name="packageQuantity"
                        required
                        type="number"
                      />
                    </label>
                    <label>
                      本批每盒片数
                      <input
                        defaultValue={lotUnitsPerPackage(
                          editingLot,
                          selectedProduct
                        )}
                        min="1"
                        name="unitsPerPackageAtReceipt"
                        required
                        type="number"
                      />
                    </label>
                    <label>
                      入库散片数
                      <input
                        defaultValue={lotInitialLooseUnitQuantity(editingLot)}
                        min="0"
                        name="looseUnitQuantity"
                        required
                        type="number"
                      />
                    </label>
                  </>
                ) : (
                  <label>
                    入库数量（{selectedProduct.baseUnit}）
                    <input
                      defaultValue={editingLot.initialUnitQuantity}
                      min="0"
                      name="quantity"
                      required
                      type="number"
                    />
                  </label>
                )}
                <label>
                  平均每{selectedProduct.baseUnit}价格（元）
                  <input
                    defaultValue={(editingLot.unitPriceMinor / 10_000).toFixed(4)}
                    min="0"
                    name="unitPrice"
                    required
                    step="0.0001"
                    type="number"
                  />
                </label>
                <label>
                  初始入库地点
                  <select
                    defaultValue={editingLot.locationId}
                    name="locationId"
                    required
                  >
                    {[...locations]
                      .sort((left, right) => left.order - right.order)
                      .map((location) => (
                        <option key={location.id} value={location.id}>
                          {location.name}
                          {location.active ? "" : "（已停用）"}
                        </option>
                      ))}
                  </select>
                  <small>用于更正原始入库记录；当前库存移动仍请使用“转移”</small>
                </label>
                <label>
                  入库日期
                  <LocalDateInput
                    defaultValue={editingLot.receivedDate}
                    name="receivedDate"
                    required
                  />
                </label>
                <label>
                  生产批号（选填）
                  <input
                    defaultValue={editingLot.lotNumber}
                    name="lotNumber"
                  />
                </label>
                <label>
                  生产日期
                  <LocalDateInput
                    defaultValue={editingLot.manufacturedDate}
                    name="manufacturedDate"
                  />
                </label>
                {selectedProductProfile?.managementTemplate === "rigid_long_term" ? (
                  <label>
                    预计使用时长（天）
                    <input
                      defaultValue={
                        editingLot.expectedUsageDays ??
                        selectedProduct.defaultDurationDays ??
                        365
                      }
                      min="1"
                      name="expectedUsageDays"
                      required
                      type="number"
                    />
                  </label>
                ) : (
                  <label>
                    预计到期日期
                    <LocalDateInput
                      defaultValue={editingLot.expiryDate}
                      name="expiryDate"
                    />
                  </label>
                )}
              </div>
              <ModalActions
                label="保存批次"
                onCancel={() => setDialog(null)}
                submitting={submitting}
              />
            </form>
          ) : dialog === "stock" && selectedProduct ? (
            <form
              className={styles.modal}
              key={`stock-${selectedProduct.id}`}
              onSubmit={handleReceiveStock}
            >
              <ModalHeading
                onClose={() => setDialog(null)}
                subtitle={`${selectedProduct.brand}${selectedProduct.model ? ` · ${selectedProduct.model}` : ""}`}
                title="添加库存批次"
              />
              {stockError && (
                <div className={styles.formError}>{stockError}</div>
              )}
              <label>
                产品
                <select
                  onChange={(event) => {
                    const productId = event.target.value;
                    setSelectedProductId(productId);
                    setStockInternalLotCode(
                      nextInternalLotCode(productId, stockReceivedDate, allLots)
                    );
                  }}
                  value={selectedProduct.id}
                >
                  {orderedProducts.map((product) => (
                    <option key={product.id} value={product.id}>
                      {product.brand}
                      {product.model ? ` · ${product.model}` : ""}
                    </option>
                  ))}
                </select>
              </label>
              <div className={styles.formGrid}>
                <label>
                  系统批号
                  <input
                    name="internalLotCode"
                    onChange={(event) =>
                      setStockInternalLotCode(event.target.value)
                    }
                    required
                    value={stockInternalLotCode}
                  />
                </label>
                {usesPackagedLensInventory(selectedProductProfile) ? (
                  <>
                    <label>
                      入库盒数
                      <input
                        defaultValue="1"
                        min="0"
                        name="packageQuantity"
                        required
                        type="number"
                      />
                    </label>
                    <label>
                      本批每盒片数
                      <input
                        defaultValue={selectedProduct.unitsPerPackage}
                        min="1"
                        name="unitsPerPackage"
                        required
                        type="number"
                      />
                    </label>
                    <label>
                      入库散片数
                      <input
                        defaultValue="0"
                        min="0"
                        name="looseQuantity"
                        type="number"
                      />
                    </label>
                  </>
                ) : (
                  <label>
                    入库数量（{selectedProduct.baseUnit}）
                    <input min="1" name="quantity" required type="number" />
                  </label>
                )}
                <label>
                  平均每{selectedProduct.baseUnit}价格（元）
                  <input min="0" name="unitPrice" required step="0.0001" type="number" />
                </label>
                {usesDefaultDuration(selectedProductProfile) && (
                  <label>
                    {durationLabel(selectedProductProfile)}
                    <input
                      defaultValue={
                        selectedProduct.defaultDurationDays ??
                        selectedProductProfile?.defaultDurationDays ??
                        90
                      }
                      min="1"
                      name="durationDays"
                      required
                      type="number"
                    />
                  </label>
                )}
                <label>
                  地点
                  <select name="locationId">
                    {locations
                      .filter((location) => location.active)
                      .sort((a, b) => a.order - b.order)
                      .map((location) => (
                        <option key={location.id} value={location.id}>
                          {location.name}
                        </option>
                      ))}
                  </select>
                </label>
                <label>
                  入库日期
                  <LocalDateInput
                    name="receivedDate"
                    onChange={(event) => {
                      const receivedDate = event.target.value;
                      setStockReceivedDate(
                        receivedDate as `${number}-${number}-${number}`
                      );
                      if (/^\d{4}-\d{2}-\d{2}$/.test(receivedDate)) {
                        setStockInternalLotCode(
                          nextInternalLotCode(
                            selectedProduct.id,
                            receivedDate,
                            allLots
                          )
                        );
                      }
                    }}
                    required
                    value={stockReceivedDate}
                  />
                </label>
                <label>
                  生产批号（选填）
                  <input name="lotNumber" />
                </label>
                <label>
                  生产日期
                  <LocalDateInput name="manufacturedDate" />
                </label>
                {selectedProductProfile?.managementTemplate !== "rigid_long_term" && (
                  <label>
                    预计到期日期
                    <LocalDateInput name="expiryDate" />
                  </label>
                )}
              </div>
              <ModalActions
                label="确认入库"
                onCancel={() => setDialog(null)}
                submitting={submitting}
              />
            </form>
          ) : null}
        </div>
      )}

      {pendingDelete && pendingDeleteProduct && (
        <div className={styles.backdrop}>
          <div className={styles.modal} role="dialog" aria-modal="true">
            <ModalHeading
              onClose={() => {
                setPendingDelete(null);
                setDeleteError(null);
              }}
              subtitle="此操作用于纠正误录"
              title={
                pendingDelete.type === "product"
                  ? `删除产品“${pendingDeleteProduct.brand}${pendingDeleteProduct.model ? ` · ${pendingDeleteProduct.model}` : ""}”？`
                  : `作废批次“${pendingDeleteLot?.internalLotCode ?? ""}”？`
              }
            />
            {deleteError && <div className={styles.formError}>{deleteError}</div>}
            <div className={styles.deleteImpact}>
              <strong>
                {pendingDelete.type === "product" ? "删除后将同时处理" : "作废后将同时处理"}
              </strong>
              <ul>
                {pendingDelete.type === "product" ? (
                  <>
                    <li>移除该产品定义及其品牌、型号和默认周期；</li>
                    <li>用品配置行仍会保留，可以重新创建产品。</li>
                  </>
                ) : pendingDeleteLot ? (
                  <>
                    <li>
                      通过反向流水归零该批次当前剩余的 {availableUnits(
                        pendingDeleteLot.id,
                        transactions
                      )} {pendingDeleteProduct.baseUnit}库存；
                    </li>
                    <li>保留全部入库、调整和地点转移流水，并追加对应反向流水；</li>
                    <li>产品定义和其他批次不会受到影响。</li>
                  </>
                ) : null}
              </ul>
              {pendingDelete.type === "lot" && (
                <p>批次将标记为作废并从默认列表隐藏，审计历史仍会保留。</p>
              )}
            </div>
            <div className={styles.modalActions}>
              <button
                disabled={submitting}
                onClick={() => {
                  setPendingDelete(null);
                  setDeleteError(null);
                }}
                type="button"
              >
                取消
              </button>
              <button
                className={styles.dangerButton}
                disabled={submitting}
                onClick={handleConfirmedDelete}
                type="button"
              >
                {pendingDelete.type === "product"
                  ? (submitting ? "删除中…" : "确认删除")
                  : (submitting ? "作废中…" : "确认作废")}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function ModalHeading({
  title,
  subtitle,
  onClose
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
}) {
  return (
    <div className={styles.modalHeading}>
      <div>
        <h2>{title}</h2>
        {subtitle && <p>{subtitle}</p>}
      </div>
      <button aria-label="关闭" onClick={onClose} type="button">
        <Icon name="close" />
      </button>
    </div>
  );
}

function ModalActions({
  label,
  onCancel,
  submitting
}: {
  label: string;
  onCancel: () => void;
  submitting: boolean;
}) {
  return (
    <div className={styles.modalActions}>
      <button disabled={submitting} onClick={onCancel} type="button">
        取消
      </button>
      <button className={styles.primaryButton} disabled={submitting} type="submit">
        {submitting ? "处理中…" : label}
      </button>
    </div>
  );
}
