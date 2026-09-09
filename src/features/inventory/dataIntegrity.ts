import type { ItemProfile } from "../catalog/catalog.types";
import type { LensCareEvent, TimelineItem, UsageFact } from "../timeline/timeline.types";
import type {
  InventoryLocation,
  InventoryTransaction,
  Product,
  StockLot
} from "./inventory.types";
import { validateDataIntegrityV2 } from "./dataIntegrityV2";

export interface DataIntegrityInput {
  profiles: ItemProfile[];
  products: Product[];
  locations: InventoryLocation[];
  lots: StockLot[];
  transactions: InventoryTransaction[];
  items: TimelineItem[];
  usageFacts: UsageFact[];
  careEvents: LensCareEvent[];
}

export interface DataIntegrityIssue {
  entity: string;
  id: string;
  message: string;
}

export const validateDataIntegrity = validateDataIntegrityV2;
