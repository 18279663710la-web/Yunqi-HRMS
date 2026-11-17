import express, { Router } from 'express';
import cors from 'cors';

import { config } from './config';
import { corsAllowedOrigins } from './shared/middleware/corsOrigin';
import { errorHandler, notFoundHandler } from './shared/middleware/error';
import { logRequest, logSystem } from './shared/logging/logger';
import adminRoutes from './admin/adminRoutes';
import hrRoutes from './admin/hr/hrRoutes';
import approvalsRoutes from './miniprogram/approvals/approvalsRoutes';
import approvalFileRoutes from './miniprogram/approvals/approvalFileRoutes';
import attendanceRoutes from './miniprogram/attendance/attendanceRoutes';
import authRoutes from './miniprogram/auth/authRoutes';
import companyRoutes from './miniprogram/workbench/companyRoutes';
import invoicesRoutes from './miniprogram/invoices/invoicesRoutes';
import noticesRoutes from './miniprogram/notices/noticesRoutes';
import orgRoutes from './miniprogram/contacts/orgRoutes';
import todoRoutes from './miniprogram/workbench/todoRoutes';
import onboardingFormAdmin from './admin/models-formulas/onboardingFormRoutes';
import companyCalendarAdmin from './admin/models-formulas/companyCalendarRoutes';
import payslipRoutes from './miniprogram/workbench/payslipRoutes';
import onboardingFormEmployee from './miniprogram/onboarding/onboardingFormRoutes';
import { createU9AdminRouter } from './admin/employees/u9Routes';
import { createU9BusinessRouter } from './miniprogram/business/u9Routes';
import { createEmployeeU9Gateway } from './domains/u9/createGateway';
import { requireAdmin, requireSuperAdmin } from './admin/admin-accounts/authMiddleware';

export function createApp(): express.Express {
  const app = express();
  // 部署在 Nginx 之后时，按 X-Forwarded-For 还原真实来源地址；只信任本机回环代理，
  // 否则登录失败计数会把所有用户都记成 127.0.0.1，导致全站登录被锁。
  app.set('trust proxy', 'loopback');

  const allowedOrigins = new Set(corsAllowedOrigins(config.corsOrigin));
  app.use(
    cors({
      origin(origin, callback) {
        if (!origin || allowedOrigins.has(origin)) {
          callback(null, true);
          return;
        }
        callback(null, false);
      },
      credentials: false,
    })
  );
  app.use(express.json({ limit: '5mb' }));
  app.use(express.urlencoded({ extended: true }));

  // 报销原图只通过短期签名地址提供，不公开 /uploads。

  // 请求日志：按管理端/小程序端业务模块写入 server/logs，便于排错；
  // 不记录查询参数，避免签名地址、令牌等敏感内容落盘。
  app.use((req, res, next) => {
    const startedAt = Date.now();
    res.on('finish', () => {
      const pathname = req.originalUrl.split('?')[0];
      if (pathname === '/health') {
        logSystem('health', res.statusCode >= 400 ? 'warn' : 'info', `${req.method} ${pathname} ${res.statusCode} ${Date.now() - startedAt}ms`, { ip: req.ip });
        return;
      }
      if (!pathname.startsWith('/api')) return;
      logRequest(req, res.statusCode, Date.now() - startedAt);
    });
    next();
  });

  app.get('/health', (_req, res) => {
    res.json({ ok: true, service: 'yunqi-office-server', time: new Date().toISOString() });
  });

  app.use('/api/admin', adminRoutes);
  const u9Gateway = createEmployeeU9Gateway();
  app.use('/api/admin/u9', requireAdmin, createU9AdminRouter(u9Gateway));
  app.use('/api/business', createU9BusinessRouter(u9Gateway));
  app.use('/api/admin/onboarding-form', onboardingFormAdmin);
  const removedOffboardingForm = Router();
  removedOffboardingForm.use(requireAdmin, requireSuperAdmin, (_req, res) => {
    res.status(404).json({ code: 404, message: '接口不存在' });
  });
  app.use('/api/admin/offboarding-form', removedOffboardingForm);
  app.use('/api/admin/models-formulas', companyCalendarAdmin);
  app.use('/api/onboarding-form', onboardingFormEmployee);
  app.use('/api/admin/hr', hrRoutes);
  app.use('/api', authRoutes);
  // 签名地址不带登录头。必须排在会拦截全部 /api 请求的鉴权路由之前。
  app.use('/api/approval-files', approvalFileRoutes);
  app.use('/api', companyRoutes);
  app.use('/api', orgRoutes);
  app.use('/api/attendance', attendanceRoutes);
  app.use('/api/payslips', payslipRoutes);
  app.use('/api', approvalsRoutes);
  app.use('/api', noticesRoutes);
  app.use('/api', invoicesRoutes);
  app.use('/api', todoRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
