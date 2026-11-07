import { execute, queryOne } from '../../shared/db/pool';
import type { AdminUser } from '../../shared/types/admin';
import type { CurrentUser } from '../../shared/types/models';
import { badRequest } from '../../shared/utils/errors';
import { hashPassword } from '../../shared/utils/password';
import { recordAdminLog } from '../audit/adminLogService';

export const CHAIRPERSON_ID = 'CHAIR001';

export interface ChairpersonAccountRow {
  login_name: string;
  password_hash: string;
  status: 'active' | 'disabled';
}

export async function getChairpersonAccount(): Promise<ChairpersonAccountRow | null> {
  return queryOne<ChairpersonAccountRow>('SELECT login_name, password_hash, status FROM chairperson_account WHERE id = 1');
}

export async function createChairpersonAccount(input: { loginName: string; password: string }, operator: AdminUser): Promise<{ loginName: string }> {
  if (await getChairpersonAccount()) throw badRequest('董事长小程序账号已存在');
  if (await queryOne('SELECT employee_id FROM employee_accounts WHERE login_name = ?', [input.loginName])) {
    throw badRequest('该登录名已被使用');
  }
  await execute(
    "INSERT INTO chairperson_account (id, login_name, password_hash, status, created_by, created_at, updated_at) VALUES (1, ?, ?, 'active', ?, NOW(), NOW())",
    [input.loginName, hashPassword(input.password), operator.id]
  );
  await recordAdminLog(operator, '创建董事长小程序账号', 'chairperson', CHAIRPERSON_ID, { loginName: input.loginName });
  return { loginName: input.loginName };
}

export async function getChairpersonUser(): Promise<CurrentUser | null> {
  const account = await getChairpersonAccount();
  if (!account || account.status !== 'active') return null;
  return {
    id: CHAIRPERSON_ID, name: '董事长', pinyin: 'dongshizhang', deptId: '', deptName: '',
    position: '董事长', level: '', employeeNo: '', phone: '', email: '', joinDate: '',
    isLeader: false, jobCategory: '董事长', seat: '', leaderId: '', leaderName: '', isChairperson: true,
  };
}
