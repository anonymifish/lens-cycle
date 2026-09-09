import { invokePersistence as invoke } from "./persistenceGateway";
import { useTimelineThemeStore, type TimelinePalette } from "../../stores/timelineThemeStore";
import {
  useForecastSettingsStore,
  type ConsumptionHistoryRange,
  type ConsumptionHistoryScope
} from "../../stores/forecastSettingsStore";

export interface AppPreferences {
  timelinePalette: TimelinePalette;
  consumptionHistoryRange: ConsumptionHistoryRange;
  recentProductCount: number;
  consumptionHistoryScope: ConsumptionHistoryScope;
}

let savePromise: Promise<void> | null = null;
let lastSaveError: unknown = null;

export function collectPreferences(): AppPreferences {
  const forecast = useForecastSettingsStore.getState();
  return structuredClone({
    timelinePalette: useTimelineThemeStore.getState().palette,
    consumptionHistoryRange: forecast.consumptionHistoryRange,
    recentProductCount: forecast.recentProductCount,
    consumptionHistoryScope: forecast.consumptionHistoryScope
  });
}

export async function bootstrapPreferencesPersistence() {
  const stored = await invoke<AppPreferences | null>("load_preferences");
  if (!stored) throw new Error("SQLite 缺少当前基线偏好设置");
  applyPreferences(stored);
  lastSaveError = null;
}

export function applyPreferences(preferences: AppPreferences) {
  useTimelineThemeStore.setState({
    palette: {
      ...structuredClone(preferences.timelinePalette)
    }
  });
  useForecastSettingsStore.setState({
    consumptionHistoryRange: preferences.consumptionHistoryRange,
    recentProductCount: preferences.recentProductCount,
    consumptionHistoryScope: preferences.consumptionHistoryScope
  });
}

export function flushPreferencesSave(): Promise<void> {
  if (savePromise) return savePromise;
  if (lastSaveError !== null) return Promise.reject(lastSaveError);
  return Promise.resolve();
}

/** Publish preferences only after SQLite has accepted the candidate. */
export function savePreferences(changes: Partial<AppPreferences>): Promise<void> {
  if (savePromise) return Promise.reject(new Error("已有 SQLite 写入正在提交，请勿重复操作"));
  const candidate = structuredClone({ ...collectPreferences(), ...changes });
  const saving = (async () => {
    try {
      await invoke("save_preferences", { preferences: candidate });
      applyPreferences(candidate);
      lastSaveError = null;
    } catch (error) {
      lastSaveError = error;
      throw error;
    }
  })();
  savePromise = saving;
  void saving.then(
    () => {
      savePromise = null;
    },
    () => {
      savePromise = null;
    }
  );
  return saving;
}
