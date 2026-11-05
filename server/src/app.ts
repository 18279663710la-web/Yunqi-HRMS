import express from 'express';
import cors from 'cors';

import { config } from './config';
import { errorHandler, notFoundHandler } from './shared/middleware/error';
import adminRoutes from './admin/adminRoutes';
import hrRoutes from './admin/hr/hrRoutes';
import approvalsRoutes from './miniprogram/approvals/approvalsRoutes';
import attendanceRoutes from './miniprogram/attendance/attendanceRoutes';
import authRoutes from './miniprogram/auth/authRoutes';
import companyRoutes from './miniprogram/workbench/companyRoutes';
import demoRoutes from './miniprogram/workbench/demoRoutes';
import invoicesRoutes from './miniprogram/invoices/invoicesRoutes';
import noticesRoutes from './miniprogram/notices/noticesRoutes';
import orgRoutes from './miniprogram/contacts/orgRoutes';
import todoRoutes from './miniprogram/workbench/todoRoutes';
import onboardingFormAdmin from './admin/models-formulas/onboardingFormRoutes';
import onboardingFormEmployee from './miniprogram/onboarding/onboardingFormRoutes';

export function createApp(): express.Express {
  const app = express();

  app.use(
    cors({
      origin: config.corsOrigin === '*' ? true : config.corsOrigin.split(',').map((s) => s.trim()),
      credentials: false,
    })
  );
  app.use(express.json({ limit: '5mb' }));
  app.use(express.urlencoded({ extended: true }));

  // 发票原图等静态资源
  app.use('/uploads', express.static(config.uploadDir, { maxAge: '7d' }));

  app.get('/health', (_req, res) => {
    res.json({ ok: true, service: 'yunqi-office-server', time: new Date().toISOString() });
  });

  app.use('/api/admin', adminRoutes);
  app.use('/api/admin/onboarding-form', onboardingFormAdmin);
  app.use('/api/onboarding-form', onboardingFormEmployee);
  app.use('/api/admin/hr', hrRoutes);
  app.use('/api', authRoutes);
  app.use('/api', companyRoutes);
  app.use('/api', orgRoutes);
  app.use('/api/attendance', attendanceRoutes);
  app.use('/api', approvalsRoutes);
  app.use('/api', noticesRoutes);
  app.use('/api', invoicesRoutes);
  app.use('/api', todoRoutes);
  app.use('/api', demoRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
