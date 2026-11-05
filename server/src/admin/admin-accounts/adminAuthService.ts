import jwt from 'jsonwebtoken';

import { config } from '../../config';
import { execute, queryOne, queryRows } from '../../shared/db/pool';
import type { AdminAccountItem, AdminRole, AdminUser } from '../../shared/types/admin';
import { toMinuteText } from '../../shared/utils/datetime';
import { badRequest, forbidden, notFound, unauthorized } from '../../shared/utils/errors';
import { hashPassword, verifyPassword } from '../../shared/utils/password';
import { recordAdminLog } from '../../domains/audit/adminLogService';

interface AdminRow {
  id: number;
  username: string;
  password_hash: string;
  name: string;
  role: AdminRole;
  status: number;
  last_login_at: string | null;
  created_at: string;
}

function mapAdmin(row: AdminRow): AdminUser {
  return {
    id: row.id,
    username: row.username,
    name: row.name,
    role: row.role,
    status: !!row.status,
    lastLoginAt: row.last_login_at ? toMinuteText(row.last_login_at) : null,
    createdAt: toMinuteText(row.created_at),
  };
}

function issueAdminToken(admin: AdminUser): string {
  return jwt.sign({ typ: 'admin', role: admin.role }, config.jwt.secret, {
    subject: String(admin.id),
    expiresIn: '12h' as jwt.SignOptions['expiresIn'],
  });
}

export function verifyAdminToken(token: string): number {
  let payload: string | jwt.JwtPayload;
  try {
    payload = jwt.verify(token, config.jwt.secret);
  } catch {
    throw unauthorized('管理后台登录已过期，请重新登录');
  }
  if (typeof payload === 'string' || payload.typ !== 'admin' || !payload.sub) {
    throw unauthorized('管理后台登录已过期，请重新登录');
  }
  const id = Number(payload.sub);
  if (!Number.isInteger(id) || id <= 0) throw unauthorized();
  return id;
}

export async function getAdminById(id: number): Promise<AdminUser | null> {
  const row = await queryOne<AdminRow>('SELECT * FROM admins WHERE id = ?', [id]);
  return row ? mapAdmin(row) : null;
}

/** 首次启动且 admins 表为空时创建默认管理员 */
export async function ensureDefaultAdmin(): Promise<boolean> {
  const row = await queryOne<{ total: number }>('SELECT COUNT(*) AS total FROM admins');
  if (row && Number(row.total) > 0) return false;
  await execute(
    `INSERT INTO admins (username, password_hash, name, role, status, created_at)
     VALUES (?, ?, ?, 'super_admin', 1, NOW())`,
    [config.admin.username, hashPassword(config.admin.password), config.admin.name]
  );
  return true;
}

export async function loginAdmin(username: string, password: string): Promise<{ token: string; admin: AdminUser }> {
  const row = await queryOne<AdminRow>('SELECT * FROM admins WHERE username = ?', [username.trim()]);
  if (!row || !verifyPassword(password, row.password_hash)) {
    throw unauthorized('用户名或密码错误');
  }
  if (!row.status) throw forbidden('该管理员账号已被禁用');
  await execute('UPDATE admins SET last_login_at = NOW() WHERE id = ?', [row.id]);
  const admin = mapAdmin({ ...row, last_login_at: row.last_login_at });
  await recordAdminLog(admin, '登录', 'admin', String(admin.id), { username: admin.username });
  return { token: issueAdminToken(admin), admin };
}

export async function changeAdminPassword(adminId: number, oldPassword: string, newPassword: string): Promise<void> {
  const row = await queryOne<AdminRow>('SELECT * FROM admins WHERE id = ?', [adminId]);
  if (!row) throw notFound('管理员不存在');
  if (!verifyPassword(oldPassword, row.password_hash)) throw badRequest('原密码不正确');
  await execute('UPDATE admins SET password_hash = ? WHERE id = ?', [hashPassword(newPassword), adminId]);
  await recordAdminLog(mapAdmin(row), '修改密码', 'admin', String(adminId), {});
}

export async function listAdmins(): Promise<AdminAccountItem[]> {
  const rows = await queryRows<AdminRow>('SELECT * FROM admins ORDER BY id');
  const activeSuperAdmins = rows.filter((r) => r.role === 'super_admin' && r.status).length;
  return rows.map((row) => ({
    ...mapAdmin(row),
    canDisable: !(row.role === 'super_admin' && row.status && activeSuperAdmins <= 1),
  }));
}

export async function createAdmin(
  input: { username: string; password: string; name: string; role: AdminRole },
  operator: AdminUser
): Promise<AdminUser> {
  const exists = await queryOne<{ id: number }>('SELECT id FROM admins WHERE username = ?', [input.username]);
  if (exists) throw badRequest('该登录名已存在');
  const result = await execute(
    `INSERT INTO admins (username, password_hash, name, role, status, created_at)
     VALUES (?, ?, ?, ?, 1, NOW())`,
    [input.username, hashPassword(input.password), input.name, input.role]
  );
  const admin = await getAdminById(result.insertId);
  if (!admin) throw new Error('管理员创建失败');
  await recordAdminLog(operator, '创建管理员', 'admin', String(admin.id), { username: admin.username, role: admin.role });
  return admin;
}

export async function setAdminStatus(
  id: number,
  status: boolean,
  operator: AdminUser
): Promise<AdminUser> {
  if (id === operator.id && !status) throw badRequest('不能禁用当前登录账号');
  const row = await queryOne<AdminRow>('SELECT * FROM admins WHERE id = ?', [id]);
  if (!row) throw notFound('管理员不存在');
  if (row.role === 'super_admin' && !status) {
    const active = await queryOne<{ total: number }>(
      "SELECT COUNT(*) AS total FROM admins WHERE role = 'super_admin' AND status = 1"
    );
    if (Number(active?.total || 0) <= 1) throw badRequest('至少保留一个启用的超级管理员');
  }
  await execute('UPDATE admins SET status = ? WHERE id = ?', [status ? 1 : 0, id]);
  await recordAdminLog(operator, status ? '启用管理员' : '禁用管理员', 'admin', String(id), { username: row.username });
  const updated = await getAdminById(id);
  if (!updated) throw notFound('管理员不存在');
  return updated;
}

export async function resetAdminPassword(
  id: number,
  password: string,
  operator: AdminUser
): Promise<void> {
  const row = await queryOne<AdminRow>('SELECT * FROM admins WHERE id = ?', [id]);
  if (!row) throw notFound('管理员不存在');
  await execute('UPDATE admins SET password_hash = ? WHERE id = ?', [hashPassword(password), id]);
  await recordAdminLog(operator, '重置管理员密码', 'admin', String(id), { username: row.username });
}
