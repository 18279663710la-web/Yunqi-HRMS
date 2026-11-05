import type { AdminUser } from '../shared/types/admin';

export function adminOf(req: { admin?: AdminUser }): AdminUser {
  if (!req.admin) throw new Error('管理员上下文缺失');
  return req.admin;
}
