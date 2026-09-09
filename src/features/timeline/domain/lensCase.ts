import type { EyeSide } from "../../catalog/catalog.types";
import { addLocalDays, type LocalDate } from "../../../shared/dates/localDate";

type EyeAssignmentInterval = {
  startDate: LocalDate;
  endDate: LocalDate | null;
  eyeSides: EyeSide[];
};

export function applyLensCaseEyeSwitch(
  source: EyeAssignmentInterval[],
  date: LocalDate,
  eyeSides: EyeSide[]
) {
  const intervals = source.map((interval) => ({
    ...interval,
    eyeSides: [...interval.eyeSides]
  }));
  const current = intervals.at(-1);
  if (!current) return [{ startDate: date, endDate: null, eyeSides }];
  if (current.startDate === date) {
    current.eyeSides = [...eyeSides];
    return intervals;
  }
  current.endDate = date;
  intervals.push({ startDate: date, endDate: null, eyeSides: [...eyeSides] });
  return intervals;
}

export function lensCasePredictionDate(
  currentEyeSides: EyeSide[],
  accumulatedDays: Map<EyeSide, number>,
  durationDays: number,
  asOfDate: LocalDate
) {
  if (currentEyeSides.length === 0) return null;
  const remainingDays = Math.min(
    ...currentEyeSides.map((side) =>
      Math.max(0, durationDays - (accumulatedDays.get(side) ?? 0))
    )
  );
  return addLocalDays(asOfDate, remainingDays);
}
