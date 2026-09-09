import { create } from "zustand";

export type PersistenceMode = "sqlite";
export type PersistencePhase = "initializing" | "ready" | "saving" | "error";

interface PersistenceStatusState {
  mode: PersistenceMode;
  phase: PersistencePhase;
  error: string | null;
  setStatus: (
    mode: PersistenceMode,
    phase: PersistencePhase,
    error?: string | null
  ) => void;
}

export const usePersistenceStatusStore = create<PersistenceStatusState>()(
  (set) => ({
    mode: "sqlite",
    phase: "initializing",
    error: null,
    setStatus: (mode, phase, error = null) => set({ mode, phase, error })
  })
);
