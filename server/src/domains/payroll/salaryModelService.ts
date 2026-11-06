import type { PoolConnection, RowDataPacket } from 'mysql2/promise';
import { queryOne } from '../../shared/db/pool';
import { badRequest } from '../../shared/utils/errors';

export type SalaryFieldType = 'number' | 'text';
export type SalaryFieldRole = 'name' | 'employeeNo' | 'position' | 'base' | 'allowance' | 'performance';
export type SalaryFieldCategory = 'income' | 'deduction' | 'info';
export type AttendanceMetric = 'presentDays' | 'overtimeHours' | 'overtimePay';
export type SalaryCalculationRule = 'direct' | 'attendance' | 'overtime';
export type SalaryDisplaySetting = 'none' | 'display' | 'output';

export interface SalaryModelField {
  name: string;
  type: SalaryFieldType;
  required: boolean;
  role?: SalaryFieldRole;
  category?: SalaryFieldCategory;
  interfaceSource?: 'attendance';
  attendanceMetric?: AttendanceMetric;
  calculationRule?: SalaryCalculationRule;
  displaySetting?: SalaryDisplaySetting;
}

export interface SalaryModel {
  version: number;
  fixedFields: SalaryModelField[];
  extendedFields: SalaryModelField[];
  fieldOrder?: string[];
}

export function reconcileSalaryFieldOrder(order: readonly string[], names: readonly string[]): string[] {
  const allowed = new Set(names);
  const result = [...new Set(order.filter(name => allowed.has(name)))];
  const used = new Set(result);
  return [...result, ...names.filter(name => !used.has(name))];
}

export function validateSalaryFieldOrder(order: readonly string[], names: readonly string[]): string[] {
  if (order.length !== names.length || new Set(order).size !== names.length || order.some(name => !names.includes(name))) throw badRequest('字段顺序必须包含所有字段且不能重复');
  return [...order];
}

const MODEL_KEY = 'salary_component_model';
const LEGACY_KEY = 'salary_component_models';
const IDENTITY_FIELDS: SalaryModelField[] = [
  { name: '姓名', type: 'text', required: true, role: 'name' },
  { name: '员工号', type: 'text', required: true, role: 'employeeNo' },
  { name: '职务', type: 'text', required: true, role: 'position' },
];
const IDENTITY_ROLES = new Set<SalaryFieldRole>(['name', 'employeeNo', 'position']);
const AMOUNT_ROLES = new Set<SalaryFieldRole>(['base', 'allowance', 'performance']);
const ROLE_NAMES: Array<[SalaryFieldRole, string[]]> = [
  ['name', ['姓名']],
  ['employeeNo', ['员工号', '工号']],
  ['position', ['职务']],
  ['base', ['基础薪资', '基础工资', '基本工资']],
  ['allowance', ['固定补贴', '补贴']],
  ['performance', ['绩效薪资', '绩效工资']],
];

const asRecord = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
const asArray = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const isRole = (value: unknown): value is SalaryFieldRole => typeof value === 'string' && (IDENTITY_ROLES.has(value as SalaryFieldRole) || AMOUNT_ROLES.has(value as SalaryFieldRole));

function inferRole(name: string): SalaryFieldRole | undefined {
  return ROLE_NAMES.find(([, names]) => names.includes(name))?.[0];
}

