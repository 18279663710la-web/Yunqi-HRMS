import { Router } from 'express';
import { z } from 'zod';
import type { ResultSetHeader, RowDataPacket } from 'mysql2';
import type { PoolConnection } from 'mysql2/promise';
import { execute, queryOne, queryRows, transaction } from '../../shared/db/pool';
import { requireAdmin, requireSuperAdmin } from '../admin-accounts/authMiddleware';
import { parse } from '../../shared/middleware/validate';
import {
  answersEqual,
  defaultTemplate,
  formTemplateSchema,
  templateNameSchema,
  validateAnswers,
  validateOnboardingAttachments,
  type FormField,
} from '../../domains/onboarding/onboardingForm';
import { recordAdminLog } from '../../domains/audit/adminLogService';
import { asyncHandler } from '../../shared/utils/asyncHandler';
import { badRequest, conflict, notFound } from '../../shared/utils/errors';
import { success } from '../../shared/utils/response';
import type { AdminUser } from '../../shared/types/admin';
import { getOnboardingFile } from '../../domains/onboarding/onboardingFiles';

const decode = (x: unknown) => typeof x === 'string' ? JSON.parse(x) : x;
const templateIdSchema = z.coerce.number().int().positive().max(2147483647);
const applicationIdSchema = z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const defaultSettingSql = "INSERT INTO hr_settings (setting_key, value_json, updated_at) VALUES ('self_onboarding_default', ?, NOW()) ON DUPLICATE KEY UPDATE value_json = VALUES(value_json), updated_at = NOW()";
const legacySettingSql = "INSERT INTO hr_settings (setting_key, value_json, updated_at) VALUES ('self_onboarding_template', ?, NOW()) ON DUPLICATE KEY UPDATE value_json = VALUES(value_json), updated_at = NOW()";

type TemplateRow = { id: number; name: string; fields_json: unknown; version: number; updatedAt?: unknown };
type TemplateSnapshot = { name: string; fields: FormField[] };
type TemplateChange = { label: string; before?: unknown; after?: unknown };

const typeLabels: Record<FormField['type'], string> = { text: '字符串', number: '数字', date: '日期', select: '单选', attachment: '附件', table: '表格' };
const fieldTitle = (field: FormField) => `${field.name}（${typeLabels[field.type]}）`;
const fieldMaxLength = (field: FormField) => field.type === 'text' || field.type === 'date' ? field.maxLength : undefined;
const fieldMin = (field: FormField) => field.type === 'number' ? field.min : undefined;
const fieldMax = (field: FormField) => field.type === 'number' ? field.max : undefined;
const fieldOptions = (field: FormField) => field.type === 'select' ? field.options.join('、') : '';
const fieldChildren = (field: FormField) => field.type === 'table' ? field.children : [];

