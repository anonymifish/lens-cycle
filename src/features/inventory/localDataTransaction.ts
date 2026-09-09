import { useInventoryStore } from "../../stores/inventoryStore";
import { useTimelineItemStore } from "../../stores/timelineItemStore";
import { useTimelineCareEventStore } from "../../stores/timelineCareEventStore";
import { useUsageFactStore } from "../../stores/usageFactStore";

/**
 * Keeps multi-store view updates atomic while desktop persistence is committed first.
 * The database implementation can replace this boundary with a real transaction.
 */
export function runLocalDataTransaction<T>(operation: () => T): T {
  const inventoryState = useInventoryStore.getState();
  const inventory = structuredClone({
    products: inventoryState.products,
    locations: inventoryState.locations,
    lots: inventoryState.lots,
    transactions: inventoryState.transactions
  });
  const timeline = structuredClone({ items: useTimelineItemStore.getState().items });
  const usage = structuredClone({ facts: useUsageFactStore.getState().facts });
  const care = structuredClone({ events: useTimelineCareEventStore.getState().events });

  try {
    return operation();
  } catch (error) {
    useInventoryStore.setState({
      products: inventory.products,
      locations: inventory.locations,
      lots: inventory.lots,
      transactions: inventory.transactions
    });
    useTimelineItemStore.setState({ items: timeline.items });
    useUsageFactStore.setState({ facts: usage.facts });
    useTimelineCareEventStore.setState({ events: care.events });
    throw error;
  }
}
