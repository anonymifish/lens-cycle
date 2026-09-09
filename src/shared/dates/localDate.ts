import { addDays, differenceInCalendarDays, format, parseISO } from "date-fns";

export type LocalDate = string;

export function parseLocalDate(value: LocalDate): Date {
  return parseISO(`${value}T12:00:00`);
}

export function formatLocalDate(value: Date): LocalDate {
  return format(value, "yyyy-MM-dd");
}

export function displayLocalDate(
  value: LocalDate | null | undefined,
  emptyText = "未填写"
): string {
  return value ? format(parseLocalDate(value), "yyyy年MM月dd日") : emptyText;
}

export function displayCompactLocalDate(
  value: LocalDate | null | undefined,
  emptyText = "—"
): string {
  return value ?? emptyText;
}

export function addLocalDays(value: LocalDate, amount: number): LocalDate {
  return formatLocalDate(addDays(parseLocalDate(value), amount));
}

export function daysBetween(start: LocalDate, end: LocalDate): number {
  return differenceInCalendarDays(parseLocalDate(end), parseLocalDate(start));
}

export function todayLocalDate(): LocalDate {
  return formatLocalDate(new Date());
}