function templateChanges(before: TemplateSnapshot, after: TemplateSnapshot): TemplateChange[] {
  const changes: TemplateChange[] = [];
  if (before.name !== after.name) changes.push({ label: '模板名称', before: before.name, after: after.name });
  const fieldCount = Math.max(before.fields.length, after.fields.length);
  for (let index = 0; index < fieldCount; index += 1) {
    const previous = before.fields[index];
    const current = after.fields[index];
    const label = `字段 ${index + 1}`;
    if (!previous) { changes.push({ label: `${label} 新增`, after: fieldTitle(current) }); continue; }
    if (!current) { changes.push({ label: `${label} 删除`, before: fieldTitle(previous) }); continue; }
    if (previous.name !== current.name) changes.push({ label: `${label} 名称`, before: previous.name, after: current.name });
    if (previous.type !== current.type) changes.push({ label: `${label} 类型`, before: typeLabels[previous.type], after: typeLabels[current.type] });
    if (previous.required !== current.required) changes.push({ label: `${label} 必填`, before: previous.required ? '是' : '否', after: current.required ? '是' : '否' });
    const previousMaxLength = fieldMaxLength(previous);
    const currentMaxLength = fieldMaxLength(current);
    if (previousMaxLength !== currentMaxLength) changes.push({ label: `${label} 最大字符数`, before: previousMaxLength ?? '未限制', after: currentMaxLength ?? '未限制' });
    const previousMin = fieldMin(previous);
    const currentMin = fieldMin(current);
    if (previousMin !== currentMin) changes.push({ label: `${label} 最小值`, before: previousMin ?? '未限制', after: currentMin ?? '未限制' });
    const previousMax = fieldMax(previous);
    const currentMax = fieldMax(current);
    if (previousMax !== currentMax) changes.push({ label: `${label} 最大值`, before: previousMax ?? '未限制', after: currentMax ?? '未限制' });
    const previousOptions = fieldOptions(previous);
    const currentOptions = fieldOptions(current);
    if (previousOptions !== currentOptions) changes.push({ label: `${label} 选项`, before: previousOptions || '—', after: currentOptions || '—' });
    const previousChildren = fieldChildren(previous);
    const currentChildren = fieldChildren(current);
    const childCount = Math.max(previousChildren.length, currentChildren.length);
    for (let childIndex = 0; childIndex < childCount; childIndex += 1) {
      const previousChild = previousChildren[childIndex];
      const currentChild = currentChildren[childIndex];
      const childLabel = `${label} 子字段 ${childIndex + 1}`;
      if (!previousChild) { changes.push({ label: `${childLabel} 新增`, after: fieldTitle(currentChild) }); continue; }
      if (!currentChild) { changes.push({ label: `${childLabel} 删除`, before: fieldTitle(previousChild) }); continue; }
      if (previousChild.name !== currentChild.name) changes.push({ label: `${childLabel} 名称`, before: previousChild.name, after: currentChild.name });
      if (previousChild.type !== currentChild.type) changes.push({ label: `${childLabel} 类型`, before: typeLabels[previousChild.type], after: typeLabels[currentChild.type] });
      if (previousChild.required !== currentChild.required) changes.push({ label: `${childLabel} 必填`, before: previousChild.required ? '是' : '否', after: currentChild.required ? '是' : '否' });
      const previousChildMaxLength = fieldMaxLength(previousChild);
      const currentChildMaxLength = fieldMaxLength(currentChild);
      if (previousChildMaxLength !== currentChildMaxLength) changes.push({ label: `${childLabel} 最大字符数`, before: previousChildMaxLength ?? '未限制', after: currentChildMaxLength ?? '未限制' });
      const previousChildMin = fieldMin(previousChild);
      const currentChildMin = fieldMin(currentChild);
      if (previousChildMin !== currentChildMin) changes.push({ label: `${childLabel} 最小值`, before: previousChildMin ?? '未限制', after: currentChildMin ?? '未限制' });
      const previousChildMax = fieldMax(previousChild);
      const currentChildMax = fieldMax(currentChild);
      if (previousChildMax !== currentChildMax) changes.push({ label: `${childLabel} 最大值`, before: previousChildMax ?? '未限制', after: currentChildMax ?? '未限制' });
      const previousChildOptions = fieldOptions(previousChild);
      const currentChildOptions = fieldOptions(currentChild);
      if (previousChildOptions !== currentChildOptions) changes.push({ label: `${childLabel} 选项`, before: previousChildOptions || '—', after: currentChildOptions || '—' });
    }
  }
  return changes;
}

