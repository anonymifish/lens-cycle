import { invokePersistence as invoke } from "./persistenceGateway";
import { useInventoryStore } from "../../stores/inventoryStore";
import { applyDatabaseViewUpdate } from "./databasePersistence";
import type { EditableProduct, NewProduct, Product } from "./inventory.types";
import { useTimelineItemStore } from "../../stores/timelineItemStore";
import { inclusiveCycleEndDate } from "../timeline/domain/forecast";

function cleanProduct(product: Product): Product {
  const { model, specification, ...required } = product;
  return {
    ...required,
    brand: product.brand.trim(),
    ...(model?.trim() ? { model: model.trim() } : {}),
    ...(specification?.trim() ? { specification: specification.trim() } : {})
  };
}

async function commitProduct(product: Product) {
  const stored = await invoke<Product>("update_product", { product: cleanProduct(product) });
  applyDatabaseViewUpdate(() =>
    useInventoryStore.setState((state) => ({
      products: state.products.map((entry) => (entry.id === stored.id ? stored : entry))
    }))
  );
  return stored;
}

export async function createProduct(input: NewProduct) {
  const siblings = useInventoryStore
    .getState()
    .products.filter((entry) => entry.itemProfileId === input.itemProfileId);
  const orders = siblings
    .map((entry) => entry.sortOrder)
    .filter((order): order is number => Number.isInteger(order));
  const product = cleanProduct({
    ...input,
    id: `product-${input.standardType}-${crypto.randomUUID()}`,
    ...(orders.length ? { sortOrder: Math.max(...orders) + 1 } : {}),
    active: true
  });
  const stored = await invoke<Product>("create_product", { product });
  applyDatabaseViewUpdate(() =>
    useInventoryStore.setState((state) => ({
      products: [...state.products, stored]
    }))
  );
  return stored.id;
}

export async function updateProduct(id: string, changes: EditableProduct) {
  const source = useInventoryStore.getState().products.find((entry) => entry.id === id);
  if (!source) throw new Error("产品不存在");
  const required = { ...source };
  delete required.model;
  delete required.specification;
  delete required.capacityMl;
  delete required.defaultDurationDays;
  const product = cleanProduct({
    ...required,
    brand: changes.brand,
    unitsPerPackage: changes.unitsPerPackage,
    ...(changes.model ? { model: changes.model } : {}),
    ...(changes.specification ? { specification: changes.specification } : {}),
    ...(changes.capacityMl !== undefined ? { capacityMl: changes.capacityMl } : {}),
    ...(changes.defaultDurationDays !== undefined
      ? { defaultDurationDays: changes.defaultDurationDays }
      : {})
  });
  const durationChanged =
    product.defaultDurationDays !== source.defaultDurationDays &&
    product.defaultDurationDays !== undefined;
  const items = useTimelineItemStore.getState().items;
  const updatedItems = durationChanged
    ? items
        .filter((item) => item.productId === id && item.openedExpiryDate)
        .map((item) => {
          const openedExpiryDate = inclusiveCycleEndDate(
            item.startDate,
            product.defaultDurationDays!
          );
          const depletionPredictionDate = item.depletionPredictionDate;
          const predictionDate =
            depletionPredictionDate && depletionPredictionDate < openedExpiryDate
              ? depletionPredictionDate
              : openedExpiryDate;
          return {
            ...item,
            openedExpiryDate,
            predictionDate
          };
        })
    : [];
  if (updatedItems.length === 0) {
    await commitProduct(product);
    return;
  }
  await invoke("commit_app_data_mutation", {
    mutation: {
      upsertProducts: [product],
      upsertItems: updatedItems,
      deleteItemIds: [],
      appendTransactions: [],
      upsertUsageFacts: [],
      deleteUsageFactIds: [],
      upsertCareEvents: [],
      deleteCareEventIds: []
    }
  });
  const itemsById = new Map(updatedItems.map((item) => [item.id, item]));
  applyDatabaseViewUpdate(() => {
    useInventoryStore.setState((state) => ({
      products: state.products.map((entry) => (entry.id === product.id ? product : entry))
    }));
    useTimelineItemStore.setState((state) => ({
      items: state.items.map((item) => itemsById.get(item.id) ?? item)
    }));
  });
}

export async function updateProductDuration(id: string, durationDays: number) {
  const source = useInventoryStore.getState().products.find((entry) => entry.id === id);
  if (!source) throw new Error("产品不存在");
  await commitProduct({ ...source, defaultDurationDays: durationDays });
}

export async function updateProductUnitsPerPackage(id: string, unitsPerPackage: number) {
  const source = useInventoryStore.getState().products.find((entry) => entry.id === id);
  if (!source) throw new Error("产品不存在");
  await commitProduct({ ...source, unitsPerPackage });
}

export async function deleteProduct(id: string) {
  await invoke("delete_product", { id });
  applyDatabaseViewUpdate(() =>
    useInventoryStore.setState((state) => ({
      products: state.products.filter((entry) => entry.id !== id)
    }))
  );
}

export async function moveProduct(id: string, direction: -1 | 1) {
  const products = useInventoryStore.getState().products;
  const source = products.find((entry) => entry.id === id);
  if (!source) throw new Error("产品不存在");
  const profileKey = source.itemProfileId;
  const siblings = products
    .filter((entry) => entry.itemProfileId === profileKey)
    .sort(
      (left, right) =>
        (left.sortOrder ?? Number.MAX_SAFE_INTEGER) - (right.sortOrder ?? Number.MAX_SAFE_INTEGER)
    );
  const index = siblings.findIndex((entry) => entry.id === id);
  const target = siblings[index + direction];
  if (!target) return;
  [siblings[index], siblings[index + direction]] = [target, source];
  const order = siblings.map((entry, sortOrder) => ({ id: entry.id, sortOrder }));
  await invoke("reorder_products", { order });
  const byId = new Map(order.map((entry) => [entry.id, entry.sortOrder]));
  applyDatabaseViewUpdate(() =>
    useInventoryStore.setState({
      products: products.map((entry) =>
        byId.has(entry.id) ? { ...entry, sortOrder: byId.get(entry.id)! } : entry
      )
    })
  );
}
