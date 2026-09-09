import { create } from "./atomicStore";
import type { UsageFact } from "../features/timeline/timeline.types";

interface UsageFactState {
  facts: UsageFact[];
  addFact: (fact: UsageFact) => void;
  updateFact: (id: string, fact: UsageFact) => void;
  deleteFact: (id: string) => void;
  deleteFactsForItem: (itemId: string) => void;
}

export const useUsageFactStore = create<UsageFactState>()(
  (set) => ({
      facts: [],
      addFact: (fact) =>
        set((state) => ({ facts: [...state.facts, fact] })),
      updateFact: (id, fact) =>
        set((state) => ({
          facts: state.facts.map((current) => (current.id === id ? fact : current))
        })),
      deleteFact: (id) =>
        set((state) => ({ facts: state.facts.filter((fact) => fact.id !== id) })),
      deleteFactsForItem: (itemId) =>
        set((state) => ({
          facts: state.facts.filter((fact) => fact.itemId !== itemId)
        }))
  })
);
