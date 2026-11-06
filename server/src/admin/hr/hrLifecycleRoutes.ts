import { Router } from 'express';
import { z } from 'zod';
import type { ResultSetHeader, RowDataPacket } from 'mysql2';
import { execute, queryOne, queryRows, transaction } from '../../shared/db/pool';
import { parse } from '../../shared/middleware/validate';
import { recordAdminLog } from '../../domains/audit/adminLogService';
import { asyncHandler } from '../../shared/utils/asyncHandler';
import { badRequest, conflict, notFound } from '../../shared/utils/errors';
import { attendanceRulesSchema, payrollAttendanceRulesSchema } from './hrPolicy';
import { calculateExtendedSalary, calculateFixedIncome, type PayrollModelSnapshot } from '../../domains/payroll/payrollModelCalculation';
import { syncDraftBatch } from '../../domains/payroll/payrollDraftSync';
import { addAutoPayrollItems, previewAutoPayrollItems } from '../../domains/payroll/payrollAutoService';
import { success } from '../../shared/utils/response';
import { taskSchema, completionSchema } from './hrOnboardingService';
import { cancelTransition, listTransitions, submitTransition, transitionSchema } from './hrTransitionService';
import { cancelDeparture, finalizeDeparture } from './hrDepartureService';
import { overtimeRuleConfigSchema, overtimeRulesKey, overtimeRulesSchema } from '../../domains/payroll/overtimePayrollService';
import { OVERTIME_RULE_CONFIG_KEY, readOvertimeRuleConfig, saveOvertimeRuleConfig } from '../../domains/payroll/overtimeRuleConfigRepository';
import { attendanceRangeRuleConfigSchema, attendanceRuleConfigSchema } from '../../domains/payroll/attendanceRuleConfig';
import { ATTENDANCE_RULE_CONFIG_KEY, readAttendanceRuleConfig, saveAttendanceRuleConfig } from '../../domains/payroll/attendanceRuleConfigRepository';

