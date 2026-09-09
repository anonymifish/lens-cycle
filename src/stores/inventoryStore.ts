import { create } from "./atomicStore";
import type {
  EditableProduct,
  EditableStockLot,
  InventoryLocation,
  InventoryTransaction,
  NewProduct,
  NewInventoryLocation,
  NewStockLot,
  Product,
  StockLot
} from "../features/inventory/inventory.types";
import type { StandardType } from "../features/catalog/catalog.types";
import { availableUnitsAtLocation } from "../features/inventory/inventory";
import { useTimelineItemStore } from "./timelineItemStore";

const initialProducts: Product[] = [];

const initialLocations: InventoryLocation[] = [];

const initialLots: StockLot[] = [];

const initialTransactions: InventoryTransaction[] = [];

interface InventoryState {
  products: Product[];
  locations: InventoryLocation[];
  lots: StockLot[];
  transactions: InventoryTransaction[];
  addProduct: (product: NewProduct) => string;
  moveProduct: (id: string, direction: -1 | 1) => void;
  updateProduct: (id: string, product: EditableProduct) => void;
  deleteProduct: (id: string) => void;
  updateStockLot: (id: string, lot: EditableStockLot) => void;
  updateProductsForProfile: (
    itemProfileId: string,
    standardType: StandardType,
    baseUnit: string
  ) => void;
  updateProductDuration: (id: string, durationDays: number) => void;
  updateProductUnitsPerPackage: (
    id: string,
    unitsPerPackage: number
  ) => void;
  rescheduleActivation: (
    relatedInstanceId: string,
    occurredDate: InventoryTransaction["occurredDate"]
  ) => void;
  reverseActivation: (
    relatedInstanceId: string,
    occurredDate: InventoryTransaction["occurredDate"]
  ) => void;
  receiveStock: (lot: NewStockLot) => string;
  addTransaction: (transaction: InventoryTransaction) => void;
  addLocation: (location: NewInventoryLocation) => string;
  updateLocation: (id: string, location: NewInventoryLocation) => void;
  deleteLocation: (id: string) => void;
  setLocationActive: (id: string, active: boolean) => void;
  transferStock: (input: {
    stockLotId: string;
    fromLocationId: string;
    toLocationId: string;
    quantity: number;
    occurredDate: InventoryTransaction["occurredDate"];
    reason?: string;
  }) => void;
}

