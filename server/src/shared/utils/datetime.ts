const WEEKDAYS = '日一二三四五六';

export function pad(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

/** 本地日期 -> YYYY-MM-DD */
export function dateKey(d: Date = new Date()): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** YYYY-MM-DD -> 本地零点的 Date */
export function parseDateKey(key: string): Date {
  return new Date(`${key}T00:00:00`);
}

export function weekdayCn(d: Date): string {
  return `周${WEEKDAYS[d.getDay()]}`;
}

export function weekdayFullCn(d: Date): string {
  return `星期${WEEKDAYS[d.getDay()]}`;
}

/** 支持 YYYY MM DD HH mm ss W，与小程序端 util.formatTime 输出一致 */
export function formatTime(date: Date | string | number, fmt = 'YYYY-MM-DD HH:mm'): string {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  const map: Record<string, string | number> = {
    YYYY: d.getFullYear(),
    MM: pad(d.getMonth() + 1),
    DD: pad(d.getDate()),
    HH: pad(d.getHours()),
    mm: pad(d.getMinutes()),
    ss: pad(d.getSeconds()),
    W: WEEKDAYS[d.getDay()],
  };
  return fmt.replace(/YYYY|MM|DD|HH|mm|ss|W/g, (key) => String(map[key]));
}

/** MySQL DATETIME 字符串（YYYY-MM-DD HH:mm:ss）-> 页面展示用的 YYYY-MM-DD HH:mm */
export function toMinuteText(value: string | Date): string {
  if (value instanceof Date) return formatTime(value, 'YYYY-MM-DD HH:mm');
  return String(value).slice(0, 16);
}

/** 判断工作日（周一至周五） */
export function isWorkday(d: Date): boolean {
  const w = d.getDay();
  return w !== 0 && w !== 6;
}

/** 计算 'HH:mm' 到 'HH:mm' 的时长文案，与原实现一致 */
export function calcDuration(start: string, end: string): string {
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  let mins = eh * 60 + em - (sh * 60 + sm);
  if (mins < 0) mins += 1440;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h}h${m > 0 ? `${m}m` : ''}`;
}

/** 稳定伪随机：同一天的数据多次读取保持一致 */
export function seededRand(n: number): number {
  const x = Math.sin(n * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}
