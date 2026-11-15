import { config } from '../../config';
import { execute, queryOne } from '../../shared/db/pool';
import type { LoginResponse } from '../../shared/types/models';
import { badRequest, forbidden, unauthorized } from '../../shared/utils/errors';
import { getCurrentUserById } from '../../domains/employees/userService';
import { issueTokens } from './authService';

interface Code2SessionResult {
  openid?: string;
  unionid?: string;
  session_key?: string;
  errcode?: number;
  errmsg?: string;
}

/** 微信一键登录是否已配置（未配置时前端隐藏入口、接口直接拒绝）。 */
export function isWechatConfigured(): boolean {
  return Boolean(config.wechat.appid && config.wechat.appSecret);
}

/**
 * code 换 openid：始终经由微信 code2Session 校验。
 * openid 只作为绑定查找键，绝不接受客户端直接传入 openid。
 */
async function codeToOpenid(code: string): Promise<string> {
  if (!isWechatConfigured()) throw badRequest('微信一键登录未配置，请联系管理员');
  const url = new URL('https://api.weixin.qq.com/sns/jscode2session');
  url.searchParams.set('appid', config.wechat.appid);
  url.searchParams.set('secret', config.wechat.appSecret);
  url.searchParams.set('js_code', code);
  url.searchParams.set('grant_type', 'authorization_code');
  let data: Code2SessionResult;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    data = (await res.json()) as Code2SessionResult;
  } catch {
    throw badRequest('微信服务连接失败，请稍后重试');
  }
  if (!data.openid) {
    if (data.errcode === 40013 || data.errcode === 40125 || data.errcode === 41004) {
      throw badRequest('微信登录配置有误，请联系管理员');
    }
    if (data.errcode === 45011 || data.errcode === -1) {
      throw badRequest('微信服务繁忙，请稍后重试');
    }
    // 40029 code 无效 / 40163 code 已使用 / 其他：统一按凭证失效处理，不回传内部细节。
    throw badRequest('微信登录凭证无效或已过期，请重试');
  }
  return data.openid;
}

/** 微信一键登录：openid 反查绑定账号，校验链路与 passwordLogin 完全一致。 */
export async function wechatLogin(code: string): Promise<LoginResponse> {
  const openid = await codeToOpenid(code);
  const preview = await queryOne<{ employee_id: string }>('SELECT employee_id FROM employee_accounts WHERE wx_openid = ?', [openid]);
  if (preview) {
    const { activateDueDepartures } = await import('../../admin/hr/hrDepartureService');
    await activateDueDepartures(preview.employee_id);
  }
  const row = await queryOne<{
    employee_id: string;
    status: 'active' | 'disabled';
    session_version: number | null;
    departed: number;
  }>("SELECT a.employee_id, a.status, v.version AS session_version, EXISTS(SELECT 1 FROM hr_employee_departures d WHERE d.employee_id = a.employee_id AND d.status = 'departed') AS departed FROM employee_accounts a LEFT JOIN employee_session_versions v ON v.employee_id = a.employee_id WHERE a.wx_openid = ?", [openid]);

  if (!row) throw unauthorized('该微信尚未绑定员工账号，请先用账号密码登录');
  if (row.status !== 'active' || row.departed) throw forbidden('该账号已被停用');

  const user = await getCurrentUserById(row.employee_id);
  if (!user) throw unauthorized('员工不存在');

  await execute('UPDATE employee_accounts SET last_login_at = NOW() WHERE employee_id = ?', [row.employee_id]);
  return { ...issueTokens(user.id, Number(row.session_version || 0)), user };
}

/** 绑定当前登录账号到当前微信号；一个微信号只能绑定一个员工账号，换绑须先解绑。 */
export async function wechatBind(employeeId: string, code: string): Promise<{ ok: true; bound: true }> {
  const openid = await codeToOpenid(code);
  const existing = await queryOne<{ employee_id: string }>('SELECT employee_id FROM employee_accounts WHERE wx_openid = ?', [openid]);
  if (existing && existing.employee_id !== employeeId) {
    throw forbidden('该微信号已绑定其他员工账号，请先在原账号解绑后再绑定');
  }
  await execute('UPDATE employee_accounts SET wx_openid = ? WHERE employee_id = ?', [openid, employeeId]);
  return { ok: true, bound: true };
}

/** 解除当前账号的微信绑定（与微信登录是否配置无关）。 */
export async function wechatUnbind(employeeId: string): Promise<{ ok: true; bound: false }> {
  await execute('UPDATE employee_accounts SET wx_openid = NULL WHERE employee_id = ?', [employeeId]);
  return { ok: true, bound: false };
}

/** 当前账号的微信绑定状态（登录态下查询，供“我的”页展示）。 */
export async function wechatBindingOf(employeeId: string): Promise<{ configured: boolean; bound: boolean }> {
  const row = await queryOne<{ wx_openid: string | null }>('SELECT wx_openid FROM employee_accounts WHERE employee_id = ?', [employeeId]);
  return { configured: isWechatConfigured(), bound: Boolean(row?.wx_openid) };
}
