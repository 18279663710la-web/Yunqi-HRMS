import jwt, { type SignOptions } from 'jsonwebtoken';

import { config } from '../../config';
import { execute, queryOne } from '../../shared/db/pool';
import type { LoginResponse } from '../../shared/types/models';
import { forbidden, unauthorized } from '../../shared/utils/errors';
import { verifyPassword } from '../../shared/utils/password';
import { getCurrentUserById } from '../../domains/employees/userService';
import { requireActiveEmployeeSession } from '../../domains/accounts/employeeSessionService';

export type TokenType = 'access' | 'refresh';

interface TokenPayload extends jwt.JwtPayload {
  sub: string;
  typ: TokenType;
  /** 未勾选「7天免登录」时为 0：本次会话有效期 1 天，refresh 续期不升格 */
  rm?: number;
}

/** 未勾选「7天免登录」时的会话有效期 */
const SHORT_SESSION_TTL = '1d';

function sign(employeeId: string, typ: TokenType, ttl: string, sessionVersion: number, remember = true): string {
  const options: SignOptions = {
    subject: employeeId,
    expiresIn: ttl as SignOptions['expiresIn'],
  };
  return jwt.sign({ typ, sv: sessionVersion, rm: remember ? 1 : 0 }, config.jwt.secret, options);
}

export function issueTokens(employeeId: string, sessionVersion = 0, remember = true): { accessToken: string; refreshToken: string } {
  const accessTtl = remember ? config.jwt.accessTtl : SHORT_SESSION_TTL;
  const refreshTtl = remember ? config.jwt.refreshTtl : SHORT_SESSION_TTL;
  return {
    accessToken: sign(employeeId, 'access', accessTtl, sessionVersion, remember),
    refreshToken: sign(employeeId, 'refresh', refreshTtl, sessionVersion, remember),
  };
}

export function verifyTokenPayload(token: string, expected: TokenType): TokenPayload {
  let payload: string | jwt.JwtPayload;
  try {
    payload = jwt.verify(token, config.jwt.secret);
  } catch {
    throw unauthorized();
  }
  if (typeof payload === 'string' || !payload.sub || payload.typ !== expected) {
    throw unauthorized();
  }
  return payload as TokenPayload;
}

export function verifyToken(token: string, expected: TokenType): string {
  return String(verifyTokenPayload(token, expected).sub);
}

/** 员工账号密码登录（账号由 Web 管理后台创建）；remember=false 时会话有效期 1 天 */
export async function passwordLogin(loginName: string, password: string, remember = true): Promise<LoginResponse> {
  const preview = await queryOne<{ employee_id: string }>('SELECT employee_id FROM employee_accounts WHERE login_name = ?', [loginName.trim()]);
  if (preview) {
    const { activateDueDepartures } = await import('../../admin/hr/hrDepartureService');
    await activateDueDepartures(preview.employee_id);
  }
  const row = await queryOne<{
    employee_id: string;
    password_hash: string;
    status: 'active' | 'disabled';
    session_version: number | null;
    departed: number;
  }>("SELECT a.employee_id, a.password_hash, a.status, v.version AS session_version, EXISTS(SELECT 1 FROM hr_employee_departures d WHERE d.employee_id = a.employee_id AND d.status = 'departed') AS departed FROM employee_accounts a LEFT JOIN employee_session_versions v ON v.employee_id = a.employee_id WHERE a.login_name = ?", [loginName.trim()]);

  const storedHash = row && row.password_hash.startsWith('locked$') ? row.password_hash.slice('locked$'.length) : row?.password_hash;
  if (!row || !storedHash || !verifyPassword(password, storedHash)) {
    throw unauthorized('登录名或密码错误');
  }
  if (row.status !== 'active' || row.departed) throw forbidden('该账号已被停用');

  const user = await getCurrentUserById(row.employee_id);
  if (!user) throw unauthorized('员工不存在');

  await execute('UPDATE employee_accounts SET last_login_at = NOW() WHERE employee_id = ?', [row.employee_id]);
  return { ...issueTokens(user.id, Number(row.session_version || 0), remember), user };
}

export async function refreshSession(refreshToken: string): Promise<LoginResponse> {
  const payload = verifyTokenPayload(refreshToken, 'refresh');
  const employeeId = String(payload.sub);
  const sessionVersion = await requireActiveEmployeeSession(employeeId, refreshToken);
  const user = await getCurrentUserById(employeeId);
  if (!user) throw unauthorized();
  return { ...issueTokens(user.id, sessionVersion, payload.rm !== 0), user };
}

export type { TokenPayload };
