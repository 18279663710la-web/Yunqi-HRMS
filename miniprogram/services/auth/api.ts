import type {
CurrentUser
} from '../../types/models';
import {
logout as clearLoginSession,
get,
getCachedUser,
login as loginRequest,
wechatBind as bindWechat,
wechatLogin as loginWechat,
wechatUnbind as unbindWechat
} from '../../utils/request';

export function getCachedCurrentUser(): CurrentUser | null {
  return getCachedUser();
}

export function getCurrentUser(): Promise<CurrentUser> {
  return get<CurrentUser>('/me');
}

export function login(loginName: string, password: string): Promise<CurrentUser> {
  return loginRequest(loginName, password);
}

/** 微信一键登录：仅当后端已配置且当前微信号已绑定时成功 */
export function wechatLogin(): Promise<CurrentUser> {
  return loginWechat();
}

export function wechatStatus(): Promise<{ configured: boolean }> {
  return get<{ configured: boolean }>('/auth/wechat-status');
}

export function wechatBinding(): Promise<{ configured: boolean; bound: boolean }> {
  return get<{ configured: boolean; bound: boolean }>('/auth/wechat-binding');
}

export function wechatBind(): Promise<void> {
  return bindWechat();
}

export function wechatUnbind(): Promise<void> {
  return unbindWechat();
}

export function logout(): void {
  clearLoginSession();
}
