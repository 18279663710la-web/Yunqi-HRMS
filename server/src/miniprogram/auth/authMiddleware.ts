import type { RequestHandler } from 'express';

import { verifyToken } from './authService';
import { getCurrentUserById } from '../../domains/employees/userService';
import { HttpError, unauthorized } from '../../shared/utils/errors';
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
      const path = req.originalUrl.split('?')[0];
      const allowed = (req.method === 'GET' && (path === '/api/me' || path === '/api/onboarding-form/pending')) || (req.method === 'POST' && (path === '/api/onboarding-form/submit' || path === '/api/onboarding-form/attachments')) || (req.method === 'DELETE' && /^\/api\/onboarding-form\/attachments\/[0-9a-f-]{36}$/i.test(path));
      if (!allowed && await queryOne('SELECT id FROM hr_self_onboarding WHERE employee_id = ? AND submitted_at IS NULL LIMIT 1', [employeeId])) throw new HttpError(403, 40301, '请先提交入职信息');
      req.user = user;
      next();
    } catch (err) {
      next(err);
    }
  })();
};
