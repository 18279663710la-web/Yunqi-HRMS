import { Router } from 'express';
import { z } from 'zod';
import { execute, queryOne, queryRows, transaction } from '../../shared/db/pool';
import type { RowDataPacket } from 'mysql2';
import { requireAdmin, requireSuperAdmin } from '../admin-accounts/authMiddleware';
import { parse } from '../../shared/middleware/validate';
import { hrRecordSchemas, onboardingFieldsSchema } from './hrPolicy';
import { addOnboardingTask, completionSchema, confirmOnboarding, onboardingEmployeeSchema, setOnboardingTask, taskSchema } from './hrOnboardingService';
import { buildSalaryValues, readSalaryModel, validateSalaryValues } from '../../domains/payroll/salaryModelService';
import { recordAdminLog } from '../../domains/audit/adminLogService';
import { asyncHandler } from '../../shared/utils/asyncHandler';
import { badRequest, conflict, notFound } from '../../shared/utils/errors';
import { success } from '../../shared/utils/response';
import hrLifecycle from './hrLifecycleRoutes';
import hrDisbursement from './hrDisbursementRoutes';
import hrContractFiles from './hrContractFilesRoutes';
import payrollWorkflow from '../models-formulas/payrollWorkflowRoutes';
import salaryModels from '../models-formulas/salaryModelsRoutes';
import { assertJobTitle } from '../../domains/employees/jobTitleService';

const router = Router();
router.use(requireAdmin, requireSuperAdmin);
router.use(hrLifecycle);
router.use(hrDisbursement);
router.use(hrContractFiles);
router.use(salaryModels);
router.use(payrollWorkflow);
const defaultFields = ['姓名', '联系电话', '应聘职位', '预计入职日期'];
function json(value: unknown): unknown { return typeof value === 'string' ? JSON.parse(value) : value; }
async function employeeExists(id: string): Promise<void> {
  if (!await queryOne('SELECT id FROM employees WHERE id = ?', [id])) throw notFound('员工不存在');
}