async function resolveDefaultTemplateId(conn?: PoolConnection): Promise<number | null> {
  const rows = async (sql: string, params: unknown[] = []): Promise<RowDataPacket[]> => {
    if (conn) { const [result] = await conn.query<RowDataPacket[]>(sql, params); return result; }
    return queryRows<RowDataPacket>(sql, params);
  };
  const settings = await rows("SELECT value_json FROM hr_settings WHERE setting_key = 'self_onboarding_default'");
  const current = settings.length ? Number(decode(settings[0].value_json)) : NaN;
  if (Number.isInteger(current) && current > 0) {
    const exists = await rows('SELECT id FROM hr_onboarding_form_templates WHERE id = ?', [current]);
    if (exists.length) return current;
  }
  const first = await rows('SELECT id FROM hr_onboarding_form_templates ORDER BY id LIMIT 1');
  if (!first.length) return null;
  const id = Number(first[0].id);
  if (conn) await conn.execute(defaultSettingSql, [JSON.stringify(id)]);
  else await execute(defaultSettingSql, [JSON.stringify(id)]);
  return id;
}

async function ensureInitialTemplate(): Promise<void> {
  const existing = await queryOne<{ id: number }>('SELECT id FROM hr_onboarding_form_templates ORDER BY id LIMIT 1');
  if (existing) return;
  const legacy = await queryOne<{ value_json: unknown }>("SELECT value_json FROM hr_settings WHERE setting_key = 'self_onboarding_template'");
  const fields = parse(formTemplateSchema, legacy ? decode(legacy.value_json) : defaultTemplate);
  await transaction(async conn => {
    const [rows] = await conn.query<RowDataPacket[]>('SELECT id FROM hr_onboarding_form_templates ORDER BY id LIMIT 1 FOR UPDATE');
    if (rows.length) return;
    const [result] = await conn.execute<ResultSetHeader>("INSERT INTO hr_onboarding_form_templates (name, fields_json, version, created_at, updated_at) VALUES ('标准入职申请表', ?, 1, NOW(), NOW())", [JSON.stringify(fields)]);
    const [settings] = await conn.query<RowDataPacket[]>("SELECT value_json FROM hr_settings WHERE setting_key = 'self_onboarding_default' FOR UPDATE");
    const current = settings.length ? Number(decode(settings[0].value_json)) : NaN;
    let valid = false;
    if (Number.isInteger(current) && current > 0) {
      const [found] = await conn.query<RowDataPacket[]>('SELECT id FROM hr_onboarding_form_templates WHERE id = ?', [current]);
      valid = found.length > 0;
    }
    if (!valid) await conn.execute(defaultSettingSql, [JSON.stringify(result.insertId)]);
  });
}

