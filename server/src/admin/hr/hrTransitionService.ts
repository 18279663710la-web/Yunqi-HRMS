// 业务对照：Frappe HR v16.52.0 Employee Promotion / Employee Transfer（GPL-3.0）。
// 本实现使用本项目的数据模型；来源及差异记录在代码备份中的溯源说明。
import { z } from 'zod';
import type { ResultSetHeader, RowDataPacket } from 'mysql2';
import { queryRows, transaction } from '../../shared/db/pool';
import { dateKey } from '../../shared/utils/datetime';
import { badRequest, notFound } from '../../shared/utils/errors';

const fields = { position: 'position', level: 'level', jobCategory: 'job_category', deptId: 'dept_id' } as const;
type Field = keyof typeof fields;
type Snapshot = Partial<Record<Field, string | null>>;
const changesSchema = z.object({
  position: z.string().trim().min(1).max(100).optional(),
  level: z.string().trim().min(1).max(20).optional(),
  jobCategory: z.enum(['研发员', '业务员', '员工']).optional(),
  deptId: z.string().trim().min(1).max(10).optional(),
}).strict().refine((value) => Object.keys(value).length > 0, '请选择至少一个变更字段');
export const transitionSchema = z.object({
  employeeId: z.string().trim().min(1).max(10),
  type: z.enum(['promotion', 'transfer']),
  effectiveDate: z.string().date(),
  changes: changesSchema,
  note: z.string().trim().max(500).default(''),
});
type Input = z.infer<typeof transitionSchema>;
function parseJson(value: unknown): Snapshot { return (typeof value === 'string' ? JSON.parse(value) : value) as Snapshot; }

export async function listTransitions(employeeId: string) {
  const employees = await queryRows('SELECT id FROM employees WHERE id = ?', [employeeId]);
  if (!employees.length) throw notFound('员工不存在');
  const rows = await queryRows<{ id: number; change_type: string; effective_date: string; before_json: unknown; after_json: unknown; note: string; status: string; created_at: string }>('SELECT id, change_type, effective_date, before_json, after_json, note, status, created_at FROM hr_employee_transitions WHERE employee_id = ? ORDER BY id DESC LIMIT 200', [employeeId]);
  return rows.map((row) => ({ id: row.id, type: row.change_type, effectiveDate: row.effective_date, before: parseJson(row.before_json), after: parseJson(row.after_json), note: row.note, status: row.status, createdAt: row.created_at }));
}

export async function submitTransition(input: Input, adminId: number) {
  if (input.effectiveDate > dateKey()) throw badRequest('异动生效日期未到，不能提交');
  return transaction(async (conn) => {
    const [employees] = await conn.query<RowDataPacket[]>('SELECT position, level, job_category, dept_id FROM employees WHERE id = ? FOR UPDATE', [input.employeeId]);
    if (!employees.length) throw notFound('员工不存在');
    const [departures] = await conn.query<RowDataPacket[]>("SELECT id FROM hr_employee_departures WHERE employee_id = ? AND status = 'departed' LIMIT 1", [input.employeeId]);
    if (departures.length) throw badRequest('已离职员工不能提交人事异动');
    if (input.changes.deptId) {
      const [departments] = await conn.query<RowDataPacket[]>('SELECT id FROM departments WHERE id = ?', [input.changes.deptId]);
      if (!departments.length) throw badRequest('部门不存在');
    }
    const before: Snapshot = {}; const after: Snapshot = {};
    for (const key of Object.keys(input.changes) as Field[]) {
      const next = input.changes[key]; const current = employees[0][fields[key]] as string | null;
      if (next !== undefined && next !== current) { before[key] = current; after[key] = next; }
    }
    const keys = Object.keys(after) as Field[];
    if (!keys.length) throw badRequest('填写的值与当前员工资料相同');
    await conn.execute(`UPDATE employees SET ${keys.map((key) => `\`${fields[key]}\` = ?`).join(', ')} WHERE id = ?`, [...keys.map((key) => after[key] ?? null), input.employeeId]);
    const [result] = await conn.execute<ResultSetHeader>('INSERT INTO hr_employee_transitions (employee_id, change_type, effective_date, before_json, after_json, note, status, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())', [input.employeeId, input.type, input.effectiveDate, JSON.stringify(before), JSON.stringify(after), input.note, 'submitted', adminId]);
    return { id: result.insertId };
  });
}

export async function cancelTransition(id: string, adminId: number) {
  await transaction(async (conn) => {
    const [identities] = await conn.query<RowDataPacket[]>('SELECT employee_id FROM hr_employee_transitions WHERE id = ?', [id]);
    if (!identities.length) throw notFound('人事异动不存在');
    const employeeId = String(identities[0].employee_id);
    const [employees] = await conn.query<RowDataPacket[]>('SELECT position, level, job_category, dept_id FROM employees WHERE id = ? FOR UPDATE', [employeeId]);
    if (!employees.length) throw notFound('员工不存在');
    const [records] = await conn.query<RowDataPacket[]>('SELECT id, status, before_json, after_json FROM hr_employee_transitions WHERE id = ? FOR UPDATE', [id]);
    if (!records.length || records[0].status !== 'submitted') throw badRequest('异动已撤销');
    const [latest] = await conn.query<RowDataPacket[]>("SELECT id FROM hr_employee_transitions WHERE employee_id = ? AND status = 'submitted' ORDER BY id DESC LIMIT 1", [employeeId]);
    if (String(latest[0]?.id) !== String(id)) throw badRequest('请先撤销较晚的人事异动');
    const before = parseJson(records[0].before_json); const after = parseJson(records[0].after_json);
    const keys = Object.keys(after) as Field[];
    if (!keys.length || keys.some((key) => !Object.hasOwn(fields, key) || !Object.hasOwn(before, key))) throw badRequest('异动记录无效，无法撤销');
    if (keys.some((key) => employees[0][fields[key]] !== after[key])) throw badRequest('员工资料已被修改，不能直接撤销');
    await conn.execute(`UPDATE employees SET ${keys.map((key) => `\`${fields[key]}\` = ?`).join(', ')} WHERE id = ?`, [...keys.map((key) => before[key] ?? null), employeeId]);
    await conn.execute("UPDATE hr_employee_transitions SET status = 'cancelled', cancelled_by = ?, cancelled_at = NOW() WHERE id = ?", [adminId, id]);
  });
}