function parseField(raw: unknown, strict: boolean): SalaryModelField | null {
  const source = typeof raw === 'string' ? { name: raw, type: 'number', required: true } : asRecord(raw);
  if (!source) return null;
  const name = typeof source.name === 'string' ? source.name.trim() : '';
  if (!name) return null;
  const role = isRole(source.role) ? source.role : inferRole(name);
  const identity = !!role && IDENTITY_ROLES.has(role);
  const rawType: SalaryFieldType = source.type === 'text' ? 'text' : 'number';
  const category = source.category;
  const interfaceSource = source.interfaceSource;
  const displaySetting = source.displaySetting;
  const attendanceMetric = source.attendanceMetric;
  const calculationRule = source.calculationRule;
  if (strict && category !== undefined && category !== 'income' && category !== 'deduction' && category !== 'info') throw badRequest('字段用途无效');
  if (strict && rawType === 'text' && category !== undefined && category !== 'info' && !identity) throw badRequest('字符串字段用途只能是仅记录');
  if (strict && interfaceSource !== undefined && interfaceSource !== 'none' && interfaceSource !== 'attendance') throw badRequest('接口配置无效');
  if (strict && attendanceMetric !== undefined && attendanceMetric !== 'presentDays' && attendanceMetric !== 'overtimeHours' && attendanceMetric !== 'overtimePay') throw badRequest('考勤数据项目无效');
  if (strict && calculationRule !== undefined && calculationRule !== 'direct' && calculationRule !== 'attendance' && calculationRule !== 'overtime') throw badRequest('计算规则无效');
  const effectiveRule = attendanceMetric === 'overtimePay' ? 'overtime' : calculationRule ?? 'direct';
  if (strict && calculationRule !== undefined && (interfaceSource !== 'attendance' || !attendanceMetric)) throw badRequest('计算规则必须绑定考勤数据');
  if (strict && attendanceMetric === 'overtimePay' && calculationRule !== undefined) throw badRequest('旧加班费字段不能单独设置计算规则');
  if (strict && ((effectiveRule === 'attendance' && attendanceMetric !== 'presentDays') || (effectiveRule === 'overtime' && attendanceMetric !== 'overtimeHours' && attendanceMetric !== 'overtimePay'))) throw badRequest('考勤数据与计算规则不匹配');
  if (strict && attendanceMetric !== undefined && (interfaceSource !== 'attendance' || rawType !== 'number' || category !== (effectiveRule === 'direct' ? 'info' : 'income') || identity)) throw badRequest('考勤数据字段类型或用途无效');
  if (strict && displaySetting !== undefined && displaySetting !== 'none' && displaySetting !== 'display' && displaySetting !== 'output') throw badRequest('显示设置无效');
  return {
    name: identity ? IDENTITY_FIELDS.find(field => field.role === role)!.name : name,
    type: identity ? 'text' : rawType,
    required: identity ? true : source.required !== false,
    ...(role && (identity || rawType === 'number') ? { role } : {}),
    ...(!identity && (category === 'income' || category === 'deduction' || category === 'info') && rawType === 'number' ? { category } : {}),
    ...(!identity && rawType === 'text' ? { category: 'info' as const } : {}),
    ...(!identity && interfaceSource === 'attendance' ? { interfaceSource: 'attendance' as const } : {}),
    ...(!identity && interfaceSource === 'attendance' && (attendanceMetric === 'presentDays' || attendanceMetric === 'overtimeHours' || attendanceMetric === 'overtimePay') ? { attendanceMetric } : {}),
    ...(!identity && interfaceSource === 'attendance' && (calculationRule === 'direct' || calculationRule === 'attendance' || calculationRule === 'overtime') ? { calculationRule } : {}),
    ...(displaySetting === 'display' || displaySetting === 'output' ? { displaySetting } : {}),
  };
}

function normalizedVersion(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : 1;
}

/** 读取时宽松归一化：补齐身份字段、推断角色、去重并截断到上限。 */
export function normalizeStoredModel(value: unknown): SalaryModel {
  let parsed: unknown = value;
  if (typeof value === 'string') {
    try { parsed = JSON.parse(value); } catch { parsed = null; }
  }
  let version = 1;
  let rawFixed: unknown[] = [];
  let rawExtended: unknown[] = [];
  let rawOrder: unknown;
  if (Array.isArray(parsed)) {
    const first = asRecord(parsed[0]);
    rawFixed = asArray(first?.fields);
  } else {
    const object = asRecord(parsed);
    if (object) {
      version = normalizedVersion(object.version);
      rawFixed = asArray(object.fixedFields);
      rawExtended = asArray(object.extendedFields);
      rawOrder = object.fieldOrder;
    }
  }

  const names = new Set(IDENTITY_FIELDS.map(field => field.name));
  const roles = new Set<SalaryFieldRole>();
  const identityFields = IDENTITY_FIELDS.map(field => ({ ...field }));
  const amountFields: SalaryModelField[] = [];
  for (const raw of rawFixed) {
    const field = parseField(raw, false);
    if (!field) continue;
    if (field.role && IDENTITY_ROLES.has(field.role)) {
      const identity = identityFields.find(item => item.role === field.role);
      if (identity && field.displaySetting) identity.displaySetting = field.displaySetting;
      continue;
    }
    if (names.has(field.name)) continue;
    const role = field.role && AMOUNT_ROLES.has(field.role) && !roles.has(field.role) ? field.role : undefined;
    if (role) roles.add(role);
    names.add(field.name);
    amountFields.push({ name: field.name, type: field.type, required: field.required, ...(role ? { role } : {}), ...(field.category ? { category: field.category } : {}), ...(field.interfaceSource ? { interfaceSource: field.interfaceSource } : {}), ...(field.attendanceMetric ? { attendanceMetric: field.attendanceMetric } : {}), ...(field.calculationRule ? { calculationRule: field.calculationRule } : {}), ...(field.displaySetting ? { displaySetting: field.displaySetting } : {}) });
    if (amountFields.length >= 48) break;
  }
  const extendedFields: SalaryModelField[] = [];
  for (const raw of rawExtended) {
    const field = parseField(raw, false);
    if (!field || (field.role && IDENTITY_ROLES.has(field.role))) continue;
    if (names.has(field.name)) continue;
    if (IDENTITY_FIELDS.length + amountFields.length + extendedFields.length >= 51) break;
    names.add(field.name);
    extendedFields.push({ name: field.name, type: field.type, required: field.required, category: field.category ?? 'info', ...(field.interfaceSource ? { interfaceSource: field.interfaceSource } : {}), ...(field.attendanceMetric ? { attendanceMetric: field.attendanceMetric } : {}), ...(field.calculationRule ? { calculationRule: field.calculationRule } : {}), ...(field.displaySetting ? { displaySetting: field.displaySetting } : {}) });
  }
  const fixedFields = [...identityFields, ...amountFields];
  const namesInModel = [...fixedFields, ...extendedFields].map(field => field.name);
  const fieldOrder = Array.isArray(rawOrder) ? reconcileSalaryFieldOrder(rawOrder.filter((name): name is string => typeof name === 'string'), namesInModel) : undefined;
  return { version, fixedFields, extendedFields, ...(fieldOrder ? { fieldOrder } : {}) };
}

