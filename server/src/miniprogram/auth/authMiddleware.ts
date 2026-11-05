import type { RequestHandler } from 'express';

import { verifyToken } from './authService';
import { getCurrentUserById } from '../../domains/employees/userService';
import { forbidden, HttpError, unauthorized } from '../../shared/utils/errors';
import { requireActiveEmployeeSession } from '../../domains/accounts/employeeSessionService';
import { queryOne } from '../../shared/db/pool';

export const requireAuth: RequestHandler = (req, _res, next) => {
  void (async () => {
    try {
      const header = req.headers.authorization || '';
      const match = /^Bearer\s+(.+)$/i.exec(header);
      if (!match) throw unauthorized();
      const employeeId = verifyToken(match[1], 'access');
      await requireActiveEmployeeSession(employeeId, match[1]);
      const user = await getCurrentUserById(employeeId);
      if (!user) throw unauthorized();
      if (user.isChairperson) {
        const path = req.originalUrl.split('?')[0];
        const allowed = req.method === 'GET'
          ? path === '/api/me' || path === '/api/approvals' || (!['/api/approvals/leave-approver', '/api/approvals/expense-approver'].includes(path) && /^\/api\/approvals\/[A-Za-z0-9_-]+$/.test(path))
          : req.method === 'POST' && /^\/api\/approvals\/[A-Za-z0-9_-]+\/action$/.test(path);
        if (!allowed) throw forbidden('董事长账号仅用于审批分配给自己的申请');
      } else {
        const path = req.originalUrl.split('?')[0];
        const allowed = (req.method === 'GET' && (path === '/api/me' || path === '/api/onboarding-form/pending')) || (req.method === 'POST' && path === '/api/onboarding-form/submit');
        if (!allowed && await queryOne('SELECT id FROM hr_self_onboarding WHERE employee_id = ? AND submitted_at IS NULL LIMIT 1', [employeeId])) throw new HttpError(403, 40301, '请先提交入职信息');
      }
      req.user = user;
      next();
    } catch (err) {
      next(err);
    }
  })();
};
