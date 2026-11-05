import { resolveFileUrl, upload } from '../../utils/request';

/** 保存发票图片，不执行 OCR。 */
export async function uploadInvoiceImage(filePath: string): Promise<string> {
  const result = await upload<{ fileUrl: string }>({ url: '/invoices/image', filePath, name: 'file' });
  if (!result.fileUrl) throw { message: '发票图片保存失败，请重试' };
  return resolveFileUrl(result.fileUrl);
}
