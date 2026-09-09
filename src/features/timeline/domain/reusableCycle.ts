import { addLocalDays, type LocalDate } from "../../../shared/dates/localDate";

/**
 * Reusable-lens cycle end dates are stored as exclusive boundaries. A new lens
 * may still be started on the calendar day the preceding lens was discarded.
 */
export function reusableCycleActualEndDate(endBoundary: LocalDate) {
  return addLocalDays(endBoundary, -1);
}

export function reusableCycleStartIsValid(
  previousEndBoundary: LocalDate | null | undefined,
  startDate: LocalDate
) {
  return (
    !previousEndBoundary ||
    startDate >= reusableCycleActualEndDate(previousEndBoundary)
  );
}

export function reusableCycleEndIsValid(
  endBoundary: LocalDate | null | undefined,
  nextStartDate: LocalDate | null | undefined
) {
  return (
    !endBoundary ||
    !nextStartDate ||
    reusableCycleActualEndDate(endBoundary) <= nextStartDate
  );
}