/** 保存时严格归一化：注入姓名/员工号，校验类型、重名和总数。 */
export function normalizeModelInput(fixedFields: unknown, extendedFields: unknown): Pick<SalaryModel, 'fixedFields' | 'extendedFields'> {
  const names = new Set(IDENTITY_FIELDS.map(field => field.name));
  const roles = new Set<SalaryFieldRole>();
  const identityFields = IDENTITY_FIELDS.map(field => ({ ...field }));
  const amountFields: SalaryModelField[] = [];
  for (const raw of asArray(fixedFields)) {
    const field = parseField(raw, true);
    if (!field) throw badRequest('请输入字段名称');
    if (field.role && IDENTITY_ROLES.has(field.role)) {
      const identity = identityFields.find(item => item.role === field.role);
      if (identity && field.displaySetting) identity.displaySetting = field.displaySetting;
      continue;
    }
    if (names.has(field.name)) throw badRequest('字段名称不能重复');
    const role = field.role && AMOUNT_ROLES.has(field.role) && !roles.has(field.role) ? field.role : undefined;
    if (role) roles.add(role);
    names.add(field.name);
    amountFields.push({ name: field.name, type: field.type, required: field.required, ...(role ? { role } : {}), ...(field.category ? { category: field.category } : {}), ...(field.interfaceSource ? { interfaceSource: field.interfaceSource } : {}), ...(field.attendanceMetric ? { attendanceMetric: field.attendanceMetric } : {}), ...(field.calculationRule ? { calculationRule: field.calculationRule } : {}), ...(field.displaySetting ? { displaySetting: field.displaySetting } : {}) });
  }
  const normalizedExtended: SalaryModelField[] = [];
  for (const raw of asArray(extendedFields)) {
    const field = parseField(raw, true);
    if (!field) throw badRequest('请输入字段名称');
    if (field.role && IDENTITY_ROLES.has(field.role)) throw badRequest('姓名、员工号和职务是固定字段，不能添加到扩展字段');
    if (names.has(field.name)) throw badRequest('字段名称不能重复');
    names.add(field.name);
    normalizedExtended.push({ name: field.name, type: field.type, required: field.required, category: field.category ?? 'info', ...(field.interfaceSource ? { interfaceSource: field.interfaceSource } : {}), ...(field.attendanceMetric ? { attendanceMetric: field.attendanceMetric } : {}), ...(field.calculationRule ? { calculationRule: field.calculationRule } : {}), ...(field.displaySetting ? { displaySetting: field.displaySetting } : {}) });
  }
  if ([...amountFields, ...normalizedExtended].filter(field => field.attendanceMetric === 'overtimePay' || field.calculationRule === 'overtime').length > 1) throw badRequest('加班费计算来源只能配置一个字段');
  if ([...amountFields, ...normalizedExtended].filter(field => field.calculationRule === 'attendance').length > 1) throw badRequest('出勤绩效计算来源只能配置一个字段');
  if (IDENTITY_FIELDS.length + amountFields.length + normalizedExtended.length > 51) throw badRequest('最多配置 51 个字段');
  return {
    fixedFields: [...identityFields, ...amountFields],
    extendedFields: normalizedExtended,
  };
}