const router = Router();
const monthSchema = z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/) });
const batchIdSchema = z.coerce.number().int().positive();
const employeeId = z.string().trim().min(1).max(10);
const eventSchema = z.object({ employeeId, type: z.enum(['转正', '调岗', '调薪', '其他']), effectiveDate: z.string().date(), note: z.string().trim().max(500).default('') });
const exitSchema = z.object({ employeeId, lastDate: z.string().date(), note: z.string().trim().max(500).default('') });
const templateTaskSchema = taskSchema.extend({ description: z.string().trim().max(500).default(''), beginOn: z.number().int().min(-3650).max(3650).nullable().optional(), duration: z.number().int().min(0).max(3650).nullable().optional() }).refine((task) => task.duration == null || task.beginOn != null, '填写持续天数时必须填写开始偏移');
const templateSchema = z.array(templateTaskSchema).max(30).refine((tasks) => new Set(tasks.map((t) => t.title)).size === tasks.length, '任务名称不能重复');
const applyTemplateSchema = z.object({ startDate: z.string().date().optional() });
const json = (value: unknown) => typeof value === 'string' ? JSON.parse(value) : value;
function scheduledDate(base: string, days: number, holidays: Set<string>): string {
  const date = new Date(`${base}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  let value = date.toISOString().slice(0, 10);
  while (holidays.has(value)) { date.setUTCDate(date.getUTCDate() + 1); value = date.toISOString().slice(0, 10); }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value < '1000-01-01' || value > '9999-12-31') throw badRequest('任务计划日期超出支持范围');
  return value;
}
async function employeeExists(id: string) { if (!await queryOne('SELECT id FROM employees WHERE id = ?', [id])) throw notFound('员工不存在'); }

router.get('/employee-transitions', asyncHandler(async (req, res) => {
  success(res, await listTransitions(parse(employeeId, req.query.employeeId)));
}));
router.post('/employee-transitions', asyncHandler(async (req, res) => {
  const input = parse(transitionSchema, req.body);
  const result = await submitTransition(input, req.admin!.id);
  await recordAdminLog(req.admin!, '提交人事异动', 'hr_employee_transitions', String(result.id), { employeeId: input.employeeId, type: input.type });
  success(res, result);
}));
router.post('/employee-transitions/:id/cancel', asyncHandler(async (req, res) => {
  await cancelTransition(req.params.id, req.admin!.id);
  await recordAdminLog(req.admin!, '撤销人事异动', 'hr_employee_transitions', req.params.id, {});
  success(res, {});
}));

router.get('/onboarding/task-template', asyncHandler(async (_req, res) => {
  const row = await queryOne<{ value_json: unknown }>("SELECT value_json FROM hr_settings WHERE setting_key = 'onboarding_tasks'");
  success(res, row ? json(row.value_json) : []);
}));
router.put('/onboarding/task-template', asyncHandler(async (req, res) => {
  const value = parse(templateSchema, req.body);
  await execute("INSERT INTO hr_settings (setting_key, value_json, updated_at) VALUES ('onboarding_tasks', ?, NOW()) ON DUPLICATE KEY UPDATE value_json = VALUES(value_json), updated_at = NOW()", [JSON.stringify(value)]);
  await recordAdminLog(req.admin!, '修改入职任务模板', 'hr_settings', 'onboarding_tasks', {}); success(res, value);
}));
router.post('/onboarding/:id/apply-template', asyncHandler(async (req, res) => {
  const input = parse(applyTemplateSchema, req.body);
  await transaction(async (conn) => {
    const [apps] = await conn.query<RowDataPacket[]>('SELECT id FROM hr_onboarding WHERE id = ? FOR UPDATE', [req.params.id]);
    if (!apps.length) throw notFound('入职申请不存在');
    const [links] = await conn.query<RowDataPacket[]>('SELECT employee_id FROM hr_onboarding_links WHERE onboarding_id = ?', [req.params.id]);
    if (links.length) throw badRequest('已建档的申请不能修改任务');
    const [existing] = await conn.query<RowDataPacket[]>('SELECT id FROM hr_onboarding_tasks WHERE onboarding_id = ? LIMIT 1', [req.params.id]);
    if (existing.length) throw badRequest('已有任务，请勿重复应用模板');
    const [settings] = await conn.query<RowDataPacket[]>("SELECT value_json FROM hr_settings WHERE setting_key = 'onboarding_tasks'");
    const tasks = parse(templateSchema, settings.length ? json(settings[0].value_json) : []);
    if (!tasks.length) throw badRequest('请先设置入职任务模板');
    if (tasks.some((task) => task.beginOn != null) && !input.startDate) throw badRequest('该模板包含计划时间，请选择入职活动开始日期');
    const [attendance] = await conn.query<RowDataPacket[]>('SELECT rest_dates FROM attendance_settings WHERE id = 1');
    const dates = attendance.length && attendance[0].rest_dates ? json(attendance[0].rest_dates) : [];
    const holidays = new Set<string>(Array.isArray(dates) ? dates.filter((date): date is string => typeof date === 'string') : []);
    for (const task of tasks) {
      const start = task.beginOn == null ? null : scheduledDate(input.startDate!, task.beginOn, holidays);
      const end = task.beginOn == null || task.duration == null ? null : scheduledDate(input.startDate!, task.beginOn + task.duration, holidays);
      await conn.execute('INSERT INTO hr_onboarding_tasks (onboarding_id, title, description, start_date, end_date, required, completed) VALUES (?, ?, ?, ?, ?, ?, 0)', [req.params.id, task.title, task.description, start, end, task.required]);
    }
  });
  await recordAdminLog(req.admin!, '应用入职任务模板', 'hr_onboarding', req.params.id, {}); success(res, {});
}));
router.get('/events', asyncHandler(async (req, res) => {
  const id = parse(employeeId, req.query.employeeId); await employeeExists(id);
  success(res, await queryRows('SELECT id, employee_id AS employeeId, event_type AS type, effective_date AS effectiveDate, note, created_at AS createdAt FROM hr_events WHERE employee_id = ? ORDER BY effective_date DESC, id DESC LIMIT 200', [id]));
}));
router.post('/events', asyncHandler(async (req, res) => {
  const input = parse(eventSchema, req.body); await employeeExists(input.employeeId);
  const result = await execute('INSERT INTO hr_events (employee_id, event_type, effective_date, note, created_at) VALUES (?, ?, ?, ?, NOW())', [input.employeeId, input.type, input.effectiveDate, input.note]);
  await recordAdminLog(req.admin!, '登记人事事件', 'hr_events', String(result.insertId), { employeeId: input.employeeId, type: input.type }); success(res, { id: result.insertId });
}));
router.get('/employees/:id/:section/history', asyncHandler(async (req, res) => {
  if (!['contract', 'salary'].includes(req.params.section)) throw notFound(); await employeeExists(req.params.id);
  const rows = await queryRows<{ id: number; data_json: unknown; created_at: string }>('SELECT id, data_json, created_at FROM hr_employee_history WHERE employee_id = ? AND section = ? ORDER BY id DESC LIMIT 200', [req.params.id, req.params.section]);
  success(res, rows.map((row) => ({ id: row.id, data: json(row.data_json), createdAt: row.created_at })));
}));
const attendanceRulesKey = 'payroll_attendance_rules';
async function loadAttendancePayrollRules() {
  let setting = await queryOne<{ value_json: unknown }>('SELECT value_json FROM hr_settings WHERE setting_key = ?', [attendanceRulesKey]);
  if (!setting) {
    const rows = await queryRows<{ data_json: unknown }>("SELECT data_json FROM hr_employee_records WHERE section = 'salary'");
    const candidates = new Map<string, unknown>();
    for (const row of rows) {
      const value = json(row.data_json) as { attendanceRules?: unknown };
      if (!Array.isArray(value?.attendanceRules) || !value.attendanceRules.length) continue;
      const rules = parse(attendanceRulesSchema, value.attendanceRules);
      const key = JSON.stringify([...rules].sort((a, b) => a.minRate - b.minRate || a.maxRate - b.maxRate || a.adjustment - b.adjustment));
      candidates.set(key, rules);
    }
    if (candidates.size > 1) throw conflict('不同员工存在不同的旧规则，请设置全员规则');
    if (candidates.size === 1) {
      await execute('INSERT IGNORE INTO hr_settings (setting_key, value_json, updated_at) VALUES (?, ?, NOW())', [attendanceRulesKey, JSON.stringify([...candidates.values()][0])]);
      setting = await queryOne<{ value_json: unknown }>('SELECT value_json FROM hr_settings WHERE setting_key = ?', [attendanceRulesKey]);
    }
  }
  return setting ? parse(attendanceRulesSchema, json(setting.value_json)) : [];
}
router.get('/attendance-payroll-rule-config-v2', asyncHandler(async (_req, res) => {
  const stored = await readAttendanceRuleConfig();
  success(res, stored ?? { mode: 'rate_attendance', rules: await loadAttendancePayrollRules() });
}));
router.put('/attendance-payroll-rule-config-v2', asyncHandler(async (req, res) => {
  const config = parse(attendanceRuleConfigSchema, req.body);
  await saveAttendanceRuleConfig(config);
  await recordAdminLog(req.admin!, '设置全员出勤绩效规则', 'hr_settings', ATTENDANCE_RULE_CONFIG_KEY, { mode: config.mode, calculation: config.calculation ?? 'range', count: config.calculation === 'unit' ? 1 : config.rules.length });
  success(res, config);
}));
router.get('/attendance-payroll-rule-config', asyncHandler(async (_req, res) => {
  const stored = await readAttendanceRuleConfig();
  if (stored?.calculation === 'unit') throw conflict('当前规则按单位计算，请使用新版接口');
  success(res, stored ?? { mode: 'rate_attendance', rules: await loadAttendancePayrollRules() });
}));
router.put('/attendance-payroll-rule-config', asyncHandler(async (req, res) => {
  const config = parse(attendanceRangeRuleConfigSchema, req.body);
  await saveAttendanceRuleConfig(config);
  await recordAdminLog(req.admin!, '设置全员出勤绩效规则', 'hr_settings', ATTENDANCE_RULE_CONFIG_KEY, { mode: config.mode, count: config.rules.length });
  success(res, config);
}));
router.get('/attendance-payroll-rules', asyncHandler(async (_req, res) => {
  const config = await readAttendanceRuleConfig();
  if (config && (config.calculation === 'unit' || config.mode !== 'rate_attendance')) throw conflict('当前规则不是按区间比例出勤配置，请使用新版接口');
  success(res, await loadAttendancePayrollRules());
}));
router.put('/attendance-payroll-rules', asyncHandler(async (req, res) => {
  const rules = parse(payrollAttendanceRulesSchema, req.body);
  await saveAttendanceRuleConfig({ mode: 'rate_attendance', rules });
  await recordAdminLog(req.admin!, '设置全员出勤率绩效规则', 'hr_settings', attendanceRulesKey, { count: rules.length });
  success(res, rules);
}));
router.get('/overtime-payroll-rule-config', asyncHandler(async (_req, res) => {
  success(res, await readOvertimeRuleConfig());
}));
router.put('/overtime-payroll-rule-config', asyncHandler(async (req, res) => {
  const config = parse(overtimeRuleConfigSchema, req.body);
  await saveOvertimeRuleConfig(config);
  await recordAdminLog(req.admin!, '设置加班绩效规则', 'hr_settings', OVERTIME_RULE_CONFIG_KEY, { calculation: config.calculation, count: config.calculation === 'range' ? config.rules.length : 1 });
  success(res, config);
}));
router.get('/overtime-payroll-rules', asyncHandler(async (_req, res) => {
  const config = await readOvertimeRuleConfig();
  if (config.calculation !== 'range') throw conflict('当前加班规则按单位计算，请使用新版接口');
  success(res, config.rules);
}));
router.put('/overtime-payroll-rules', asyncHandler(async (req, res) => {
  const overtimeRules = parse(overtimeRulesSchema, req.body);
  await saveOvertimeRuleConfig({ calculation: 'range', rules: overtimeRules });
  await recordAdminLog(req.admin!, '设置加班绩效规则', 'hr_settings', overtimeRulesKey, { count: overtimeRules.length });
  success(res, overtimeRules);
}));
router.get('/payroll-batches', asyncHandler(async (_req, res) => {
  success(res, await queryRows('SELECT id, payroll_month AS month, status, created_at AS createdAt, reviewed_at AS reviewedAt, reviewed_by AS reviewedBy FROM hr_payroll_batches ORDER BY payroll_month DESC LIMIT 200'));
}));
router.post('/payroll-batches', asyncHandler(async (req, res) => {
  const input = parse(monthSchema, req.body); const result = await execute("INSERT INTO hr_payroll_batches (payroll_month, status, created_at) VALUES (?, 'draft', NOW())", [input.month]);
  await recordAdminLog(req.admin!, '创建工资批次', 'hr_payroll_batches', String(result.insertId), { month: input.month }); success(res, { id: result.insertId });
}));
router.delete('/payroll-batches/:id', asyncHandler(async (req, res) => {
  const id = parse(z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER), req.params.id);
  await transaction(async conn => {
    const [batches] = await conn.query<RowDataPacket[]>('SELECT status FROM hr_payroll_batches WHERE id = ? FOR UPDATE', [id]);
    if (!batches.length) throw notFound('工资批次不存在');
    if (batches[0].status !== 'draft') throw badRequest('已复核的批次不能删除');
    await conn.execute('DELETE FROM hr_payroll_batch_items WHERE batch_id = ?', [id]);
    await conn.execute('DELETE FROM hr_payroll_batches WHERE id = ?', [id]);
  });
  await recordAdminLog(req.admin!, '删除工资草稿批次', 'hr_payroll_batches', String(id), {});
  success(res, {});
}));
router.get('/payroll-batches/:id/items', asyncHandler(async (req, res) => {
  const batchId = parse(batchIdSchema, req.params.id);
  if (!await queryOne('SELECT id FROM hr_payroll_batches WHERE id = ?', [batchId])) throw notFound('工资批次不存在');
  await syncDraftBatch(batchId);
  const rows = await queryRows<{ modelSnapshot: unknown }>('SELECT i.id, i.employee_id AS employeeId, e.name, e.employee_no AS employeeNo, i.gross, i.base_gross AS baseGross, i.attendance_rate AS attendanceRate, i.attendance_adjustment AS attendanceAdjustment, i.overtime_seconds AS overtimeSeconds, i.overtime_pay AS overtimePay, i.model_snapshot AS modelSnapshot, e.position, i.deductions, i.net, i.note FROM hr_payroll_batch_items i JOIN employees e ON e.id = i.employee_id WHERE i.batch_id = ? ORDER BY i.id', [req.params.id]);
  success(res, rows.map(row => ({ ...row, modelSnapshot: row.modelSnapshot ? json(row.modelSnapshot) : null })));
}));
router.post('/payroll-batches/:id/items', asyncHandler(async (req, res) => {
  const input = parse(z.object({ employeeId }).strict(), req.body);
  const id = parse(batchIdSchema, req.params.id);
  const result = await addAutoPayrollItems(id, [input.employeeId]);
  if (!result.addedCount) throw conflict('该员工已在工资批次中');
  await recordAdminLog(req.admin!, '登记工资批次明细', 'hr_payroll_batches', String(id), { employeeId: input.employeeId });
  success(res, result);
}));
router.get('/payroll-batches/:id/auto-preview', asyncHandler(async (req, res) => {
  const id = parse(batchIdSchema, req.params.id);
  success(res, await previewAutoPayrollItems(id));
}));
router.post('/payroll-batches/:id/auto-items', asyncHandler(async (req, res) => {
  const id = parse(batchIdSchema, req.params.id);
  const result = await addAutoPayrollItems(id);
  await recordAdminLog(req.admin!, '一键添加工资明细', 'hr_payroll_batches', String(id), { addedCount: result.addedCount, skippedExisting: result.skippedExisting });
  success(res, result);
}));
router.delete('/payroll-batches/:id/items/:itemId', asyncHandler(async (req, res) => {
  await transaction(async (conn) => {
    const [batches] = await conn.query<RowDataPacket[]>('SELECT status FROM hr_payroll_batches WHERE id = ? FOR UPDATE', [req.params.id]);
    if (!batches.length) throw notFound('工资批次不存在'); if (batches[0].status !== 'draft') throw badRequest('已复核的批次不能修改');
    const [result] = await conn.execute<ResultSetHeader>('DELETE FROM hr_payroll_batch_items WHERE id = ? AND batch_id = ?', [req.params.itemId, req.params.id]);
    if (!result.affectedRows) throw notFound('工资明细不存在');
  });
  await recordAdminLog(req.admin!, '删除工资草稿明细', 'hr_payroll_batches', req.params.id, {}); success(res, {});
}));
router.put('/payroll-batches/:id/items/:itemId/extended', asyncHandler(async (req, res) => {
  const values = parse(z.array(z.object({ name: z.string().min(1).max(60), value: z.union([z.number().finite().min(-9999999999.99).max(9999999999.99), z.string().max(200)]) })).max(51), req.body.values);
  const revision = parse(z.number().int().nonnegative(), req.body.revision);
  await syncDraftBatch(parse(batchIdSchema, req.params.id));
  const updated = await transaction(async conn => {
    const [batches] = await conn.query<RowDataPacket[]>('SELECT status FROM hr_payroll_batches WHERE id = ? FOR UPDATE', [req.params.id]);
    if (!batches.length) throw notFound('工资批次不存在');
    if (batches[0].status !== 'draft') throw badRequest('已复核的批次不能修改');
    const [items] = await conn.query<RowDataPacket[]>('SELECT model_snapshot FROM hr_payroll_batch_items WHERE id = ? AND batch_id = ? FOR UPDATE', [req.params.itemId, req.params.id]);
    if (!items.length) throw notFound('工资明细不存在');
    if (!items[0].model_snapshot) throw badRequest('历史工资明细不能按新模型编辑');
    const snapshot = json(items[0].model_snapshot) as PayrollModelSnapshot;
    if ((snapshot.revision ?? 0) !== revision) throw conflict('工资明细已被修改，请刷新后重试');
    if (values.length !== snapshot.extended.length || new Set(values.map(value => value.name)).size !== values.length) throw badRequest('扩展字段与工资明细不一致');
    const byName = new Map(values.map(value => [value.name, value.value]));
    snapshot.extended = snapshot.extended.map(field => {
      const value = byName.get(field.name);
      if (value === undefined) throw badRequest('扩展字段与工资明细不一致');
      if (field.attendanceMetric && value !== field.value) throw badRequest(`字段“${field.name}”来自考勤系统，不能手工修改`);
      return { ...field, value };
    });
    snapshot.revision = revision + 1;
    const totals = calculateExtendedSalary(snapshot);
    await conn.execute('UPDATE hr_payroll_batch_items SET model_snapshot = ?, gross = ?, deductions = ?, net = ? WHERE id = ?', [JSON.stringify(snapshot), totals.gross, totals.deductions, totals.net, req.params.itemId]);
    return { modelSnapshot: snapshot, ...totals };
  });
  await recordAdminLog(req.admin!, '编辑工资批次扩展字段', 'hr_payroll_batches', req.params.id, { itemId: req.params.itemId });
  success(res, updated);
}));
router.put('/payroll-batches/:id/items/:itemId/fixed', asyncHandler(async (req, res) => {
  const input = parse(z.object({ revision: z.number().int().nonnegative(), name: z.string().min(1).max(60), value: z.union([z.number().finite().min(-9999999999.99).max(9999999999.99), z.string().max(200)]) }).strict(), req.body);
  if (['姓名', '员工号', '职务'].includes(input.name)) throw badRequest('员工身份字段不能在工资批次中修改');
  await syncDraftBatch(parse(batchIdSchema, req.params.id));
  const updated = await transaction(async conn => {
    const [batches] = await conn.query<RowDataPacket[]>('SELECT status FROM hr_payroll_batches WHERE id = ? FOR UPDATE', [req.params.id]);
    if (!batches.length) throw notFound('工资批次不存在');
    if (batches[0].status !== 'draft') throw badRequest('已复核的批次不能修改');
    const [items] = await conn.query<RowDataPacket[]>('SELECT model_snapshot FROM hr_payroll_batch_items WHERE id = ? AND batch_id = ? FOR UPDATE', [req.params.itemId, req.params.id]);
    if (!items.length) throw notFound('工资明细不存在');
    if (!items[0].model_snapshot) throw badRequest('历史工资明细不能按新模型编辑');
    const snapshot = json(items[0].model_snapshot) as PayrollModelSnapshot;
    if ((snapshot.revision ?? 0) !== input.revision) throw conflict('工资明细已被修改，请刷新后重试');
    const field = snapshot.fixed.find(item => item.name === input.name);
    if (!field) throw badRequest('固定字段不存在');
    snapshot.fixed = snapshot.fixed.map(item => item.name === input.name ? { ...item, value: input.value, manualAdjustment: { originalValue: item.manualAdjustment?.originalValue ?? item.value, updatedAt: new Date().toISOString(), updatedBy: req.admin!.id } } : item);
    snapshot.fixedTotal = calculateFixedIncome(snapshot.fixed);
    snapshot.revision = input.revision + 1;
    const totals = calculateExtendedSalary(snapshot);
    await conn.execute('UPDATE hr_payroll_batch_items SET model_snapshot = ?, gross = ?, deductions = ?, net = ? WHERE id = ?', [JSON.stringify(snapshot), totals.gross, totals.deductions, totals.net, req.params.itemId]);
    return { modelSnapshot: snapshot, ...totals };
  });
  await recordAdminLog(req.admin!, '编辑工资批次固定字段', 'hr_payroll_batches', req.params.id, { itemId: req.params.itemId, field: input.name });
  success(res, updated);
}));
router.put('/payroll-batches/:id/items/:itemId/deduction', asyncHandler(async (req, res) => {
  const input = parse(z.object({ revision: z.number().int().nonnegative(), deduction: z.number().finite().min(0).max(9999999999.99) }).strict(), req.body);
  await syncDraftBatch(parse(batchIdSchema, req.params.id));
  const updated = await transaction(async conn => {
    const [batches] = await conn.query<RowDataPacket[]>('SELECT status FROM hr_payroll_batches WHERE id = ? FOR UPDATE', [req.params.id]);
    if (!batches.length) throw notFound('工资批次不存在');
    if (batches[0].status !== 'draft') throw badRequest('已复核的批次不能修改');
    const [items] = await conn.query<RowDataPacket[]>('SELECT model_snapshot FROM hr_payroll_batch_items WHERE id = ? AND batch_id = ? FOR UPDATE', [req.params.itemId, req.params.id]);
    if (!items.length) throw notFound('工资明细不存在');
    if (!items[0].model_snapshot) throw badRequest('历史工资明细不能编辑');
    const snapshot = json(items[0].model_snapshot) as PayrollModelSnapshot;
    if ((snapshot.revision ?? 0) !== input.revision) throw conflict('工资明细已被修改，请刷新后重试');
    snapshot.manualDeduction = input.deduction;
    snapshot.revision = input.revision + 1;
    const totals = calculateExtendedSalary(snapshot);
    await conn.execute('UPDATE hr_payroll_batch_items SET model_snapshot = ?, gross = ?, deductions = ?, net = ? WHERE id = ?', [JSON.stringify(snapshot), totals.gross, totals.deductions, totals.net, req.params.itemId]);
    return { modelSnapshot: snapshot, ...totals };
  });
  await recordAdminLog(req.admin!, '编辑工资批次扣除', 'hr_payroll_batches', req.params.id, { itemId: req.params.itemId });
  success(res, updated);
}));
router.post('/payroll-batches/:id/review', asyncHandler(async (req, res) => {
  await syncDraftBatch(parse(batchIdSchema, req.params.id));
  await transaction(async (conn) => {
    const [batches] = await conn.query<RowDataPacket[]>('SELECT status FROM hr_payroll_batches WHERE id = ? FOR UPDATE', [req.params.id]);
    if (!batches.length) throw notFound('工资批次不存在'); if (batches[0].status !== 'draft') throw badRequest('批次已经复核');
    const [items] = await conn.query<RowDataPacket[]>('SELECT id FROM hr_payroll_batch_items WHERE batch_id = ? ORDER BY id FOR UPDATE', [req.params.id]);
    if (!items.length) throw badRequest('请先登记工资明细');
    await conn.execute("UPDATE hr_payroll_batches SET status = 'reviewed', reviewed_at = NOW(), reviewed_by = ? WHERE id = ?", [req.admin!.id, req.params.id]);
  });
  await recordAdminLog(req.admin!, '复核工资批次', 'hr_payroll_batches', req.params.id, {}); success(res, {});
}));
router.get('/offboarding', asyncHandler(async (_req, res) => {
  const rows = await queryRows<{ taskCount: number; completedCount: number }>('SELECT o.id, o.employee_id AS employeeId, e.name, e.employee_no AS employeeNo, o.last_date AS lastDate, o.note, o.status, o.created_at AS createdAt, d.status AS departureStatus, (SELECT COUNT(*) FROM hr_offboarding_tasks t WHERE t.offboarding_id = o.id) AS taskCount, (SELECT COUNT(*) FROM hr_offboarding_tasks t WHERE t.offboarding_id = o.id AND t.completed = 1) AS completedCount FROM hr_offboarding o JOIN employees e ON e.id = o.employee_id LEFT JOIN hr_employee_departures d ON d.offboarding_id = o.id ORDER BY o.id DESC LIMIT 200');
  success(res, rows.map((row) => ({ ...row, taskCount: Number(row.taskCount), completedCount: Number(row.completedCount), taskStatus: Number(row.completedCount) === 0 ? 'pending' : Number(row.completedCount) === Number(row.taskCount) ? 'completed' : 'in_progress' })));
}));
router.post('/offboarding', asyncHandler(async (req, res) => {
  const input = parse(exitSchema, req.body);
  const id = await transaction(async (conn) => {
    const [employees] = await conn.query<RowDataPacket[]>("SELECT id, DATE_FORMAT(join_date, '%Y-%m-%d') AS joinDate FROM employees WHERE id = ? FOR UPDATE", [input.employeeId]);
    if (!employees.length) throw notFound('员工不存在');
    if (input.lastDate < String(employees[0].joinDate)) throw badRequest('最后工作日不能早于入职日期');
    const [departures] = await conn.query<RowDataPacket[]>("SELECT id FROM hr_employee_departures WHERE employee_id = ? AND status = 'departed' LIMIT 1", [input.employeeId]);
    if (departures.length) throw badRequest('该员工已确认离职');
    const [openCases] = await conn.query<RowDataPacket[]>("SELECT id FROM hr_offboarding WHERE employee_id = ? AND status = 'open' LIMIT 1", [input.employeeId]);
    if (openCases.length) throw badRequest('该员工已有办理中的离职清单');
    const [result] = await conn.execute<ResultSetHeader>("INSERT INTO hr_offboarding (employee_id, last_date, note, status, created_at) VALUES (?, ?, ?, 'open', NOW())", [input.employeeId, input.lastDate, input.note]); return result.insertId;
  });
  await recordAdminLog(req.admin!, '登记离职清单', 'hr_offboarding', String(id), { employeeId: input.employeeId }); success(res, { id });
}));
router.get('/offboarding/:id/tasks', asyncHandler(async (req, res) => {
  if (!await queryOne('SELECT id FROM hr_offboarding WHERE id = ?', [req.params.id])) throw notFound('离职清单不存在');
  const rows = await queryRows<{ id: number; title: string; required: number; completed: number }>('SELECT id, title, required, completed FROM hr_offboarding_tasks WHERE offboarding_id = ? ORDER BY id', [req.params.id]);
  success(res, rows.map((row) => ({ ...row, required: !!row.required, completed: !!row.completed })));
}));
router.post('/offboarding/:id/tasks', asyncHandler(async (req, res) => {
  const input = parse(taskSchema, req.body); const id = await transaction(async (conn) => {
    const [cases] = await conn.query<RowDataPacket[]>('SELECT status FROM hr_offboarding WHERE id = ? FOR UPDATE', [req.params.id]);
    if (!cases.length) throw notFound('离职清单不存在'); if (cases[0].status !== 'open') throw badRequest('已完成的离职清单不能修改');
    const [result] = await conn.execute<ResultSetHeader>('INSERT INTO hr_offboarding_tasks (offboarding_id, title, required, completed) VALUES (?, ?, ?, 0)', [req.params.id, input.title, input.required]); return result.insertId;
  }); await recordAdminLog(req.admin!, '添加离职任务', 'hr_offboarding', req.params.id, {}); success(res, { id });
}));
router.patch('/offboarding/:id/tasks/:taskId', asyncHandler(async (req, res) => {
  const input = parse(completionSchema, req.body); await transaction(async (conn) => {
    const [cases] = await conn.query<RowDataPacket[]>('SELECT status FROM hr_offboarding WHERE id = ? FOR UPDATE', [req.params.id]);
    if (!cases.length) throw notFound('离职清单不存在'); if (cases[0].status !== 'open') throw badRequest('已完成的离职清单不能修改');
    const [tasks] = await conn.query<RowDataPacket[]>('SELECT id FROM hr_offboarding_tasks WHERE id = ? AND offboarding_id = ?', [req.params.taskId, req.params.id]); if (!tasks.length) throw notFound('离职任务不存在');
    await conn.execute('UPDATE hr_offboarding_tasks SET completed = ? WHERE id = ? AND offboarding_id = ?', [input.completed, req.params.taskId, req.params.id]);
  }); await recordAdminLog(req.admin!, '更新离职任务', 'hr_offboarding', req.params.id, {}); success(res, {});
}));
router.post('/offboarding/:id/complete', asyncHandler(async (req, res) => {
  await transaction(async (conn) => {
    const [cases] = await conn.query<RowDataPacket[]>('SELECT status FROM hr_offboarding WHERE id = ? FOR UPDATE', [req.params.id]);
    if (!cases.length) throw notFound('离职清单不存在'); if (cases[0].status !== 'open') throw badRequest('离职清单已完成');
    const [pending] = await conn.query<RowDataPacket[]>('SELECT id FROM hr_offboarding_tasks WHERE offboarding_id = ? AND required = 1 AND completed = 0 LIMIT 1', [req.params.id]); if (pending.length) throw badRequest('请先完成必需的离职任务');
    await conn.execute("UPDATE hr_offboarding SET status = 'completed' WHERE id = ?", [req.params.id]);
  }); await recordAdminLog(req.admin!, '完成离职清单', 'hr_offboarding', req.params.id, {}); success(res, {});
}));
router.post('/offboarding/:id/finalize', asyncHandler(async (req, res) => {
  const result = await finalizeDeparture(req.params.id, req.admin!.id);
  await recordAdminLog(req.admin!, '确认员工离职', 'hr_employee_departures', String(result.id), { employeeId: result.employeeId });
  success(res, result);
}));
router.post('/offboarding/:id/cancel-departure', asyncHandler(async (req, res) => {
  await cancelDeparture(req.params.id, req.admin!.id);
  await recordAdminLog(req.admin!, '撤销员工离职', 'hr_offboarding', req.params.id, {});
  success(res, {});
}));
export default router;
