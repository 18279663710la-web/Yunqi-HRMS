import { resolveFileUrl, upload } from '../../utils/request';

/** 保存发票图片，不执行 OCR。fileUrl 用于提交，previewUrl 用于当前页面预览。 */
export async function uploadInvoiceImage(filePath: string): Promise<{ fileUrl: string; previewUrl: string }> {
  const result = await upload<{ fileUrl: string; previewUrl: string }>({ url: '/invoices/image', filePath, name: 'file' });
  if (!result.fileUrl || !result.previewUrl) throw { message: '发票图片保存失败，请重试' };
  return { fileUrl: result.fileUrl, previewUrl: resolveFileUrl(result.previewUrl) };
}
