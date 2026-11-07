import type { RowDataPacket } from 'mysql2';
import { z } from 'zod';
import { transaction } from '../../shared/db/pool';
import { badRequest, notFound } from '../../shared/utils/errors';
import { assertJobTitle } from '../../domains/employees/jobTitleService';

export const taskSchema = z.object({ title: z.string().trim().min(1).max(100), required: z.boolean() });
export const completionSchema = z.object({ completed: z.boolean() });
export const onboardingEmployeeSchema = z.object({
  name: z.string().trim().min(1).max(50),
  pinyin: z.string().trim().regex(/^[a-zA-Z]+$/).max(100),
  employeeNo: z.string().trim().min(1).max(30),
  phone: z.string().trim().min(5).max(20),
  joinDate: z.string().date(),
  jobCategory: z.string().trim().min(1).max(100),
});
type EmployeeInput = z.infer<typeof onboardingEmployeeSchema>;

export async function addOnboardingTask(id: string, input: z.infer<typeof taskSchema>) {
  return transaction(async (conn) => {
    const [rows] = await conn.query<RowDataPacket[]>('SELECT id FROM hr_onboarding WHERE id = ? FOR UPDATE', [id]);
    if (!rows.length) throw notFound('入职申请不存在');
    const [result] = await conn.execute<import('mysql2').ResultSetHeader>('INSERT INTO hr_onboarding_tasks (onboarding_id, title, required, completed) VALUES (?, ?, ?, 0)', [id, input.title, input.required]);
    return { id: result.insertId };
  });
}

export async function setOnboardingTask(id: string, taskId: string, completed: boolean) {
  await transaction(async (conn) => {
    const [rows] = await conn.query<RowDataPacket[]>('SELECT id FROM hr_onboarding WHERE id = ? FOR UPDATE', [id]);
    if (!rows.length) throw notFound('入职申请不存在');
    const [tasks] = await conn.query<RowDataPacket[]>('SELECT id FROM hr_onboarding_tasks WHERE onboarding_id = ? AND id = ?', [id, taskId]);
    if (!tasks.length) throw notFound('入职任务不存在');
    await conn.execute('UPDATE hr_onboarding_tasks SET completed = ? WHERE onboarding_id = ? AND id = ?', [completed, id, taskId]);
  });
}

export async function confirmOnboarding(id: string, input: EmployeeInput) {
  return transaction(async (conn) => {
    const [rows] = await conn.query<RowDataPacket[]>('SELECT id FROM hr_onboarding WHERE id = ? FOR UPDATE', [id]);
    if (!rows.length) throw notFound('入职申请不存在');
    const [links] = await conn.query<RowDataPacket[]>('SELECT employee_id FROM hr_onboarding_links WHERE onboarding_id = ?', [id]);
    if (links.length) throw badRequest('该申请已完成建档');
    const [pending] = await conn.query<RowDataPacket[]>('SELECT id FROM hr_onboarding_tasks WHERE onboarding_id = ? AND required = 1 AND completed = 0 LIMIT 1', [id]);
    if (pending.length) throw badRequest('请先完成必需的入职任务');
    const [departments] = await conn.query<RowDataPacket[]>("SELECT id FROM departments WHERE id = 'D00'");
    if (!departments.length) throw badRequest('公司根部门不存在');
    const [employees] = await conn.query<RowDataPacket[]>("SELECT id FROM employees WHERE id REGEXP '^U[0-9]+$' FOR UPDATE");
    const [existing] = await conn.query<RowDataPacket[]>('SELECT id FROM employees WHERE employee_no = ? LIMIT 1 FOR UPDATE', [input.employeeNo]);
    if (existing.length) throw badRequest('工号已存在');
    const max = employees.reduce((n, row) => Math.max(n, Number(String(row.id).slice(1)) || 0), 0);
    const employeeId = `U${String(max + 1).padStart(3, '0')}`;
    if (employeeId.length > 10) throw badRequest('员工编号已用完');
    await assertJobTitle(conn, input.jobCategory);
    await conn.execute(`INSERT INTO employees (id, name, pinyin, gender, dept_id, position, job_category, level, employee_no, phone, email, join_date, is_leader, seat, leader_id)
      VALUES (?, ?, ?, NULL, 'D00', ?, NULL, '—', ?, ?, '', ?, 0, '', NULL)`,
    [employeeId, input.name, input.pinyin, input.jobCategory, input.employeeNo, input.phone, input.joinDate]);
    await conn.execute('INSERT INTO hr_onboarding_links (onboarding_id, employee_id, created_at) VALUES (?, ?, NOW())', [id, employeeId]);
    return { employeeId };
  });
}