router.get('/employees', asyncHandler(async (_req, res) => {
  const rows = await queryRows<{ id: string; name: string; employeeNo: string; position: string; departed: number }>("SELECT e.id, e.name, e.employee_no AS employeeNo, e.position, EXISTS(SELECT 1 FROM hr_employee_departures d WHERE d.employee_id = e.id AND d.status = 'departed') AS departed FROM employees e ORDER BY e.pinyin ASC");
  success(res, rows.map(({ departed, ...row }) => ({ ...row, employmentStatus: departed ? 'departed' : 'active' })));
}));
router.get('/onboarding/fields', asyncHandler(async (_req, res) => {
  const row = await queryOne<{ value_json: unknown }>("SELECT value_json FROM hr_settings WHERE setting_key = 'onboarding_fields'");
  success(res, row ? json(row.value_json) : defaultFields);
}));
router.put('/onboarding/fields', asyncHandler(async (req, res) => {
  const fields = parse(onboardingFieldsSchema, req.body);
  await execute("INSERT INTO hr_settings (setting_key, value_json, updated_at) VALUES ('onboarding_fields', ?, NOW()) ON DUPLICATE KEY UPDATE value_json = VALUES(value_json), updated_at = NOW()", [JSON.stringify(fields)]);
  await recordAdminLog(req.admin!, '修改入职申请表', 'hr_settings', 'onboarding_fields', {});
  success(res, fields);
}));
router.get('/onboarding', asyncHandler(async (_req, res) => {
  const rows = await queryRows<{ id: number; fields_json: unknown; created_at: Date; employee_id: string | null; task_count: number; completed_count: number }>('SELECT o.id, o.fields_json, o.created_at, l.employee_id, (SELECT COUNT(*) FROM hr_onboarding_tasks t WHERE t.onboarding_id = o.id) AS task_count, (SELECT COUNT(*) FROM hr_onboarding_tasks t WHERE t.onboarding_id = o.id AND t.completed = 1) AS completed_count FROM hr_onboarding o LEFT JOIN hr_onboarding_links l ON l.onboarding_id = o.id ORDER BY o.id DESC LIMIT 200');
  success(res, rows.map((row) => ({ id: row.id, fields: json(row.fields_json), createdAt: row.created_at, employeeId: row.employee_id, taskStatus: Number(row.completed_count) === 0 ? 'pending' : Number(row.completed_count) === Number(row.task_count) ? 'completed' : 'in_progress', taskCount: Number(row.task_count), completedCount: Number(row.completed_count) })));
}));
router.post('/onboarding', asyncHandler(async (req, res) => {
  const input = parse(z.record(z.string().max(30), z.string().trim().max(200)), req.body);
  const settings = await queryOne<{ value_json: unknown }>("SELECT value_json FROM hr_settings WHERE setting_key = 'onboarding_fields'");
  const fields = parse(onboardingFieldsSchema, settings ? json(settings.value_json) : defaultFields);
  if (Object.keys(input).length !== fields.length || fields.some((field) => !input[field])) throw badRequest('请填写当前入职申请表的全部字段');
  const result = await execute('INSERT INTO hr_onboarding (fields_json, created_at) VALUES (?, NOW())', [JSON.stringify(input)]);
  await recordAdminLog(req.admin!, '登记入职申请', 'hr_onboarding', String(result.insertId), {});
  success(res, { id: result.insertId });
}));
router.get('/onboarding/:id/tasks', asyncHandler(async (req, res) => {
  if (!await queryOne('SELECT id FROM hr_onboarding WHERE id = ?', [req.params.id])) throw notFound('入职申请不存在');
  const rows = await queryRows<{ id: number; title: string; description: string; startDate: string | null; endDate: string | null; required: number; completed: number }>('SELECT id, title, description, start_date AS startDate, end_date AS endDate, required, completed FROM hr_onboarding_tasks WHERE onboarding_id = ? ORDER BY id', [req.params.id]);
  success(res, rows.map((row) => ({ ...row, required: !!row.required, completed: !!row.completed })));
}));
router.post('/onboarding/:id/tasks', asyncHandler(async (req, res) => {
  const result = await addOnboardingTask(req.params.id, parse(taskSchema, req.body));
  await recordAdminLog(req.admin!, '添加入职任务', 'hr_onboarding', req.params.id, {});
  success(res, result);
}));
router.patch('/onboarding/:id/tasks/:taskId', asyncHandler(async (req, res) => {
  const body = parse(completionSchema, req.body);
  await setOnboardingTask(req.params.id, req.params.taskId, body.completed);
  await recordAdminLog(req.admin!, '更新入职任务', 'hr_onboarding', req.params.id, {});
  success(res, {});
}));
router.post('/onboarding/:id/confirm', asyncHandler(async (req, res) => {
  const result = await confirmOnboarding(req.params.id, parse(onboardingEmployeeSchema, req.body));
  await recordAdminLog(req.admin!, '确认入职并建档', 'hr_onboarding', req.params.id, { employeeId: result.employeeId });
  success(res, result);
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
  const jobTitle = section === 'salary' && Object.hasOwn(req.body, 'jobTitle')
    ? parse(z.string().trim().min(1).max(100), req.body.jobTitle) : undefined;
  const fallbackModel = section === 'salary' ? await readSalaryModel() : null;
  await transaction(async (conn) => {
    if (jobTitle !== undefined) await assertJobTitle(conn, jobTitle);
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
    if (jobTitle !== undefined) await conn.execute('UPDATE employees SET position = ? WHERE id = ?', [jobTitle, req.params.id]);
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
  await recordAdminLog(req.admin!, '修改人事资料', 'hr_employee_records', req.params.id, { section, ...(jobTitle === undefined ? {} : { jobTitle }) });
  success(res, data);
}));
export default router;
