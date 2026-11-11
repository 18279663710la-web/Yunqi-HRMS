import dayjs, { type Dayjs } from 'dayjs';

export type DateRangeValue = [Dayjs, Dayjs];

const MAX_RANGE_DAYS = 3660;

/** 将起止日期范围展开为去重、升序的日期数组；起止同日只生成一天。 */
export function expandDateRanges(ranges: Array<DateRangeValue | null | undefined> | undefined): string[] {
  const result = new Set<string>();
  for (const range of ranges || []) {
    if (!range || !range[0] || !range[1]) continue;
    let start = range[0].startOf('day');
    let end = range[1].startOf('day');
    if (end.isBefore(start)) [start, end] = [end, start];
    for (let cursor = start; !cursor.isAfter(end, 'day'); cursor = cursor.add(1, 'day')) {
      if (cursor.diff(start, 'day') > MAX_RANGE_DAYS) break;
      result.add(cursor.format('YYYY-MM-DD'));
    }
  }
  return Array.from(result).sort();
}

/** 将连续日期合并为起止范围，供编辑时回显；单日范围起止相同。 */
export function mergeDatesToRanges(dates: string[]): DateRangeValue[] {
  const unique = Array.from(new Set(dates.filter(Boolean))).sort();
  const ranges: DateRangeValue[] = [];
  let start: string | null = null;
  let previous: string | null = null;
  for (const date of unique) {
    if (!start) {
      start = date;
      previous = date;
      continue;
    }
    if (previous && dayjs(date).diff(dayjs(previous), 'day') === 1) {
      previous = date;
      continue;
    }
    ranges.push([dayjs(start), dayjs(previous as string)]);
    start = date;
    previous = date;
  }
  if (start) ranges.push([dayjs(start), dayjs(previous as string)]);
  return ranges;
}
