import { Router } from 'express';
import { queryOne, queryRows, transaction } from '../../shared/db/pool';
import type { RowDataPacket } from 'mysql2';
import { requireAdmin, requireSuperAdmin } from '../admin-accounts/authMiddleware';
import { parse } from '../../shared/middleware/validate';
import { hrRecordSchemas } from './hrPolicy';
import { buildSalaryValues, readSalaryModel, validateSalaryValues } from '../../domains/payroll/salaryModelService';
import { recordAdminLog } from '../../domains/audit/adminLogService';
import { asyncHandler } from '../../shared/utils/asyncHandler';
import { badRequest, conflict, notFound } from '../../shared/utils/errors';
import { success } from '../../shared/utils/response';
import hrLifecycle from './hrLifecycleRoutes';
import hrDisbursement from './hrDisbursementRoutes';
import hrContractFiles from './hrContractFilesRoutes';
import salaryModels from '../models-formulas/salaryModelsRoutes';

const router = Router();
router.use(requireAdmin, requireSuperAdmin);
router.use(hrLifecycle);
router.use(hrDisbursement);
router.use(hrContractFiles);
router.use(salaryModels);
function json(value: unknown): unknown { return typeof value === 'string' ? JSON.parse(value) : value; }
async function employeeExists(id: string): Promise<void> {
  if (!await queryOne('SELECT id FROM employees WHERE id = ?', [id])) throw notFound('员工不存在');
}

router.get('/employees', asyncHandler(async (_req, res) => {
  const rows = await queryRows<{ id: string; name: string; employeeNo: string; position: string; departed: number }>("SELECT e.id, e.name, e.employee_no AS employeeNo, e.position, EXISTS(SELECT 1 FROM hr_employee_departures d WHERE d.employee_id = e.id AND d.status = 'departed') AS departed FROM employees e ORDER BY e.pinyin ASC");
  success(res, rows.map(({ departed, ...row }) => ({ ...row, employmentStatus: departed ? 'departed' : 'active' })));
}));
router.get('/onboarding', asyncHandler(async (_req, res) => {
  const rows = await queryRows<{ id: number; fields_json: unknown; created_at: Date; employee_id: string | null; task_count: number; completed_count: number }>('SELECT o.id, o.fields_json, o.created_at, l.employee_id, (SELECT COUNT(*) FROM hr_onboarding_tasks t WHERE t.onboarding_id = o.id) AS task_count, (SELECT COUNT(*) FROM hr_onboarding_tasks t WHERE t.onboarding_id = o.id AND t.completed = 1) AS completed_count FROM hr_onboarding o LEFT JOIN hr_onboarding_links l ON l.onboarding_id = o.id ORDER BY o.id DESC LIMIT 200');
  success(res, rows.map((row) => ({ id: row.id, fields: json(row.fields_json), createdAt: row.created_at, employeeId: row.employee_id, taskStatus: Number(row.completed_count) === 0 ? 'pending' : Number(row.completed_count) === Number(row.task_count) ? 'completed' : 'in_progress', taskCount: Number(row.task_count), completedCount: Number(row.completed_count) })));
}));
router.get('/employees/:id/:section', asyncHandler(async (req, res) => {
  const section = req.params.section as keyof typeof hrRecordSchemas;
  if (!Object.hasOwn(hrRecordSchemas, section)) throw notFound();
  await employeeExists(req.params.id);
  const row = await queryOne<{ data_json: unknown }>('SELECT data_json FROM hr_employee_records WHERE employee_id = ? AND section = ?', [req.params.id, section]);
  if (section === 'salary') {
    const data = (row ? json(row.data_json) : {}) as Record<string, unknown>;
    const model = await readSalaryModel();
    const employee = await queryOne<{ position: string }>('SELECT COALESCE(t.name, e.position) AS position FROM employees e LEFT JOIN job_titles t ON t.name = TRIM(e.position) WHERE e.id = ?', [req.params.id]);
    success(res, { ...data, jobTitle: employee?.position ?? '', modelVersion: model.version, values: buildSalaryValues(data, model) });
    return;
  }
  success(res, row ? json(row.data_json) : {});
}));
router.put('/employees/:id/:section', asyncHandler(async (req, res) => {
  const section = req.params.section as keyof typeof hrRecordSchemas;
  if (!Object.hasOwn(hrRecordSchemas, section)) throw notFound();
  if (section === 'profile') throw badRequest('个人信息来自已封存的入职申请，不允许修改');
  await employeeExists(req.params.id);
  let data = parse<Record<string, unknown>>(hrRecordSchemas[section], req.body);
  const fallbackModel = section === 'salary' ? await readSalaryModel() : null;
  await transaction(async (conn) => {
    if (section === 'salary' && fallbackModel) {
      await conn.execute('INSERT INTO hr_settings (setting_key, value_json, updated_at) VALUES (?, ?, NOW()) ON DUPLICATE KEY UPDATE setting_key = VALUES(setting_key)', ['salary_component_model', JSON.stringify(fallbackModel)]);
      const model = await readSalaryModel(conn, true);
      if (data.values !== undefined) {
        if (typeof data.modelVersion === 'number' && data.modelVersion !== model.version) throw conflict('薪资模型已更新，请刷新后重试');
        const validated = validateSalaryValues(data.values as Record<string, number | string | null>, model);
        data = { ...data, values: validated.values, base: validated.base, allowance: validated.allowance, performance: validated.performance, modelVersion: model.version };
      }
    }
    await conn.query('SELECT id FROM employees WHERE id = ? FOR UPDATE', [req.params.id]);
    if (section === 'contract' || section === 'salary') {
      const [old] = await conn.query<RowDataPacket[]>('SELECT data_json, updated_at FROM hr_employee_records WHERE employee_id = ? AND section = ?', [req.params.id, section]);
      if (section === 'salary' && !Object.hasOwn(req.body, 'attendanceRules')) {
        const existing = old.length ? json(old[0].data_json) as { attendanceRules?: unknown } : {};
        data = { ...data, attendanceRules: Array.isArray(existing.attendanceRules) ? existing.attendanceRules : [] };
      }
      const [history] = await conn.query<RowDataPacket[]>('SELECT id FROM hr_employee_history WHERE employee_id = ? AND section = ? LIMIT 1', [req.params.id, section]);
      if (old.length && !history.length) await conn.execute('INSERT INTO hr_employee_history (employee_id, section, data_json, created_at) VALUES (?, ?, ?, ?)', [req.params.id, section, JSON.stringify(json(old[0].data_json)), old[0].updated_at]);
      await conn.execute('INSERT INTO hr_employee_history (employee_id, section, data_json, created_at) VALUES (?, ?, ?, NOW())', [req.params.id, section, JSON.stringify(data)]);
    }
    await conn.execute('INSERT INTO hr_employee_records (employee_id, section, data_json, updated_at) VALUES (?, ?, ?, NOW()) ON DUPLICATE KEY UPDATE data_json = VALUES(data_json), updated_at = NOW()', [req.params.id, section, JSON.stringify(data)]);
  });
  await recordAdminLog(req.admin!, '修改人事资料', 'hr_employee_records', req.params.id, { section });
  success(res, data);
}));
router.use((_req, res) => {
  res.status(404).json({ code: 404, message: '接口不存在' });
});
export default router;
