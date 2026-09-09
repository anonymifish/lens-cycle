function validLocalDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}

export function localDateInputError(
  value: string,
  min?: string | number,
  max?: string | number
): string {
  if (!value) return "";
  if (!validLocalDate(value)) return "请输入 yyyy-MM-dd 格式的有效日期";
  if (min !== undefined && value < String(min)) return `日期不能早于 ${min}`;
  if (max !== undefined && value > String(max)) return `日期不能晚于 ${max}`;
  return "";
}

