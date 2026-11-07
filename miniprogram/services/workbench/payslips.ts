import { downloadAuthenticatedFile, get, getCachedUser, post } from '../../utils/request';

export interface Payslip { id: number; month: string; revision: number; read: boolean; sentAt: string }
export const listPayslips = (silent = false): Promise<Payslip[]> => get<Payslip[]>('/payslips', undefined, { silent });

/** 使用微信 PDF 查看器菜单供员工保存或分享文件。 */
export async function openPayslip(item: Payslip): Promise<void> {
  const employeeId = getCachedUser()?.id;
  if (!employeeId) throw { message: '请重新登录' };
  const path = await downloadAuthenticatedFile(`/payslips/${item.id}/pdf`);
  if (getCachedUser()?.id !== employeeId) throw { message: '登录账号已变更，请重试' };
  await new Promise<void>((resolve, reject) => wx.openDocument({ filePath: path, fileType: 'pdf', showMenu: true, success: () => resolve(), fail: () => reject({ message: '无法打开工资条，请重试' }) }));
  if (getCachedUser()?.id !== employeeId) return;
  if (!item.read) await post(`/payslips/${item.id}/read`, { revision: item.revision }, { silent: true });
}
