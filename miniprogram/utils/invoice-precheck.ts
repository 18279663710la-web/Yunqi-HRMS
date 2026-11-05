import { invoiceKey } from './invoice-identity';

interface CheckItem {
  id: string;
  status: string;
  checkState: string;
  result: { invoiceCode?: string; invoiceNumber?: string } | null;
}

export function getInvoiceCheckState(items: CheckItem[], scanning: boolean): { ready: boolean; message: string; duplicateIds: string[] } {
  if (scanning) return { ready: false, message: '扫码录入中，请完成后继续', duplicateIds: [] };
  if (!items.length) return { ready: false, message: '请先添加至少一张发票', duplicateIds: [] };
  const idsByKey = new Map<string, string[]>();
  for (const item of items) {
    const key = item.result ? invoiceKey(item.result) : '';
    if (key) idsByKey.set(key, [...(idsByKey.get(key) || []), item.id]);
  }
  const duplicateIds: string[] = [];
  idsByKey.forEach((ids) => { if (ids.length > 1) duplicateIds.push(...ids); });
  if (duplicateIds.length) return { ready: false, message: '同一张发票重复添加，请移除重复项', duplicateIds };
  if (items.some((item) => item.status === 'failed')) {
    return { ready: false, message: '请处理识别失败的发票后再继续', duplicateIds };
  }
  if (items.some((item) => item.status === 'pending' || item.status === 'recognizing' || item.checkState === 'pending' || item.checkState === 'checking' || item.checkState === 'verifying')) {
    return { ready: false, message: '发票识别、查重或真伪查验中，请稍候', duplicateIds };
  }
  if (items.some((item) => item.status !== 'done' || item.checkState !== 'clear')) {
    return { ready: false, message: '请处理未通过查重或真伪查验的发票后再继续', duplicateIds };
  }
  return { ready: true, message: '', duplicateIds };
}
