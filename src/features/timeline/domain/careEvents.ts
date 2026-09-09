import type { LocalDate } from "../../../shared/dates/localDate";
import type { LensCareEvent } from "../timeline.types";

export type LensCareEventState = "planned" | "due" | "completed";

export function careEventState(
  event: LensCareEvent,
  today: LocalDate
): LensCareEventState {
  if (event.completedDate) return "completed";
  return event.plannedDate && event.plannedDate <= today ? "due" : "planned";
}

export function careEventDate(event: LensCareEvent) {
  return event.completedDate ?? event.plannedDate;
}

export function careEventLabel(event: LensCareEvent) {
  const name = event.kind === "review" ? "复查" : "除蛋白";
  return event.completedDate ? name : `计划${name}`;
}
