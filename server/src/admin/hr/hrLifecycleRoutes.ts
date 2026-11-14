import { Router } from 'express';
import { z } from 'zod';
import type { ResultSetHeader, RowDataPacket } from 'mysql2';
import { execute, queryOne, queryRows, transaction } from '../../shared/db/pool';
import { parse } from '../../shared/middleware/validate';
import { recordAdminLog } from '../../domains/audit/adminLogService';
import { asyncHandler } from '../../shared/utils/asyncHandler';
import { badRequest, conflict, notFound } from '../../shared/utils/errors';
import { attendanceRulesSchema } from './hrPolicy';
import { calculateExtendedSalary, calculateFixedIncome, type PayrollModelSnapshot } from '../../domains/payroll/payrollModelCalculation';
import { syncDraftBatch } from '../../domains/payroll/payrollDraftSync';
import { addAutoPayrollItems, previewAutoPayrollItems, lockPayrollMonth } from '../../domains/payroll/payrollAutoService';
import { success } from '../../shared/utils/response';
import { cancelTransition, listTransitions, submitTransition, transitionSchema } from './hrTransitionService';
import multer from 'multer';
import type { RequestHandler } from 'express';
import {
  cancelDepartureRecord,
  scheduleReinstatement,
  getDepartureFile,
  listDepartureFiles,
  listDepartures,
  registerDeparture,
} from './hrDepartureService';
import { overtimeRuleConfigSchema } from '../../domains/payroll/overtimePayrollService';
import { OVERTIME_RULE_CONFIG_KEY, readOvertimeRuleConfig, saveOvertimeRuleConfig } from '../../domains/payroll/overtimeRuleConfigRepository';
import { attendanceRuleConfigSchema } from '../../domains/payroll/attendanceRuleConfig';
import { ATTENDANCE_RULE_CONFIG_KEY, readAttendanceRuleConfig, saveAttendanceRuleConfig } from '../../domains/payroll/attendanceRuleConfigRepository';