export async function readSalaryModel(conn?: PoolConnection, lock = false): Promise<SalaryModel> {
  if (conn) {
    const [rows] = await conn.query<RowDataPacket[]>(`SELECT value_json FROM hr_settings WHERE setting_key = ?${lock ? ' FOR UPDATE' : ''}`, [MODEL_KEY]);
    if (rows.length) return normalizeStoredModel(rows[0].value_json);
    const [legacy] = await conn.query<RowDataPacket[]>('SELECT value_json FROM hr_settings WHERE setting_key = ?', [LEGACY_KEY]);
    return legacy.length ? normalizeStoredModel(legacy[0].value_json) : normalizeStoredModel(null);
  }
  const row = await queryOne<{ value_json: unknown }>('SELECT value_json FROM hr_settings WHERE setting_key = ?', [MODEL_KEY]);
  if (row) return normalizeStoredModel(row.value_json);
  const legacy = await queryOne<{ value_json: unknown }>('SELECT value_json FROM hr_settings WHERE setting_key = ?', [LEGACY_KEY]);
  return legacy ? normalizeStoredModel(legacy.value_json) : normalizeStoredModel(null);
}

export function salaryAmountFields(model: SalaryModel): SalaryModelField[] {
  return model.fixedFields.filter(field => !field.role || !IDENTITY_ROLES.has(field.role));
}

export type SalaryValue = number | string | null;

export function buildSalaryValues(record: Record<string, unknown>, model: SalaryModel): Record<string, SalaryValue> {
  const stored = asRecord(record.values);
  const values: Record<string, SalaryValue> = {};
  for (const field of salaryAmountFields(model)) {
    const direct = stored?.[field.name];
    if (typeof direct === 'number' || typeof direct === 'string' || direct === null) { values[field.name] = direct; continue; }
    const mirror = !stored ? (field.role === 'base' ? record.base : field.role === 'allowance' ? record.allowance : field.role === 'performance' ? record.performance : undefined) : undefined;
    values[field.name] = typeof mirror === 'number' ? mirror : field.type === 'text' ? '' : 0;
  }
  return values;
}

function convertSalaryValue(value: SalaryValue, type: SalaryFieldType, name: string): SalaryValue {
  if (value === null) return null;
  if (type === 'text') return typeof value === 'number' ? String(value) : value;
  if (typeof value === 'number') return value;
  if (value === '') return 0;
  const converted = Number(value);
  if (!Number.isFinite(converted) || converted < 0 || converted > 9999999999.99 || String(converted) !== value || Math.abs(converted * 100 - Math.round(converted * 100)) > 1e-7) throw badRequest(`字段“${name}”存在无法无损转换的员工定薪，请先处理`);
  return converted;
}

export function synchronizeSalaryRecord(record: Record<string, unknown>, previous: SalaryModel, next: SalaryModel): Record<string, unknown> {
  const oldValues = buildSalaryValues(record, previous);
  const values: Record<string, SalaryValue> = {};
  for (const field of salaryAmountFields(next)) {
    values[field.name] = Object.hasOwn(oldValues, field.name) ? convertSalaryValue(oldValues[field.name], field.type, field.name) : field.type === 'text' ? '' : 0;
  }
  const roleValue = (role: SalaryFieldRole): number | null => {
    const field = salaryAmountFields(next).find(item => item.role === role);
    const value = field ? values[field.name] : null;
    return typeof value === 'number' ? value : null;
  };
  return { ...record, values, base: roleValue('base'), allowance: roleValue('allowance'), performance: roleValue('performance'), modelVersion: next.version };
}

export interface ValidatedSalaryValues {
  values: Record<string, SalaryValue>;
  base: number | null;
  allowance: number | null;
  performance: number | null;
}

export function validateSalaryValues(input: Record<string, SalaryValue>, model: SalaryModel): ValidatedSalaryValues {
  const fields = salaryAmountFields(model);
  const allowed = new Set(fields.map(field => field.name));
  for (const key of Object.keys(input)) if (!allowed.has(key)) throw badRequest(`未知薪资字段：${key}`);
  const values: Record<string, SalaryValue> = {};
  for (const field of fields) {
    const value = input[field.name] ?? null;
    if (field.required && (value === null || (field.type === 'text' && value === ''))) throw badRequest(`请填写${field.name}`);
    if (value !== null && (typeof value !== (field.type === 'text' ? 'string' : 'number'))) throw badRequest(`字段${field.name}类型不匹配`);
    values[field.name] = value;
  }
  const roleValue = (role: SalaryFieldRole): number | null => {
    const field = fields.find(item => item.role === role); const value = field ? values[field.name] : null;
    return typeof value === 'number' ? value : null;
  };
  return { values, base: roleValue('base'), allowance: roleValue('allowance'), performance: roleValue('performance') };
}
