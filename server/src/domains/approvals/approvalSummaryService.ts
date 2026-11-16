import type { RowDataPacket } from 'mysql2';

import { queryOne, queryRows } from '../../shared/db/pool';
import { formatTime } from '../../shared/utils/datetime';
import { badRequest } from '../../shared/utils/errors';
import { employeeApprovalFields } from './approvalFormFields';
import { parseApproverType } from './expenseApproverService';
import { readPublishedWorkflow } from './customWorkflowPublication';

export type ApprovalSummaryGroup = 'month' | 'organization' | 'position' | 'employee';
export type ApprovalSummaryFieldType = 'money' | 'number';

export interface ApprovalSummaryField {
  key: string;
  label: string;
  type: ApprovalSummaryFieldType;
}

export interface ApprovalSummaryRow {
  month?: string;
  organization?: string;
  position?: string;
  employee?: string;
  total: number;
  pending: number;
  approved: number;
  rejected: number;
  cancelled: number;
  sums: Record<string, number>;
}

export interface ApprovalSummaryTotals extends Omit<ApprovalSummaryRow, 'month' | 'organization' | 'position' | 'employee'> {}

export interface ApprovalSummaryEmployee {
  id: string;
  name: string;
  employeeNo: string;
  organizationId: string;
  position: string;
}

export interface ApprovalSummaryOptions {
  organizations: Array<{ id: string; name: string }>;
  positions: string[];
  employees: ApprovalSummaryEmployee[];
}

export interface ApprovalSummary {
  type: string;
  typeName: string;
  from: string;
  to: string;
  groups: ApprovalSummaryGroup[];
  selectedFields: ApprovalSummaryField[];
  availableFields: ApprovalSummaryField[];
  filters: { organization: string; position: string; employee: string };
  rows: ApprovalSummaryRow[];
  totals: ApprovalSummaryTotals;
}

interface SummaryTypeRow extends RowDataPacket { name: string; fields_json: string | Array<{ key: string; label: string; type: string }> }
interface EmployeeRow extends RowDataPacket { id: string; name: string; employee_no: string; dept_id: string; position: string }
interface SummaryEmployeeRow extends RowDataPacket { id: string; name: string; dept_id: string; position: string }
interface ApprovalRow extends RowDataPacket {
  status: string;
  applicant_id: string;
  applicant_name: string;
  applicant_position: string;
  created_at: Date | string;
  form_json?: string | Array<{ label: string; value: string }>;
}

const DATE_TEXT = /^\d{4}-\d{2}-\d{2}$/;
const GROUP_ORDER: ApprovalSummaryGroup[] = ['month', 'organization', 'position', 'employee'];

