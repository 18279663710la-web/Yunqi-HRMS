type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
export interface DisbursementPosition { month: string; batchId: number; scrollLeft: number }
const key = 'payroll-disbursement-position-v1';

export function disbursementStorage(): StorageLike | undefined {
  try { return typeof window === 'undefined' ? undefined : window.sessionStorage; } catch { return undefined; }
}

export function readDisbursementPosition(storage?: StorageLike): DisbursementPosition | undefined {
  try {
    const raw = storage?.getItem(key);
    if (!raw) return undefined;
    const data: unknown = JSON.parse(raw);
    if (!data || typeof data !== 'object') return undefined;
    const value = data as Partial<DisbursementPosition>;
    if (typeof value.month !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(value.month) || !Number.isSafeInteger(value.batchId) || Number(value.batchId) <= 0 || typeof value.scrollLeft !== 'number' || !Number.isFinite(value.scrollLeft) || value.scrollLeft < 0) return undefined;
    return { month: value.month, batchId: value.batchId!, scrollLeft: value.scrollLeft };
  } catch { return undefined; }
}

export function rememberDisbursementBatch(storage: StorageLike | undefined, month: string, batchId: number): void {
  try {
    const previous = readDisbursementPosition(storage);
    storage?.setItem(key, JSON.stringify({ month, batchId, scrollLeft: previous?.batchId === batchId && previous.month === month ? previous.scrollLeft : 0 }));
  } catch { /* 存储不可用时仍允许正常使用页面。 */ }
}

export function rememberDisbursementScroll(storage: StorageLike | undefined, batchId: number, scrollLeft: number): void {
  try {
    const current = readDisbursementPosition(storage);
    if (current?.batchId === batchId && Number.isFinite(scrollLeft) && scrollLeft >= 0) storage?.setItem(key, JSON.stringify({ ...current, scrollLeft }));
  } catch { /* 存储不可用时仍允许正常使用页面。 */ }
}

export function clearDisbursementPosition(storage?: StorageLike): void {
  try { storage?.removeItem(key); } catch { /* 存储不可用时无需处理。 */ }
}
