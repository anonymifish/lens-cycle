import type { StandardType } from "../catalog/catalog.types";
import type { LocalDate } from "../../shared/dates/localDate";

export interface Product {
  id: string;
  itemProfileId: string;
  standardType: StandardType;
  brand: string;
  model?: string;
  specification?: string;
  capacityMl?: number;
  baseUnit: string;
  unitsPerPackage: number;
  defaultDurationDays?: number;
  sortOrder?: number;
  active: boolean;
}

export interface InventoryLocation {
  id: string;
  name: string;
  note?: string;
  active: boolean;
  order: number;
}

export interface StockLot {
  id: string;
  productId: string;
  internalLotCode: string;
  lotNumber?: string;
  manufacturedDate?: LocalDate;
  expiryDate?: LocalDate;
  expectedUsageDays?: number;
  receivedDate: LocalDate;
  locationId: string;
  initialUnitQuantity: number;
  initialPackageQuantity?: number;
  initialLooseUnitQuantity?: number;
  unitsPerPackageAtReceipt?: number;
  /** Integer ten-thousandths of one yuan (1 CNY = 10,000). */
  unitPriceMinor: number;
  currency: "CNY";
  /** Set when a committed lot was voided through immutable reversal transactions. */
  voidedAt?: LocalDate;
  voidedByTransactionId?: string;
}

export type InventoryTransactionType =
  | "stock_in"
  | "activate"
  | "package_open"
  | "loose_allocate"
  | "consume"
  | "loss"
  | "discard"
  | "transfer"
  | "correction"
  | "reverse";

export interface InventoryTransaction {
  id: string;
  stockLotId: string;
  occurredDate: LocalDate;
  type: InventoryTransactionType;
  quantityDelta: number;
  relatedInstanceId?: string;
  relatedCycleId?: string;
  reversedTransactionId?: string;
  allocatedUnitQuantity?: number;
  locationId?: string;
  fromLocationId?: string;
  toLocationId?: string;
  transferQuantity?: number;
  /** Whether this inventory shape change should be undone with its instance. */
  reversibleWithInstance?: boolean;
  reason?: string;
}

export interface NewInventoryLocation {
  name: string;
  note?: string;
}

export interface NewProduct {
  itemProfileId: string;
  standardType: StandardType;
  brand: string;
  model?: string;
  specification?: string;
  capacityMl?: number;
  baseUnit: string;
  unitsPerPackage: number;
  defaultDurationDays?: number;
}

export interface EditableProduct {
  brand: string;
  model?: string;
  specification?: string;
  capacityMl?: number;
  unitsPerPackage: number;
  defaultDurationDays?: number;
}

export interface NewStockLot {
  productId: string;
  internalLotCode: string;
  lotNumber?: string;
  manufacturedDate?: LocalDate;
  expiryDate?: LocalDate;
  expectedUsageDays?: number;
  receivedDate: LocalDate;
  locationId: string;
  quantity: number;
  packageQuantity?: number;
  looseUnitQuantity?: number;
  unitsPerPackageAtReceipt?: number;
  /** Integer ten-thousandths of one yuan (1 CNY = 10,000). */
  unitPriceMinor: number;
}

export interface EditableStockLot {
  internalLotCode: string;
  lotNumber?: string;
  manufacturedDate?: LocalDate;
  expiryDate?: LocalDate;
  expectedUsageDays?: number;
  receivedDate: LocalDate;
  locationId: string;
  quantity: number;
  packageQuantity?: number;
  looseUnitQuantity?: number;
  unitsPerPackageAtReceipt?: number;
  /** Integer ten-thousandths of one yuan (1 CNY = 10,000). */
  unitPriceMinor: number;
}
