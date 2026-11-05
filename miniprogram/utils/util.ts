/**
 * utils/util.ts — 通用工具函数（TypeScript）
 */

export const pad = (n: number): string => (n < 10 ? `0${n}` : `${n}`);

/**
 * 格式化时间
 * 支持 YYYY MM DD HH mm ss W
 */
export function formatTime(date: Date | number | string, fmt = 'YYYY-MM-DD HH:mm'): string {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  const map: Record<string, string | number> = {
    YYYY: d.getFullYear(),
    MM: pad(d.getMonth() + 1),
    DD: pad(d.getDate()),
    HH: pad(d.getHours()),
    mm: pad(d.getMinutes()),
    ss: pad(d.getSeconds()),
    W: '日一二三四五六'[d.getDay()],
  };
  return fmt.replace(/YYYY|MM|DD|HH|mm|ss|W/g, (key) => String(map[key]));
}

/** 友好时间：刚刚 / x分钟前 / 今天 HH:mm / 昨天 HH:mm / MM-DD */
export function fromNow(date: Date | number | string): string {
  const d = date instanceof Date ? date : new Date(date);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  if (diff < 60 * 1000) return '刚刚';
  if (diff < 60 * 60 * 1000) return `${Math.floor(diff / 60000)} 分钟前`;

  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) return `今天 ${formatTime(d, 'HH:mm')}`;

  const yesterday = new Date(now.getTime() - 86400000);
  const isYesterday =
    d.getFullYear() === yesterday.getFullYear() &&
    d.getMonth() === yesterday.getMonth() &&
    d.getDate() === yesterday.getDate();
  if (isYesterday) return `昨天 ${formatTime(d, 'HH:mm')}`;

  return formatTime(d, 'MM-DD HH:mm');
}

/** 根据当前小时返回问候语 */
export function getGreeting(): string {
  const h = new Date().getHours();
  if (h < 6) return '夜深了';
  if (h < 9) return '早上好';
  if (h < 12) return '上午好';
  if (h < 14) return '中午好';
  if (h < 18) return '下午好';
  if (h < 23) return '晚上好';
  return '夜深了';
}

/** 取姓名首字，用于头像占位 */
export function nameInitial(name = ''): string {
  return name ? name.slice(0, 1) : '?';
}

/** Promise 版 sleep */
export function delay(ms = 260): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 深拷贝（仅处理 JSON 安全数据） */
export function clone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj)) as T;
}

/** 生成唯一 id */
export function uid(prefix = 'ID'): string {
  return `${prefix}${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`;
}

/** 计算两个 YYYY-MM-DD 之间的天数 */
export function daysBetween(start: string, end: string): number {
  const s = new Date(`${start}T00:00:00`);
  const e = new Date(`${end}T00:00:00`);
  return Math.round((e.getTime() - s.getTime()) / 86400000) + 1;
}

/** 展示用手机号格式化：13888886688 -> 138 8888 6688 */
export function formatPhone(phone = ''): string {
  const raw = String(phone).replace(/\D/g, '');
  if (raw.length !== 11) return phone;
  return `${raw.slice(0, 3)} ${raw.slice(3, 7)} ${raw.slice(7)}`;
}

/** 轻提示 */
export function toast(
  title: string,
  icon: 'none' | 'success' | 'error' | 'loading' = 'none'
): void {
  wx.showToast({ title, icon, duration: 1800 });
}
