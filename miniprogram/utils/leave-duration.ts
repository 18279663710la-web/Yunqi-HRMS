/** 以自然时间差计算整天，最少一天，余数满 12 小时进一。无效或倒置时返回 null。 */
function parseMinute(date: string, time: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return null;
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  const stamp = Date.UTC(year, month - 1, day, hour, minute);
  const parsed = new Date(stamp);
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) return null;
  return stamp;
}

export function calculateLeaveDays(startDate: string, startTime: string, endDate: string, endTime: string): number | null {
  const start = parseMinute(startDate, startTime);
  const end = parseMinute(endDate, endTime);
  if (start === null || end === null || end <= start) return null;
  return Math.max(1, Math.round((end - start) / (24 * 60 * 60 * 1000)));
}