function validDate(value: string): boolean {
  if (!DATE_TEXT.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

/** 未指定日期时统计最近 12 个自然月。 */
function defaultRange(): { from: string; to: string } {
  const today = new Date();
  return {
    from: formatTime(new Date(today.getFullYear(), today.getMonth() - 11, 1), 'YYYY-MM-DD'),
    to: formatTime(today, 'YYYY-MM-DD'),
  };
}

function parseGroups(raw: string | undefined): ApprovalSummaryGroup[] {
  if (!raw) return ['month'];
  const requested = raw.split(',').map(value => value.trim()).filter(Boolean);
  const selected = GROUP_ORDER.filter(group => requested.includes(group));
  return selected.length ? selected : ['month'];
}

function parseJson<T>(value: string | T, fallback: T): T {
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

/** 发布流程优先，未发布类型读取类型目录中的字段；只保留金额和数字字段。 */
async function readNumericFields(type: string, typeFields: SummaryTypeRow['fields_json']): Promise<ApprovalSummaryField[]> {
  const publication = await readPublishedWorkflow(type);
  const fields = publication
    ? employeeApprovalFields(type, publication.fixedFields, publication.workflow.formFields ?? [])
    : parseJson<Array<{ key: string; label: string; type: string }>>(typeFields, []);
  const seen = new Set<string>();
  const result: ApprovalSummaryField[] = [];
  for (const field of fields) {
    if (field.type !== 'money' && field.type !== 'number') continue;
    if (!field.key || field.key.startsWith('__') || field.label.startsWith('__') || seen.has(field.key)) continue;
    seen.add(field.key);
    result.push({ key: field.key, label: field.label, type: field.type });
  }
  return result;
}

function numericValue(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const text = String(value ?? '').replace(/[¥,\s]/g, '');
  if (!text) return null;
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}

function emptyCounts(): { total: number; pending: number; approved: number; rejected: number; cancelled: number } {
  return { total: 0, pending: 0, approved: 0, rejected: 0, cancelled: 0 };
}

/** 汇总页切换审批类型时读取可统计字段，不执行单据查询。 */
export async function getApprovalSummaryFields(type: string): Promise<ApprovalSummaryField[]> {
  const parsed = parseApproverType(type.trim());
  const row = await queryOne<SummaryTypeRow>('SELECT `name`, `fields_json` FROM approval_types WHERE `key` = ? LIMIT 1', [parsed]);
  if (!row) throw badRequest('审批类型不存在');
  return readNumericFields(parsed, row.fields_json);
}

export async function getApprovalSummaryOptions(): Promise<ApprovalSummaryOptions> {
  const [organizations, titles, usedPositions, employees] = await Promise.all([
    queryRows<{ id: string; name: string }>('SELECT `id`, `name` FROM departments ORDER BY `sort_order`, `id`'),
    queryRows<{ name: string }>('SELECT `name` FROM job_titles ORDER BY `id`'),
    queryRows<{ position: string }>('SELECT DISTINCT `position` FROM employees WHERE `position` <> \'\' ORDER BY `position`'),
    queryRows<EmployeeRow>('SELECT `id`, `name`, `employee_no`, `dept_id`, `position` FROM employees ORDER BY `name`, `id`'),
  ]);
  const positions: string[] = [];
  for (const name of [...titles.map(row => row.name), ...usedPositions.map(row => row.position)]) {
    if (name && !positions.includes(name)) positions.push(name);
  }
  return {
    organizations: organizations.map(row => ({ id: row.id, name: row.name })),
    positions,
    employees: employees.map(row => ({ id: row.id, name: row.name, employeeNo: row.employee_no, organizationId: row.dept_id, position: row.position })),
  };
}

/**
 * 按所选维度汇总某一审批类型的单据数量和数字字段合计。
 * 只查 approvals、employees 等单表并显式列出字段，不使用 SELECT * 或 JOIN；组织/职务/员工在内存中关联。
 */
export async function getApprovalSummary(input: {
  type: string;
  from?: string;
  to?: string;
  organization?: string;
  position?: string;
  employee?: string;
  groups?: string;
  fields?: string;
}): Promise<ApprovalSummary> {
  const type = parseApproverType(input.type.trim());
  const defaults = defaultRange();
  const from = input.from ?? defaults.from;
  const to = input.to ?? defaults.to;
  if (!validDate(from) || !validDate(to)) throw badRequest('请选择有效的日期范围');
  if (from > to) throw badRequest('开始日期不能晚于结束日期');
  const typeRow = await queryOne<SummaryTypeRow>('SELECT `name`, `fields_json` FROM approval_types WHERE `key` = ? LIMIT 1', [type]);
  if (!typeRow) throw badRequest('审批类型不存在');

  const groups = parseGroups(input.groups);
  const numericFields = await readNumericFields(type, typeRow.fields_json);
  const fieldMap = new Map(numericFields.map(field => [field.key, field]));
  const fieldKeys = (input.fields || '').split(',').map(value => value.trim()).filter(value => fieldMap.has(value));
  const selectedFields = numericFields.filter(field => fieldKeys.includes(field.key));

  const organizations = await queryRows<{ id: string; name: string }>('SELECT `id`, `name` FROM departments');
  const orgNames = new Map(organizations.map(row => [row.id, row.name]));
  const employeeRows = await queryRows<SummaryEmployeeRow>('SELECT `id`, `name`, `dept_id`, `position` FROM employees');
  const employees = new Map(employeeRows.map(row => [row.id, row]));
  const organization = (input.organization || '').trim();
  const position = (input.position || '').trim();
  const employeeId = (input.employee || '').trim();
  const hasEmployeeFilter = !!(organization || position || employeeId);
  const allowedIds = hasEmployeeFilter
    ? new Set(employeeRows.filter(row =>
        (!organization || row.dept_id === organization)
        && (!position || row.position === position)
        && (!employeeId || row.id === employeeId)
      ).map(row => row.id))
    : null;

  const rows: ApprovalSummaryRow[] = [];
  const totals = { ...emptyCounts(), sums: Object.fromEntries(selectedFields.map(field => [field.key, 0])) as Record<string, number> };
  if (!allowedIds || allowedIds.size) {
    const conditions = ['type = ?', 'created_at >= ?', 'created_at < DATE_ADD(?, INTERVAL 1 DAY)'];
    const params: Array<string | number> = [type, from, to];
    if (allowedIds) {
      conditions.push(`applicant_id IN (${Array.from(allowedIds).map(() => '?').join(',')})`);
      params.push(...allowedIds);
    }
    const formColumn = selectedFields.length ? ', form_json' : '';
    const raw = await queryRows<ApprovalRow>(
      `SELECT status, applicant_id, applicant_name, applicant_position, created_at${formColumn}
         FROM approvals
        WHERE ${conditions.join(' AND ')}
        ORDER BY created_at`,
      params
    );
    const grouped = new Map<string, ApprovalSummaryRow>();
    for (const row of raw) {
      const employee = employees.get(row.applicant_id);
      const values: Partial<Record<ApprovalSummaryGroup, string>> = {
        month: formatTime(row.created_at, 'YYYY-MM'),
        organization: orgNames.get(employee?.dept_id ?? '') ?? '未分配',
        position: employee?.position || row.applicant_position || '未填写',
        employee: employee?.name || row.applicant_name,
      };
      const groupKey = groups.map(group => values[group] ?? '').join('\u0001');
      let target = grouped.get(groupKey);
      if (!target) {
        target = { ...emptyCounts(), sums: Object.fromEntries(selectedFields.map(field => [field.key, 0])) };
        groups.forEach(group => { target![group] = values[group]; });
        grouped.set(groupKey, target);
      }
      target.total += 1;
      if (row.status === 'pending') target.pending += 1;
      else if (row.status === 'approved') target.approved += 1;
      else if (row.status === 'rejected') target.rejected += 1;
      else if (row.status === 'cancelled') target.cancelled += 1;
      totals.total += 1;
      if (row.status === 'pending') totals.pending += 1;
      else if (row.status === 'approved') totals.approved += 1;
      else if (row.status === 'rejected') totals.rejected += 1;
      else if (row.status === 'cancelled') totals.cancelled += 1;
      if (!selectedFields.length) continue;
      const form = row.form_json ? parseJson<Array<{ label: string; value: string }>>(row.form_json, []) : [];
      for (const field of selectedFields) {
        const item = form.find(entry => entry.label === field.label);
        const value = item ? numericValue(item.value) : null;
        if (value === null) continue;
        target.sums[field.key] += value;
        totals.sums[field.key] += value;
      }
    }
    rows.push(...grouped.values());
  }

  rows.sort((left, right) => {
    for (const group of groups) {
      const a = left[group] ?? '';
      const b = right[group] ?? '';
      if (a === b) continue;
      if (group === 'month') return b.localeCompare(a);
      return a.localeCompare(b, 'zh-Hans-CN');
    }
    return 0;
  });

  return {
    type,
    typeName: typeRow.name,
    from,
    to,
    groups,
    selectedFields,
    availableFields: numericFields,
    filters: { organization, position, employee: employeeId },
    rows,
    totals,
  };
}