const router = Router();
const monthSchema = z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/) });
const batchIdSchema = z.coerce.number().int().positive();
const employeeId = z.string().trim().min(1).max(10);
const eventSchema = z.object({ employeeId, type: z.enum(['转正', '调岗', '调薪', '其他']), effectiveDate: z.string().date(), note: z.string().trim().max(500).default('') });
const exitSchema = z.object({ employeeId, lastDate: z.string().date(), note: z.string().trim().max(500).default('') });
const json = (value: unknown) => typeof value === 'string' ? JSON.parse(value) : value;
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
router.get('/overtime-payroll-rule-config', asyncHandler(async (_req, res) => {
  success(res, await readOvertimeRuleConfig());
}));
router.put('/overtime-payroll-rule-config', asyncHandler(async (req, res) => {
  const config = parse(overtimeRuleConfigSchema, req.body);
  await saveOvertimeRuleConfig(config);
  await recordAdminLog(req.admin!, '设置加班绩效规则', 'hr_settings', OVERTIME_RULE_CONFIG_KEY, { calculation: config.calculation, count: config.calculation === 'range' ? config.rules.length : 1 });
  success(res, config);
}));
router.get('/payroll-batches', asyncHandler(async (req, res) => {
  const month = req.query.month === undefined ? undefined : parse(monthSchema, { month: req.query.month }).month;
  const columns = 'SELECT id, payroll_month AS month, status, created_at AS createdAt, reviewed_at AS reviewedAt, reviewed_by AS reviewedBy FROM hr_payroll_batches';
  success(res, month ? await queryRows(`${columns} WHERE payroll_month = ? ORDER BY id DESC`, [month]) : await queryRows(`${columns} ORDER BY id DESC LIMIT 200`));
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
    await conn.execute('DELETE p FROM hr_payroll_legacy_job_titles p JOIN hr_payroll_batch_items i ON i.id = p.item_id WHERE i.batch_id = ?', [id]);
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
  const rows = await queryRows<{ modelSnapshot: unknown }>('SELECT i.id, i.employee_id AS employeeId, e.name, e.employee_no AS employeeNo, i.gross, i.base_gross AS baseGross, i.attendance_rate AS attendanceRate, i.attendance_adjustment AS attendanceAdjustment, i.overtime_seconds AS overtimeSeconds, i.overtime_pay AS overtimePay, i.model_snapshot AS modelSnapshot, COALESCE(p.position, e.position) AS position, i.deductions, i.net, i.note FROM hr_payroll_batch_items i JOIN employees e ON e.id = i.employee_id LEFT JOIN hr_payroll_legacy_job_titles p ON p.item_id = i.id WHERE i.batch_id = ? ORDER BY i.id', [req.params.id]);
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
router.get('/payroll-batches/:id/employee-availability', asyncHandler(async (req, res) => {
  const id = parse(batchIdSchema, req.params.id);
  const batch = await queryOne<{ month: string }>('SELECT payroll_month AS month FROM hr_payroll_batches WHERE id = ?', [id]);
  if (!batch) throw notFound('工资批次不存在');
  const rows = await queryRows<{ employeeId: string }>(`SELECT DISTINCT i.employee_id AS employeeId FROM hr_payroll_batch_items i
    JOIN hr_payroll_batches b ON b.id = i.batch_id WHERE b.payroll_month = ? AND b.status = 'reviewed'`, [batch.month]);
  success(res, { reviewedEmployeeIds: rows.map(row => row.employeeId) });
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
router.post('/payroll-batches/:id/review', asyncHandler(async (req, res) => {
  await syncDraftBatch(parse(batchIdSchema, req.params.id));
  await transaction(async (conn) => {
    const [initial] = await conn.query<RowDataPacket[]>('SELECT payroll_month AS month FROM hr_payroll_batches WHERE id = ?', [req.params.id]);
    if (!initial.length) throw notFound('工资批次不存在');
    await lockPayrollMonth(conn, String(initial[0].month));
    const [batches] = await conn.query<RowDataPacket[]>('SELECT status FROM hr_payroll_batches WHERE id = ? FOR UPDATE', [req.params.id]);
    if (!batches.length) throw notFound('工资批次不存在'); if (batches[0].status !== 'draft') throw badRequest('批次已经复核');
    const [items] = await conn.query<RowDataPacket[]>('SELECT id FROM hr_payroll_batch_items WHERE batch_id = ? ORDER BY id FOR UPDATE', [req.params.id]);
    if (!items.length) throw badRequest('请先登记工资明细');
    const [duplicates] = await conn.query<RowDataPacket[]>(`SELECT e.name, e.employee_no AS employeeNo FROM hr_payroll_batch_items current_item
      JOIN hr_payroll_batch_items reviewed_item ON reviewed_item.employee_id = current_item.employee_id
      JOIN hr_payroll_batches reviewed_batch ON reviewed_batch.id = reviewed_item.batch_id
      JOIN employees e ON e.id = current_item.employee_id
      WHERE current_item.batch_id = ? AND reviewed_batch.payroll_month = ? AND reviewed_batch.status = 'reviewed'
      ORDER BY current_item.employee_id FOR UPDATE`, [req.params.id, initial[0].month]);
    if (duplicates.length) throw conflict(`以下员工已在本月已复核的工资批次中：${duplicates.map(row => `${row.name}（${row.employeeNo}）`).join('、')}，请先删除重复明细`);
    await conn.execute("UPDATE hr_payroll_batches SET status = 'reviewed', reviewed_at = NOW(), reviewed_by = ? WHERE id = ?", [req.admin!.id, req.params.id]);
  });
  await recordAdminLog(req.admin!, '复核工资批次', 'hr_payroll_batches', req.params.id, {}); success(res, {});
}));
const departureUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 5 }, defParamCharset: 'utf8' }).array('files', 5);
const uploadDepartureFiles: RequestHandler = (req, res, next) => departureUpload(req, res, (error) => {
  if (error instanceof multer.MulterError) {
    next(badRequest(error.code === 'LIMIT_FILE_SIZE' ? '单个附件不能超过 10MB' : error.code === 'LIMIT_FILE_COUNT' ? '最多上传 5 个附件' : '附件上传失败'));
    return;
  }
  next(error);
});

router.get('/departures', asyncHandler(async (_req, res) => {
  success(res, await listDepartures());
}));
router.post('/departures', uploadDepartureFiles, asyncHandler(async (req, res) => {
  const input = parse(exitSchema, typeof req.body?.payload === 'string' ? JSON.parse(req.body.payload) : req.body);
  const uploaded = Array.isArray(req.files) ? req.files as Express.Multer.File[] : [];
  const result = await registerDeparture({
    employeeId: input.employeeId,
    lastDate: input.lastDate,
    note: input.note,
    adminId: req.admin!.id,
    files: uploaded.map((file) => ({
      fileName: file.originalname,
      mimeType: file.mimetype || 'application/octet-stream',
      size: file.size,
      data: file.buffer,
    })),
  });
  await recordAdminLog(req.admin!, '登记员工离职', 'hr_employee_departures', String(result.id), { employeeId: result.employeeId, status: result.status });
  success(res, result);
}));
router.post('/departures/:id/cancel', asyncHandler(async (req, res) => {
  const id = parse(z.coerce.number().int().positive(), req.params.id);
  await cancelDepartureRecord(id, req.admin!.id);
  await recordAdminLog(req.admin!, '撤销员工离职', 'hr_employee_departures', String(id), {});
  success(res, {});
}));
router.post('/departures/:id/reinstate', asyncHandler(async (req, res) => {
  const id = parse(z.coerce.number().int().positive(), req.params.id);
  const input = parse(z.object({ reinstatementDate: z.string().date() }), req.body);
  const result = await scheduleReinstatement(id, input.reinstatementDate, req.admin!.id);
  await recordAdminLog(req.admin!, '员工复职', 'hr_employee_departures', String(id), { employeeId: result.employeeId, reinstatementDate: input.reinstatementDate, status: result.status });
  success(res, result);
}));
router.get('/departures/:id/files', asyncHandler(async (req, res) => {
  const id = parse(z.coerce.number().int().positive(), req.params.id);
  success(res, await listDepartureFiles(id));
}));
router.get('/departures/:id/files/:fileId', asyncHandler(async (req, res) => {
  const id = parse(z.coerce.number().int().positive(), req.params.id);
  const fileId = parse(z.coerce.number().int().positive(), req.params.fileId);
  const file = await getDepartureFile(id, fileId);
  const encoded = encodeURIComponent(file.file_name).replace(/['()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
  res.set({ 'Content-Type': file.mime_type || 'application/octet-stream', 'Content-Disposition': `attachment; filename="attachment"; filename*=UTF-8''${encoded}`, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' });
  res.send(file.file_data);
}));
export default router;
