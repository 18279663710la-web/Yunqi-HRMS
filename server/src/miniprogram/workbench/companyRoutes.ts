import { Router } from 'express';

import { requireAuth } from '../auth/authMiddleware';
import { queryRows } from '../../shared/db/pool';
import { getCompany } from '../../domains/employees/userService';
import type { ApprovalType, QuickAction } from '../../shared/types/models';
import { asyncHandler } from '../../shared/utils/asyncHandler';
import { success } from '../../shared/utils/response';

const router = Router();
router.use(requireAuth);

router.get(
  '/company',
  asyncHandler(async (_req, res) => {
    success(res, await getCompany());
  })
);

interface QuickActionRow {
  key: string;
  name: string;
  icon: string;
  color: string;
  url: string;
  is_tab: number;
}

router.get(
  '/quick-actions',
  asyncHandler(async (_req, res) => {
    const rows = await queryRows<QuickActionRow>('SELECT * FROM quick_actions ORDER BY sort_order');
    const list: QuickAction[] = rows.map((r) => ({
      key: r.key,
      name: r.name,
      icon: r.icon,
      color: r.color,
      url: r.url,
      tab: !!r.is_tab,
    }));
    success(res, list);
  })
);

interface ApprovalTypeRow {
  key: string;
  name: string;
  color: string;
  description: string;
  fields_json: string | ApprovalType['fields'];
}

router.get(
  '/approval-types',
  asyncHandler(async (_req, res) => {
    const rows = await queryRows<ApprovalTypeRow>('SELECT * FROM approval_types ORDER BY sort_order');
    const list: ApprovalType[] = rows.map((r) => ({
      key: r.key,
      name: r.name,
      color: r.color,
      desc: r.description,
      fields: typeof r.fields_json === 'string' ? JSON.parse(r.fields_json) : r.fields_json,
    }));
    success(res, list);
  })
);

export default router;