export const useInventoryStore = create<InventoryState>()(
  (set, get) => ({
      products: initialProducts,
      locations: initialLocations,
      lots: initialLots,
      transactions: initialTransactions,
      addProduct: (product) => {
        const id = `product-${product.standardType}-${crypto.randomUUID()}`;
        set((state) => {
          const siblings = state.products.filter(
            (entry) => entry.itemProfileId === product.itemProfileId
          );
          const customOrders = siblings
            .map((entry) => entry.sortOrder)
            .filter((order): order is number => Number.isInteger(order));
          return {
            products: [
              ...state.products,
              {
                ...product,
                id,
                ...(customOrders.length
                  ? { sortOrder: Math.max(...customOrders) + 1 }
                  : {}),
                active: true
              }
            ]
          };
        });
        return id;
      },
      moveProduct: (id, direction) =>
        set((state) => {
          const source = state.products.find((product) => product.id === id);
          if (!source) return state;
          const profileKey = source.itemProfileId;
          const siblings = state.products
            .filter(
              (product) =>
                product.itemProfileId === profileKey
            )
            .sort((left, right) => {
              const leftHasOrder = Number.isInteger(left.sortOrder);
              const rightHasOrder = Number.isInteger(right.sortOrder);
              if (leftHasOrder && rightHasOrder)
                return left.sortOrder! - right.sortOrder!;
              if (leftHasOrder) return -1;
              if (rightHasOrder) return 1;
              return `${left.brand}\u0000${left.model ?? ""}\u0000${left.specification ?? ""}`.localeCompare(
                `${right.brand}\u0000${right.model ?? ""}\u0000${right.specification ?? ""}`,
                "zh-CN"
              );
            });
          const sourceIndex = siblings.findIndex((product) => product.id === id);
          const targetIndex = sourceIndex + direction;
          if (sourceIndex < 0 || targetIndex < 0 || targetIndex >= siblings.length)
            return state;
          [siblings[sourceIndex], siblings[targetIndex]] = [
            siblings[targetIndex]!,
            siblings[sourceIndex]!
          ];
          const orderById = new Map(
            siblings.map((product, index) => [product.id, index])
          );
          return {
            products: state.products.map((product) =>
              orderById.has(product.id)
                ? { ...product, sortOrder: orderById.get(product.id)! }
                : product
            )
          };
        }),
      updateProduct: (id, changes) =>
        set((state) => ({
          products: state.products.map((product) => {
            if (product.id !== id) return product;
            const updated: Product = {
              ...product,
              brand: changes.brand.trim(),
              unitsPerPackage: changes.unitsPerPackage
            };
            if (changes.model?.trim()) updated.model = changes.model.trim();
            else delete updated.model;
            if (changes.specification?.trim()) {
              updated.specification = changes.specification.trim();
            } else {
              delete updated.specification;
            }
            if (changes.capacityMl && changes.capacityMl > 0) {
              updated.capacityMl = changes.capacityMl;
            } else {
              delete updated.capacityMl;
            }
            if (changes.defaultDurationDays) {
              updated.defaultDurationDays = changes.defaultDurationDays;
            } else {
              delete updated.defaultDurationDays;
            }
            return updated;
          })
        })),
      deleteProduct: (id) =>
        set((state) =>
          state.lots.some((lot) => lot.productId === id)
            ? state
            : {
                products: state.products.filter((product) => product.id !== id)
              }
        ),
      updateStockLot: (id, changes) => {
        const normalizedCode = changes.internalLotCode.trim();
        const source = get().lots.find((lot) => lot.id === id);
        const targetLocation = get().locations.find(
          (location) => location.id === changes.locationId
        );
        if (
          !source ||
          !targetLocation ||
          !normalizedCode ||
          get().lots.some(
            (lot) =>
              lot.id !== id &&
              lot.productId === source.productId &&
              lot.internalLotCode === normalizedCode
          )
        ) {
          throw new Error("同一产品的系统批号不能重复");
        }
        set((state) => {
          const lot = state.lots.find((item) => item.id === id);
          if (!lot) return state;
          const reversedIds = new Set(
            state.transactions
              .filter((transaction) => transaction.type === "reverse")
              .map((transaction) => transaction.reversedTransactionId)
          );
          const stockIn = state.transactions.find(
            (transaction) =>
              transaction.stockLotId === id &&
              transaction.type === "stock_in" &&
              !reversedIds.has(transaction.id)
          );
          const otherQuantity = state.transactions
            .filter(
              (transaction) =>
                transaction.stockLotId === id &&
                transaction.id !== stockIn?.id &&
                transaction.type !== "reverse" &&
                !reversedIds.has(transaction.id)
            )
            .reduce(
              (total, transaction) => total + transaction.quantityDelta,
              0
            );
          if (changes.quantity + otherQuantity < 0) return state;

          const updatedLot: StockLot = {
            ...lot,
            internalLotCode: normalizedCode,
            receivedDate: changes.receivedDate,
            locationId: changes.locationId,
            initialUnitQuantity: changes.quantity,
            ...(changes.packageQuantity !== undefined
              ? { initialPackageQuantity: changes.packageQuantity }
              : {}),
            ...(changes.looseUnitQuantity !== undefined
              ? { initialLooseUnitQuantity: changes.looseUnitQuantity }
              : {}),
            ...(changes.unitsPerPackageAtReceipt !== undefined
              ? {
                  unitsPerPackageAtReceipt:
                    changes.unitsPerPackageAtReceipt
                }
              : {}),
            unitPriceMinor: changes.unitPriceMinor
          };
          if (changes.lotNumber?.trim()) {
            updatedLot.lotNumber = changes.lotNumber.trim();
          } else {
            delete updatedLot.lotNumber;
          }
          if (changes.manufacturedDate) {
            updatedLot.manufacturedDate = changes.manufacturedDate;
          } else {
            delete updatedLot.manufacturedDate;
          }
          if (changes.expiryDate) {
            updatedLot.expiryDate = changes.expiryDate;
          } else {
            delete updatedLot.expiryDate;
          }
          if (changes.expectedUsageDays) {
            updatedLot.expectedUsageDays = changes.expectedUsageDays;
          } else {
            delete updatedLot.expectedUsageDays;
          }

          const shouldReplaceStockIn =
            stockIn &&
            (stockIn.occurredDate !== changes.receivedDate ||
              stockIn.quantityDelta !== changes.quantity ||
              (stockIn.locationId ?? lot.locationId) !== changes.locationId);
          const nextTransactions = shouldReplaceStockIn
            ? [
                ...state.transactions,
                {
                  id: `tx-${crypto.randomUUID()}`,
                  stockLotId: id,
                  occurredDate: changes.receivedDate,
                  type: "reverse" as const,
                  quantityDelta: -stockIn.quantityDelta,
                  reversedTransactionId: stockIn.id,
                  reason: "更正批次入库信息"
                },
                {
                  ...stockIn,
                  id: `tx-${crypto.randomUUID()}`,
                  occurredDate: changes.receivedDate,
                  locationId: changes.locationId,
                  quantityDelta: changes.quantity
                }
              ]
            : state.transactions;
          if (
            state.locations.some(
              (location) =>
                availableUnitsAtLocation(
                  updatedLot,
                  location.id,
                  nextTransactions
                ) < 0
            )
          ) {
            throw new Error(
              "更正入库地点后会使后续库存流水出现负数，请先检查转移或使用记录"
            );
          }
          return {
            lots: state.lots.map((item) =>
              item.id === id ? updatedLot : item
            ),
            transactions: nextTransactions
          };
        });
      },
      updateProductsForProfile: (itemProfileId, standardType, baseUnit) =>
        set((state) => ({
          products: state.products.map((product) =>
            product.itemProfileId === itemProfileId
              ? { ...product, standardType, baseUnit }
              : product
          )
        })),
      updateProductDuration: (id, durationDays) =>
        set((state) => ({
          products: state.products.map((product) =>
            product.id === id
              ? { ...product, defaultDurationDays: durationDays }
              : product
          )
        })),
      updateProductUnitsPerPackage: (id, unitsPerPackage) =>
        set((state) => ({
          products: state.products.map((product) =>
            product.id === id ? { ...product, unitsPerPackage } : product
          )
        })),
      rescheduleActivation: (relatedInstanceId, occurredDate) =>
        set((state) => {
          const reversedIds = new Set(
            state.transactions
              .filter((transaction) => transaction.type === "reverse")
              .map((transaction) => transaction.reversedTransactionId)
          );
          const originals = state.transactions.filter(
              (transaction) =>
                (transaction.type === "activate" ||
                  transaction.type === "package_open" ||
                  transaction.type === "loose_allocate") &&
                transaction.reversibleWithInstance !== false &&
                transaction.relatedInstanceId === relatedInstanceId &&
                !reversedIds.has(transaction.id)
            );
          const changed = originals.filter(
            (transaction) => transaction.occurredDate !== occurredDate
          );
          if (changed.length === 0) return state;
          return {
            transactions: [
              ...state.transactions,
              ...changed.flatMap((original) => [
                {
                  id: `tx-${crypto.randomUUID()}`,
                  stockLotId: original.stockLotId,
                  occurredDate,
                  type: "reverse" as const,
                  quantityDelta: -original.quantityDelta,
                  relatedInstanceId,
                  reversedTransactionId: original.id,
                  reason: "修改实例启用日期"
                },
                {
                  ...original,
                  id: `tx-${crypto.randomUUID()}`,
                  occurredDate
                }
              ])
            ]
          };
        }),
      reverseActivation: (relatedInstanceId, occurredDate) => {
        const state = get();
        const reversedIds = new Set(
          state.transactions
            .filter((transaction) => transaction.type === "reverse")
            .map((transaction) => transaction.reversedTransactionId)
        );
        const activations = state.transactions.filter(
            (transaction) =>
              (transaction.type === "activate" ||
                transaction.type === "package_open" ||
                transaction.type === "loose_allocate") &&
              transaction.reversibleWithInstance !== false &&
              transaction.relatedInstanceId === relatedInstanceId &&
              !reversedIds.has(transaction.id)
          );
        if (activations.length === 0) {
          throw new Error("未找到可撤销的实例启用流水");
        }
        set((current) => ({
          transactions: [
            ...current.transactions,
            ...activations.map((activation) => ({
              id: `tx-${crypto.randomUUID()}`,
              stockLotId: activation.stockLotId,
              occurredDate,
              type: "reverse" as const,
              quantityDelta: -activation.quantityDelta,
              reversedTransactionId: activation.id,
              reason: "删除误录实例"
            }))
          ]
        }));
      },
      receiveStock: (lot) => {
        const normalizedCode = lot.internalLotCode.trim();
        const state = get();
        const location = state.locations.find(
          (entry) => entry.id === lot.locationId && entry.active
        );
        if (!state.products.some((product) => product.id === lot.productId))
          throw new Error("入库产品不存在");
        if (!location) throw new Error("入库地点不可用");
        if (!Number.isInteger(lot.quantity) || lot.quantity <= 0)
          throw new Error("入库数量必须是正整数");
        if (!Number.isFinite(lot.unitPriceMinor) || lot.unitPriceMinor < 0)
          throw new Error("单位价格必须是非负数");
        if (
          lot.expectedUsageDays !== undefined &&
          (!Number.isInteger(lot.expectedUsageDays) || lot.expectedUsageDays <= 0)
        )
          throw new Error("预计使用时长必须是正整数");
        if (
          lot.manufacturedDate &&
          lot.expiryDate &&
          lot.expiryDate < lot.manufacturedDate
        )
          throw new Error("预计到期日期不能早于生产日期");
        const hasPackageShape =
          lot.packageQuantity !== undefined ||
          lot.looseUnitQuantity !== undefined ||
          lot.unitsPerPackageAtReceipt !== undefined;
        if (hasPackageShape) {
          if (
            !Number.isInteger(lot.packageQuantity) ||
            lot.packageQuantity! < 0 ||
            !Number.isInteger(lot.looseUnitQuantity) ||
            lot.looseUnitQuantity! < 0 ||
            !Number.isInteger(lot.unitsPerPackageAtReceipt) ||
            lot.unitsPerPackageAtReceipt! <= 0
          )
            throw new Error("包装库存字段不完整或不是整数");
          if (
            lot.packageQuantity! * lot.unitsPerPackageAtReceipt! +
              lot.looseUnitQuantity! !==
            lot.quantity
          )
            throw new Error("盒数、散片数与基础单位总数不一致");
        }
        if (
          !normalizedCode ||
          state.lots.some(
            (current) =>
              current.productId === lot.productId &&
              current.internalLotCode.toLocaleLowerCase() ===
                normalizedCode.toLocaleLowerCase()
          )
        ) {
          throw new Error("同一产品的系统批号不能重复");
        }
        const id = `lot-${crypto.randomUUID()}`;
        const transactionId = `tx-${crypto.randomUUID()}`;
        set((state) => ({
          lots: [
            ...state.lots,
            {
              id,
              productId: lot.productId,
              internalLotCode: normalizedCode,
              ...(lot.lotNumber ? { lotNumber: lot.lotNumber } : {}),
              ...(lot.manufacturedDate
                ? { manufacturedDate: lot.manufacturedDate }
                : {}),
              ...(lot.expiryDate ? { expiryDate: lot.expiryDate } : {}),
              ...(lot.expectedUsageDays
                ? { expectedUsageDays: lot.expectedUsageDays }
                : {}),
              receivedDate: lot.receivedDate,
              locationId: lot.locationId,
              initialUnitQuantity: lot.quantity,
              ...(lot.packageQuantity !== undefined
                ? { initialPackageQuantity: lot.packageQuantity }
                : {}),
              ...(lot.looseUnitQuantity !== undefined
                ? { initialLooseUnitQuantity: lot.looseUnitQuantity }
                : {}),
              ...(lot.unitsPerPackageAtReceipt !== undefined
                ? {
                    unitsPerPackageAtReceipt:
                      lot.unitsPerPackageAtReceipt
                  }
                : {}),
              unitPriceMinor: lot.unitPriceMinor,
              currency: "CNY"
            }
          ],
          transactions: [
            ...state.transactions,
            {
              id: transactionId,
              stockLotId: id,
              occurredDate: lot.receivedDate,
              type: "stock_in",
              quantityDelta: lot.quantity,
              locationId: lot.locationId
            }
          ]
        }));
        return id;
      },
      addTransaction: (transaction) =>
        set((state) => ({
          transactions: [...state.transactions, transaction]
        })),
      addLocation: (location) => {
        const name = location.name.trim();
        if (
          !name ||
          get().locations.some(
            (entry) => entry.name.toLocaleLowerCase() === name.toLocaleLowerCase()
          )
        )
          throw new Error("地点名称不能为空或重复");
        const id = `location-${crypto.randomUUID()}`;
        set((state) => ({
          locations: [
            ...state.locations,
            {
              id,
              name,
              ...(location.note?.trim() ? { note: location.note.trim() } : {}),
              active: true,
              order: state.locations.length
            }
          ]
        }));
        return id;
      },
      updateLocation: (id, location) => {
        const name = location.name.trim();
        if (!get().locations.some((entry) => entry.id === id))
          throw new Error("地点不存在");
        if (
          !name ||
          get().locations.some(
            (entry) =>
              entry.id !== id &&
              entry.name.toLocaleLowerCase() === name.toLocaleLowerCase()
          )
        )
          throw new Error("地点名称不能为空或重复");
        set((state) => ({
          locations: state.locations.map((entry) =>
            {
              if (entry.id !== id) return entry;
              const updated: InventoryLocation = { ...entry, name };
              if (location.note?.trim()) updated.note = location.note.trim();
              else delete updated.note;
              return updated;
            }
          )
        }));
        useTimelineItemStore.getState().setItems((items) =>
          items.map((item) =>
            item.locationId === id ? { ...item, location: name } : item
          )
        );
      },
      deleteLocation: (id) => {
        const state = get();
        const location = state.locations.find((entry) => entry.id === id);
        if (!location) throw new Error("地点不存在");
        if (state.locations.length <= 1) throw new Error("至少需要保留一个地点");
        if (
          location.active &&
          state.locations.filter((entry) => entry.active).length <= 1
        )
          throw new Error("至少需要保留一个启用地点");

        const hasLotReference = state.lots.some((lot) => lot.locationId === id);
        const hasTransactionReference = state.transactions.some(
          (transaction) =>
            transaction.locationId === id ||
            transaction.fromLocationId === id ||
            transaction.toLocationId === id
        );
        const hasTimelineReference = useTimelineItemStore
          .getState()
          .items.some(
            (item) =>
              item.locationId === id ||
              item.locationIntervals?.some(
                (interval) => interval.locationId === id
              )
          );
        if (hasLotReference || hasTransactionReference || hasTimelineReference)
          throw new Error("地点已有库存、流水或使用实例关联，不能删除");

        set((current) => ({
          locations: current.locations
            .filter((entry) => entry.id !== id)
            .map((entry, order) => ({ ...entry, order }))
        }));
      },
      setLocationActive: (id, active) => {
        const state = get();
        const location = state.locations.find((entry) => entry.id === id);
        if (!location) throw new Error("地点不存在");
        if (!active && location.active) {
          if (state.locations.filter((entry) => entry.active).length <= 1)
            throw new Error("至少需要保留一个启用地点");
          const hasStock = state.lots.some(
            (lot) =>
              availableUnitsAtLocation(lot, id, state.transactions) > 0
          );
          const hasActiveItem = useTimelineItemStore
            .getState()
            .items.some(
              (item) => item.locationId === id && item.status !== "completed"
            );
          if (hasStock || hasActiveItem)
            throw new Error("地点仍有库存或使用中实例，不能停用");
        }
        set((current) => ({
          locations: current.locations.map((entry) =>
            entry.id === id ? { ...entry, active } : entry
          )
        }));
      },
      transferStock: (input) => {
        if (!Number.isInteger(input.quantity) || input.quantity <= 0)
          throw new Error("转移数量必须是正整数");
        const quantity = input.quantity;
        if (input.fromLocationId === input.toLocationId)
          throw new Error("来源地点和目标地点不能相同");
        const state = get();
        const lot = state.lots.find((entry) => entry.id === input.stockLotId);
        const source = state.locations.find(
          (entry) => entry.id === input.fromLocationId
        );
        const target = state.locations.find(
          (entry) => entry.id === input.toLocationId && entry.active
        );
        if (!lot || !source || !target)
          throw new Error("批次、来源地点或目标地点不可用");
        if (
          availableUnitsAtLocation(
            lot,
            input.fromLocationId,
            state.transactions
          ) < quantity
        )
          throw new Error("来源地点可转移库存不足");
        set((current) => ({
          transactions: [
            ...current.transactions,
            {
              id: `tx-${crypto.randomUUID()}`,
              stockLotId: input.stockLotId,
              occurredDate: input.occurredDate,
              type: "transfer",
              quantityDelta: 0,
              fromLocationId: input.fromLocationId,
              toLocationId: input.toLocationId,
              transferQuantity: quantity,
              ...(input.reason?.trim() ? { reason: input.reason.trim() } : {})
            }
          ]
        }));
      }
  })
);
