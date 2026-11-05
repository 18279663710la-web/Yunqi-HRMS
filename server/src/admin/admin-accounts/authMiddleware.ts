import type { RequestHandler } from 'express';

import { getAdminById, verifyAdminToken } from './adminAuthService';
import { forbidden, unauthorized } from '../../shared/utils/errors';

export const requireAdmin: RequestHandler = (req, _res, next) => {
  void (async () => {
    try {
      const header = req.headers.authorization || '';
      const match = /^Bearer\s+(.+)$/i.exec(header);
      if (!match) throw unauthorized();
      const adminId = verifyAdminToken(match[1]);
      const admin = await getAdminById(adminId);
      if (!admin) throw unauthorized();
      if (!admin.status) throw forbidden('该管理员账号已被禁用');
      req.admin = admin;
      next();
    } catch (err) {
      next(err);
    }
  })();
};

export const requireSuperAdmin: RequestHandler = (req, _res, next) => {
  if (!req.admin) {
    next(unauthorized());
    return;
  }
  if (req.admin.role !== 'super_admin') {
    next(forbidden('只有超级管理员可以执行该操作'));
    return;
  }
  next();
};