async function recordTemplateHistory(conn: PoolConnection, input: {
  templateId: number; templateName: string; action: 'create' | 'update' | 'delete';
  before: TemplateSnapshot | null; after: TemplateSnapshot | null; changes: TemplateChange[]; admin: AdminUser;
}): Promise<void> {
  await conn.execute(
    `INSERT INTO hr_onboarding_form_template_history
      (template_id, template_name, action, before_json, after_json, changes_json, admin_id, admin_name, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
    [
      input.templateId,
      input.templateName,
      input.action,
      input.before ? JSON.stringify(input.before) : null,
      input.after ? JSON.stringify(input.after) : null,
      JSON.stringify(input.changes),
      input.admin.id,
      input.admin.name,
    ]
  );
}

const admin = Router();
admin.use(requireAdmin, requireSuperAdmin);
admin.get('/attachments/:id', asyncHandler(async (req, res) => {
  const id = parse(z.string().uuid(), req.params.id);
  const file = await getOnboardingFile(id);
  const encoded = encodeURIComponent(file.file_name).replace(/['()*]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
  res.set({ 'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename="attachment"; filename*=UTF-8''${encoded}`, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' });
  res.send(file.file_data);
}));
admin.get('/templates', asyncHandler(async (_req, res) => {
  await ensureInitialTemplate();
  const rows = await queryRows<TemplateRow>('SELECT id, name, fields_json, version, updated_at AS updatedAt FROM hr_onboarding_form_templates ORDER BY id');
  const defaultId = await resolveDefaultTemplateId();
  success(res, rows.map(row => ({
    id: row.id,
    name: row.name || `模板${row.id}`,
    fields: decode(row.fields_json),
    version: row.version,
    updatedAt: row.updatedAt,
    isDefault: row.id === defaultId,
  })));
}));
admin.post('/templates', asyncHandler(async (req, res) => {
  const input = parse(z.object({ name: templateNameSchema, fields: formTemplateSchema }), req.body);
  const id = await transaction(async conn => {
    const [result] = await conn.execute<ResultSetHeader>('INSERT INTO hr_onboarding_form_templates (name, fields_json, version, created_at, updated_at) VALUES (?, ?, 1, NOW(), NOW())', [input.name, JSON.stringify(input.fields)]);
    await recordTemplateHistory(conn, { templateId: result.insertId, templateName: input.name, action: 'create', before: null, after: { name: input.name, fields: input.fields }, changes: [], admin: req.admin! });
    await resolveDefaultTemplateId(conn);
    return result.insertId;
  });
  await recordAdminLog(req.admin!, '新建入职申请模板', 'hr_onboarding_form_templates', String(id), { name: input.name });
  success(res, { id, version: 1 });
}));
admin.put('/templates/:id', asyncHandler(async (req, res) => {
  const id = parse(templateIdSchema, req.params.id);
  const input = parse(z.object({ name: templateNameSchema, fields: formTemplateSchema, version: z.number().int().min(1) }), req.body);
  const outcome = await transaction(async conn => {
    const [rows] = await conn.query<RowDataPacket[]>('SELECT id, name, fields_json, version FROM hr_onboarding_form_templates WHERE id = ? FOR UPDATE', [id]);
    if (!rows.length) throw notFound('模板不存在');
    const row = rows[0];
    const currentVersion = Number(row.version);
    if (currentVersion !== input.version) throw conflict('模板已被其他管理员修改，请刷新后重试');
    const before: TemplateSnapshot = { name: String(row.name || `模板${id}`), fields: parse(formTemplateSchema, decode(row.fields_json)) };
    const after: TemplateSnapshot = { name: input.name, fields: input.fields };
    if (answersEqual(before, after)) return { version: currentVersion, changed: false };
    const nextVersion = currentVersion + 1;
    await conn.execute('UPDATE hr_onboarding_form_templates SET name = ?, fields_json = ?, version = ?, updated_at = NOW() WHERE id = ?', [input.name, JSON.stringify(input.fields), nextVersion, id]);
    if (id === 1) await conn.execute(legacySettingSql, [JSON.stringify(input.fields)]);
    await recordTemplateHistory(conn, { templateId: id, templateName: input.name, action: 'update', before, after, changes: templateChanges(before, after), admin: req.admin! });
    return { version: nextVersion, changed: true };
  });
  if (outcome.changed) await recordAdminLog(req.admin!, '修改入职申请模板', 'hr_onboarding_form_templates', String(id), { changed: true });
  success(res, outcome);
}));
admin.delete('/templates/:id', asyncHandler(async (req, res) => {
  const id = parse(templateIdSchema, req.params.id);
  await transaction(async conn => {
    const [rows] = await conn.query<RowDataPacket[]>('SELECT id, name, fields_json, version FROM hr_onboarding_form_templates WHERE id = ? FOR UPDATE', [id]);
    if (!rows.length) throw notFound('模板不存在');
    const [all] = await conn.query<RowDataPacket[]>('SELECT id FROM hr_onboarding_form_templates FOR UPDATE');
    if (all.length <= 1) throw badRequest('至少保留一个入职申请模板');
    const defaultId = await resolveDefaultTemplateId(conn);
    if (defaultId === id) throw badRequest('现用模板不能删除，请先切换现用模板');
    const before: TemplateSnapshot = { name: String(rows[0].name || `模板${id}`), fields: parse(formTemplateSchema, decode(rows[0].fields_json)) };
    await conn.execute('DELETE FROM hr_onboarding_form_templates WHERE id = ?', [id]);
    if (id === 1) await conn.execute("DELETE FROM hr_settings WHERE setting_key = 'self_onboarding_template'");
    await recordTemplateHistory(conn, { templateId: id, templateName: before.name, action: 'delete', before, after: null, changes: [], admin: req.admin! });
  });
  await recordAdminLog(req.admin!, '删除入职申请模板', 'hr_onboarding_form_templates', String(id), {});
  success(res, {});
}));
admin.get('/template-history', asyncHandler(async (req, res) => {
  const query = parse(z.object({ templateId: z.coerce.number().int().positive().optional(), limit: z.coerce.number().int().min(1).max(200).optional() }), req.query);
  const params: unknown[] = query.templateId ? [query.templateId] : [];
  const where = query.templateId ? 'WHERE template_id = ?' : '';
  params.push(query.limit ?? 200);
  const rows = await queryRows<Record<string, unknown>>(
    `SELECT id, template_id AS templateId, template_name AS templateName, action,
            before_json AS beforeJson, after_json AS afterJson, changes_json AS changesJson,
            admin_id AS adminId, admin_name AS adminName, created_at AS createdAt
     FROM hr_onboarding_form_template_history ${where} ORDER BY id DESC LIMIT ?`,
    params
  );
  success(res, rows.map(({ beforeJson, afterJson, changesJson, ...row }) => ({
    ...row,
    before: beforeJson ? decode(beforeJson) : null,
    after: afterJson ? decode(afterJson) : null,
    changes: decode(changesJson),
  })));
}));
admin.put('/templates/:id/default', asyncHandler(async (req, res) => {
  const id = parse(templateIdSchema, req.params.id); await ensureInitialTemplate();
  await transaction(async conn => {
    const [rows] = await conn.query<RowDataPacket[]>('SELECT id FROM hr_onboarding_form_templates WHERE id = ? FOR UPDATE', [id]);
    if (!rows.length) throw notFound('模板不存在');
    await conn.execute(defaultSettingSql, [JSON.stringify(id)]);
  });
  await recordAdminLog(req.admin!, '设置默认入职申请模板', 'hr_onboarding_form_templates', String(id), {}); success(res, {});
}));
admin.get('/eligible', asyncHandler(async (_req, res) => {
  success(res, await queryRows("SELECT e.id, e.name, e.employee_no AS employeeNo, a.login_name AS loginName FROM employees e JOIN employee_accounts a ON a.employee_id = e.id AND a.status = 'active' WHERE NOT EXISTS (SELECT 1 FROM hr_self_onboarding s WHERE s.employee_id = e.id) AND NOT EXISTS (SELECT 1 FROM hr_employee_departures d WHERE d.employee_id = e.id AND d.status = 'departed') ORDER BY e.pinyin"));
}));
admin.get('/applications', asyncHandler(async (_req, res) => {
  const rows = await queryRows<{ template: unknown; answers: unknown }>("SELECT s.id, s.employee_id AS employeeId, e.name, e.employee_no AS employeeNo, a.login_name AS loginName, s.expected_date AS expectedDate, s.template_json AS template, s.answers_json AS answers, s.created_at AS createdAt, s.submitted_at AS submittedAt, s.archived_at AS archivedAt FROM hr_self_onboarding s FORCE INDEX (PRIMARY) STRAIGHT_JOIN employees e ON e.id = s.employee_id LEFT JOIN employee_accounts a ON a.employee_id = e.id ORDER BY s.id DESC");
  success(res, rows.map(r => { const saved = decode(r.answers) as { __onboardingFormat?: number; values?: unknown; photo?: string; signature?: string; declaration?: string; declarationAccepted?: boolean } | null; return { ...r, template: decode(r.template), answers: saved?.__onboardingFormat === 2 ? saved.values : saved, photo: saved?.__onboardingFormat === 2 ? saved.photo : null, signature: saved?.__onboardingFormat === 2 ? saved.signature : null, declaration: saved?.__onboardingFormat === 2 ? saved.declaration : null, declarationAccepted: saved?.__onboardingFormat === 2 ? saved.declarationAccepted : null }; }));
}));
admin.post('/applications', asyncHandler(async (req, res) => {
  const input = parse(z.object({ employeeId: z.string().min(1).max(10), expectedDate: z.string().date() }), req.body);
  await ensureInitialTemplate();
  const id = await transaction(async conn => {
    const [employees] = await conn.query<RowDataPacket[]>("SELECT e.id FROM employees e JOIN employee_accounts a ON a.employee_id = e.id AND a.status = 'active' WHERE e.id = ? FOR UPDATE", [input.employeeId]);
    if (!employees.length) throw badRequest('员工账号不存在或未启用');
    const [departures] = await conn.query<RowDataPacket[]>("SELECT id FROM hr_employee_departures WHERE employee_id = ? AND status = 'departed'", [input.employeeId]);
    const [existing] = await conn.query<RowDataPacket[]>('SELECT id FROM hr_self_onboarding WHERE employee_id = ?', [input.employeeId]);
    if (departures.length || existing.length) throw badRequest('该员工已离职或已有入职申请');
    const defaultId = await resolveDefaultTemplateId(conn);
    if (!defaultId) throw badRequest('暂无入职申请模板');
    const [templates] = await conn.query<RowDataPacket[]>('SELECT fields_json FROM hr_onboarding_form_templates WHERE id = ? FOR UPDATE', [defaultId]);
    if (!templates.length) throw badRequest('默认入职申请模板不存在');
    const template = parse(formTemplateSchema, decode(templates[0].fields_json));
    const [result] = await conn.execute<ResultSetHeader>('INSERT INTO hr_self_onboarding (employee_id, expected_date, template_json, created_at) VALUES (?, ?, ?, NOW())', [input.employeeId, input.expectedDate, JSON.stringify(template)]);
    return result.insertId;
  });
  await recordAdminLog(req.admin!, '登记员工入职申请', 'hr_self_onboarding', String(id), { employeeId: input.employeeId });
  success(res, { id });
}));
admin.post('/applications/:id/return', asyncHandler(async (req, res) => {
  const id = parse(applicationIdSchema, req.params.id);
  await transaction(async conn => {
    const [rows] = await conn.query<RowDataPacket[]>('SELECT id, template_json, answers_json, submitted_at, archived_at FROM hr_self_onboarding WHERE id = ? FOR UPDATE', [id]);
    if (!rows.length) throw notFound('入职申请不存在');
    if (rows[0].archived_at) throw badRequest('申请已封存，无法打回');
    if (!rows[0].submitted_at || rows[0].answers_json === null) throw badRequest('员工尚未提交，无法打回');
    const defaultId = await resolveDefaultTemplateId(conn);
    if (!defaultId) throw badRequest('暂无现用入职申请模板');
    const [templates] = await conn.query<RowDataPacket[]>('SELECT fields_json FROM hr_onboarding_form_templates WHERE id = ? FOR UPDATE', [defaultId]);
    if (!templates.length) throw badRequest('现用入职申请模板不存在');
    const currentTemplate = parse(formTemplateSchema, decode(templates[0].fields_json));
    await conn.execute('INSERT INTO hr_self_onboarding_submissions (onboarding_id, answers_json, template_json, submitted_at, returned_at, admin_id, admin_name) VALUES (?, ?, ?, ?, NOW(), ?, ?)', [id, JSON.stringify(decode(rows[0].answers_json)), JSON.stringify(decode(rows[0].template_json)), rows[0].submitted_at, req.admin!.id, req.admin!.name]);
    await conn.execute('UPDATE hr_self_onboarding SET submitted_at = NULL, template_json = ? WHERE id = ?', [JSON.stringify(currentTemplate), id]);
  });
  await recordAdminLog(req.admin!, '打回入职申请', 'hr_self_onboarding', String(id), {});
  success(res, {});
}));
admin.post('/applications/:id/archive', asyncHandler(async (req, res) => {
  const id = parse(applicationIdSchema, req.params.id);
  await transaction(async conn => {
    const [rows] = await conn.query<RowDataPacket[]>('SELECT id, answers_json, submitted_at, archived_at FROM hr_self_onboarding WHERE id = ? FOR UPDATE', [id]);
    if (!rows.length) throw notFound('入职申请不存在');
    if (rows[0].archived_at) throw badRequest('申请已封存');
    if (!rows[0].submitted_at || rows[0].answers_json === null) throw badRequest('员工尚未提交，无法封存');
    await conn.execute('UPDATE hr_self_onboarding SET archived_at = NOW(), archived_by = ? WHERE id = ?', [req.admin!.id, id]);
  });
  await recordAdminLog(req.admin!, '封存入职申请', 'hr_self_onboarding', String(id), {});
  success(res, {});
}));
admin.get('/archived/:employeeId', asyncHandler(async (req, res) => {
  const employeeId = parse(z.string().min(1).max(10), req.params.employeeId);
  const row = await queryOne<{ template: unknown; answers: unknown; archivedAt: string; submittedAt: string }>('SELECT template_json AS template, answers_json AS answers, archived_at AS archivedAt, submitted_at AS submittedAt FROM hr_self_onboarding WHERE employee_id = ? AND archived_at IS NOT NULL', [employeeId]);
  if (!row) { success(res, null); return; }
  const saved = decode(row.answers) as { __onboardingFormat?: number; values?: unknown; photo?: string; signature?: string; declaration?: string; declarationAccepted?: boolean } | null;
  success(res, { ...row, template: decode(row.template), answers: saved?.__onboardingFormat === 2 ? saved.values : saved, photo: saved?.__onboardingFormat === 2 ? saved.photo : null, signature: saved?.__onboardingFormat === 2 ? saved.signature : null, declaration: saved?.__onboardingFormat === 2 ? saved.declaration : null, declarationAccepted: saved?.__onboardingFormat === 2 ? saved.declarationAccepted : null });
}));
admin.get('/applications/:id/submissions', asyncHandler(async (req, res) => {
  const id = parse(applicationIdSchema, req.params.id);
  if (!await queryOne('SELECT id FROM hr_self_onboarding WHERE id = ?', [id])) throw notFound('入职申请不存在');
  const rows = await queryRows<{ answers: unknown; template: unknown }>('SELECT id, answers_json AS answers, template_json AS template, submitted_at AS submittedAt, returned_at AS returnedAt, admin_name AS adminName FROM hr_self_onboarding_submissions FORCE INDEX (idx_self_onboarding_submission) WHERE onboarding_id = ? ORDER BY id DESC', [id]);
  success(res, rows.map(row => ({ ...row, answers: decode(row.answers), template: decode(row.template) })));
}));
admin.get('/applications/:id/history', asyncHandler(async (req, res) => {
  const id = parse(applicationIdSchema, req.params.id);
  const application = await queryOne<{ id: number }>('SELECT id FROM hr_self_onboarding WHERE id = ?', [id]);
  if (!application) throw notFound('入职申请不存在');
  const history = await queryRows<Record<string, unknown>>(
    `SELECT id, onboarding_id AS onboardingId, before_json AS beforeJson, after_json AS afterJson,
            changes_json AS changesJson, admin_id AS adminId, admin_name AS adminName, created_at AS createdAt
     FROM hr_self_onboarding_edits WHERE onboarding_id = ? ORDER BY id DESC LIMIT 100`,
    [id]
  );
  success(res, history.map(({ beforeJson, afterJson, changesJson, ...row }) => ({
    ...row,
    before: decode(beforeJson),
    after: decode(afterJson),
    changes: decode(changesJson),
  })));
}));
export default admin;
