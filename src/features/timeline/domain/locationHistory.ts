import type { LocalDate } from "../../../shared/dates/localDate";
import type { TimelineItem } from "../timeline.types";

export function timelineLocationIdAtDate(
  item: TimelineItem,
  date: LocalDate
): string | undefined {
  return (
    item.locationIntervals?.find(
      (interval) =>
        interval.startDate <= date &&
        (interval.endDate === null || date < interval.endDate)
    )?.locationId ?? item.locationId
  );
}

export function editTimelineLocationInterval(
  item: TimelineItem,
  intervalIndex: number,
  locationId: string,
  locationName: string,
  startDate: LocalDate
): TimelineItem {
  const intervals = item.locationIntervals?.map((interval) => ({ ...interval }));
  const current = intervals?.[intervalIndex];
  if (!intervals?.length || !current) throw new Error("地点历史记录不存在");
  if (!locationId) throw new Error("请选择地点");

  if (intervalIndex === 0) {
    if (startDate !== item.startDate)
      throw new Error("首段地点必须从实例启用日期开始");
  } else {
    const previous = intervals[intervalIndex - 1]!;
    if (startDate <= previous.startDate)
      throw new Error("本段开始日期必须晚于上一段开始日期");
    if (current.endDate && startDate >= current.endDate)
      throw new Error("本段开始日期必须早于本段结束日期");
    previous.endDate = startDate;
  }

  current.startDate = startDate;
  current.locationId = locationId;
  const isLast = intervalIndex === intervals.length - 1;
  return {
    ...item,
    ...(isLast ? { locationId, location: locationName } : {}),
    locationIntervals: intervals
  };
}
