/**
 * utils/request.ts — 统一 HTTP 请求层（前后端分离）
 *
 * 登录体系：
 *   · 员工使用账号密码登录（POST /auth/password-login），并可在绑定微信号后
 *     使用微信一键登录（POST /auth/wechat-login，静默无弹窗）
 *   · 账号只能由 Web 管理后台创建，小程序端不提供注册
 *   · 管理员账号与员工账号完全隔离：employee token 只能访问员工接口
 *   · 无 token 时先静默尝试微信一键登录（仅冷启动，退出登录后本次抑制），
 *     仍无登录态则跳转登录页；401 先尝试 refresh，失败后清登录态并跳转登录
 *
 * 注意：真机调试时 127.0.0.1 指向手机自身，后端地址由 utils/apiOrigin.ts 自动探测，
 * 也可在登录页长按底部手动指定；并在微信开发者工具中保持「不校验合法域名」。
 */

import type { CurrentUser, LoginResponse } from '../types/models';
import { toast } from './util';
import { ensureApiOrigin, getApiOrigin, invalidateApiOrigin, isApiOriginReachable, noteRequestSuccess, noteRequestTimeout } from './apiOrigin';
import { isOnboardingRoute } from '../services/onboarding/onboardingRoutes';

const LOGIN_PAGE = '/pages/login/login';
const TIMEOUT = 15000;
const ACCESS_TOKEN_KEY = 'access_token';
const REFRESH_TOKEN_KEY = 'refresh_token';
const CURRENT_USER_KEY = 'current_user';

export interface ApiError {
  code: number;
  message: string;
  [key: string]: unknown;
}

interface ApiEnvelope {
  code: number;
  message?: string;
  data?: unknown;
}

type RequestMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

export interface RequestOptions {
  url: string;
  method?: RequestMethod;
  data?: unknown;
  header?: Record<string, string>;
  silent?: boolean;
  timeout?: number;
  /** false 表示不带 token（仅登录 / 刷新接口使用） */
  auth?: boolean;
}

let redirectingToLogin = false;
let redirectingToOnboarding = false;

function buildUrl(url: string): string {
  if (/^https?:\/\//.test(url)) return url;
  return `${getApiOrigin()}/api${url.startsWith('/') ? '' : '/'}${url}`;
}

/** 当前后端根地址；上传/下载等需要同步 URL 的场景使用。 */
export function getBaseUrl(): string {
  return `${getApiOrigin()}/api`;
}

/** 当前后端静态资源根地址。 */
export function getStaticBase(): string {
  return getApiOrigin();
}

function isNetworkError(error: unknown): boolean {
  return !!error && typeof error === 'object' && (error as ApiError).code === -1;
}

function unreachableError(silent = false): ApiError {
  const err: ApiError = { code: -1, message: '无法连接后端，请确认手机与电脑在同一网络且后端已启动' };
  if (!silent) toastError(err.message);
  return err;
}

/** 网络失败时重新探测后端地址；地址发生变化才自动重试一次。 */
async function withOriginRetry<T>(run: () => Promise<T>): Promise<T> {
  const previous = getApiOrigin();
  try {
    return await run();
  } catch (error) {
    if (!isNetworkError(error) || !isApiOriginReachable()) throw error;
    const next = await ensureApiOrigin(true);
    if (next === previous) throw error;
    return run();
  }
}

export function resolveFileUrl(path: string): string {
  if (!path) return '';
  if (/^https?:\/\//.test(path)) return path;
  if (path.startsWith('wxfile://') || path.startsWith('file://')) return path;
  return `${getApiOrigin()}${path.startsWith('/') ? '' : '/'}${path}`;
}

export function getToken(): string {
  return wx.getStorageSync(ACCESS_TOKEN_KEY) || '';
}

export function getCachedUser(): CurrentUser | null {
  const user = wx.getStorageSync(CURRENT_USER_KEY);
  return user || null;
}

export function clearSession(): void {
  wx.removeStorageSync(ACCESS_TOKEN_KEY);
  wx.removeStorageSync(REFRESH_TOKEN_KEY);
  wx.removeStorageSync(CURRENT_USER_KEY);
}

function storeSession(data: LoginResponse): void {
  wx.setStorageSync(ACCESS_TOKEN_KEY, data.accessToken);
  wx.setStorageSync(REFRESH_TOKEN_KEY, data.refreshToken);
  wx.setStorageSync(CURRENT_USER_KEY, data.user);
}

function toastError(message: string): void {
  wx.showToast({ title: message, icon: 'none', duration: 2000 });
}

function currentRoute(): string {
  const pages = getCurrentPages() as Array<{ route?: string }>;
  return pages.length ? pages[pages.length - 1].route || '' : '';
}

/** 清空登录态并跳转登录页（避免重复跳转） */
export function redirectToLogin(): void {
  if (redirectingToLogin) return;
  if (currentRoute() === 'pages/login/login') return;
  redirectingToLogin = true;
  wx.reLaunch({
    url: LOGIN_PAGE,
    complete: () => {
      setTimeout(() => {
        redirectingToLogin = false;
      }, 800);
    },
  });
}

function parseBody(raw: unknown): unknown {
  if (typeof raw !== 'string') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function unwrap<T>(statusCode: number, raw: unknown, silent = false): T {
  const body = parseBody(raw);

  if (statusCode >= 200 && statusCode < 300) {
    if (body && typeof body === 'object' && 'code' in body) {
      const envelope = body as ApiEnvelope;
      if (envelope.code === 0 || envelope.code === 200) {
        return (envelope.data !== undefined ? envelope.data : envelope) as T;
      }
      const err: ApiError = {
        code: envelope.code,
        message: envelope.message || '请求失败',
      };
      if (!silent) toastError(err.message);
      throw err;
    }
    return body as T;
  }

  const bodyMessage =
    body && typeof body === 'object' && 'message' in body ? String((body as ApiEnvelope).message || '') : '';
  const message = bodyMessage || `服务异常 (${statusCode})`;
  const err: ApiError = { code: statusCode, message };
  if (!silent) toastError(message);
  throw err;
}

/** 网络层失败：超时说明地址可达但服务端慢，不应清掉地址缓存重新探测。 */
function isTimeoutFailure(e: unknown): boolean {
  const message = String((e as { errMsg?: string } | undefined)?.errMsg || '');
  return message.includes('timeout');
}

async function wxRequest(options: RequestOptions): Promise<WechatMiniprogram.RequestSuccessCallbackResult> {
  await ensureApiOrigin();
  if (!isApiOriginReachable()) throw unreachableError(options.silent);
  const token = options.auth === false ? '' : getToken();
  return new Promise((resolve, reject) => {
    wx.request({
      url: buildUrl(options.url),
      method: options.method || 'GET',
      data: (options.data ?? {}) as Record<string, unknown>,
      timeout: options.timeout || TIMEOUT,
      header: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(options.header || {}),
      },
      success: (res) => {
        noteRequestSuccess();
        resolve(res);
      },
      fail: (e) => {
        const timeout = isTimeoutFailure(e);
        if (timeout) noteRequestTimeout(); else invalidateApiOrigin();
        console.warn('[api] 网络连接失败', buildUrl(options.url), e);
        const err: ApiError = {
          code: -1,
          message: timeout ? '请求超时，请稍后重试' : '网络连接失败，请确认手机与电脑在同一网络且后端已启动',
          detail: e,
        };
        if (!options.silent) toastError(err.message);
        reject(err);
      },
    });
  });
}

async function rawRequest<T>(options: RequestOptions): Promise<T> {
  const res = await withOriginRetry(() => wxRequest(options));
  return unwrap<T>(res.statusCode, res.data, options.silent);
}

/** 员工账号密码登录：账号由 Web 管理后台创建 */
export async function login(loginName: string, password: string): Promise<CurrentUser> {
  const data = await rawRequest<LoginResponse>({
    url: '/auth/password-login',
    method: 'POST',
    data: { loginName, password },
    auth: false,
    silent: true,
  });
  storeSession(data);
  return data.user;
}

/** wx.login 取临时凭证 code（5 分钟有效，单次使用） */
function wxLoginCode(): Promise<string> {
  return new Promise((resolve, reject) => {
    wx.login({
      success: (res) => {
        if (res.code) resolve(res.code);
        else reject({ code: -1, message: '微信登录失败，请重试' } as ApiError);
      },
      fail: () => reject({ code: -1, message: '微信登录失败，请重试' } as ApiError),
    });
  });
}

/**
 * 微信一键登录：仅当后端已配置密钥且当前微信号已绑定员工账号时成功；
 * 未绑定/未配置/停用等失败由服务端返回明确 message，由调用方决定是否提示。
 */
export async function wechatLogin(): Promise<CurrentUser> {
  const code = await wxLoginCode();
  const data = await rawRequest<LoginResponse>({
    url: '/auth/wechat-login',
    method: 'POST',
    data: { code },
    auth: false,
    silent: true,
  });
  storeSession(data);
  return data.user;
}

/** 将当前登录账号绑定到当前微信号（一个微信号只能绑定一个账号，换绑须先解绑） */
export async function wechatBind(): Promise<void> {
  const code = await wxLoginCode();
  await rawRequest({
    url: '/auth/wechat-bind',
    method: 'POST',
    data: { code },
    silent: true,
  });
}

/**
 * 查询服务端是否启用微信一键登录（公开接口）。
 * 必须走 rawRequest：登录页无登录态时 get() 会被本地守卫拦截，按钮将永远隐藏。
 */
export async function wechatStatus(): Promise<{ configured: boolean }> {
  return rawRequest<{ configured: boolean }>({
    url: '/auth/wechat-status',
    method: 'GET',
    auth: false,
    silent: true,
  });
}

/** 解除当前账号的微信绑定 */
export async function wechatUnbind(): Promise<void> {
  await rawRequest({
    url: '/auth/wechat-unbind',
    method: 'POST',
    silent: true,
  });
}

/**
 * 退出登录后抑制本次运行内的微信静默自动登录，
 * 避免“退出后立刻被自动登录回去”；冷启动（app onLaunch）自动复位。
 */
let wechatAutoLoginSuppressed = false;

export function isWechatAutoLoginSuppressed(): boolean {
  return wechatAutoLoginSuppressed;
}

export function resetWechatAutoLoginSuppression(): void {
  wechatAutoLoginSuppressed = false;
}

/** 退出登录：清空 token、用户缓存 */
export function logout(): void {
  clearSession();
  wechatAutoLoginSuppressed = true;
}

async function refreshTokens(): Promise<void> {
  const refreshToken = wx.getStorageSync(REFRESH_TOKEN_KEY);
  if (!refreshToken) throw { code: 401, message: '登录已过期' } as ApiError;
  const data = await rawRequest<LoginResponse>({
    url: '/auth/refresh',
    method: 'POST',
    data: { refreshToken },
    auth: false,
    silent: true,
  });
  storeSession(data);
}

function authExpired(options: RequestOptions, message = '登录已过期，请重新登录'): ApiError {
  clearSession();
  redirectToLogin();
  const err: ApiError = { code: 401, message };
  if (!options.silent) toastError(message);
  return err;
}

async function send<T>(options: RequestOptions, retried = false): Promise<T> {
  const res = await withOriginRetry(() => wxRequest({ ...options, auth: true }));

  const body = parseBody(res.data) as { code?: number } | null;
  const onboardingBlocked = res.statusCode === 403 && body?.code === 40301;
  if (onboardingBlocked) {
    const route = currentRoute();
    if (!redirectingToOnboarding && !isOnboardingRoute(route)) {
      redirectingToOnboarding = true;
      wx.reLaunch({ url: '/pages/onboarding-required/onboarding-required', complete: () => { setTimeout(() => { redirectingToOnboarding = false; }, 800); } });
    }
  }

  if (res.statusCode === 401) {
    if (retried) throw authExpired(options);
    try {
      await refreshTokens();
    } catch {
      throw authExpired(options);
    }
    return send<T>(options, true);
  }

  return unwrap<T>(res.statusCode, res.data, options.silent || onboardingBlocked);
}

/** 业务请求（必须已登录；401 自动刷新 token 并重放） */
export async function request<T>(options: RequestOptions): Promise<T> {
  if (!getToken()) {
    if (!options.silent) toastError('请先登录');
    redirectToLogin();
    throw { code: 401, message: '请先登录' } as ApiError;
  }
  return send<T>(options);
}

export function get<T>(url: string, data?: unknown, options: Partial<RequestOptions> = {}): Promise<T> {
  return request<T>({ url, method: 'GET', data, ...options });
}

export function post<T>(url: string, data?: unknown, options: Partial<RequestOptions> = {}): Promise<T> {
  return request<T>({ url, method: 'POST', data, ...options });
}

/** 下载受员工鉴权保护的文件，不将令牌写入地址。 */
export async function downloadAuthenticatedFile(url: string): Promise<string> {
  if (!url.startsWith('/payslips/') || !/^\/payslips\/\d+\/pdf$/.test(url)) throw { code: 400, message: '下载地址无效' } as ApiError;
  await ensureApiOrigin();
  if (!isApiOriginReachable()) throw unreachableError();
  const downloadOnce = () => new Promise<WechatMiniprogram.DownloadFileSuccessCallbackResult>((resolve, reject) => {
    wx.downloadFile({ url: buildUrl(url), header: { Authorization: `Bearer ${getToken()}` }, timeout: TIMEOUT, success: resolve,
      fail: (e) => {
        if (!isTimeoutFailure(e)) invalidateApiOrigin();
        reject({ code: -1, message: isTimeoutFailure(e) ? '下载超时，请稍后重试' : '下载失败，请检查网络后重试' } as ApiError);
      } });
  });
  if (!getToken()) { redirectToLogin(); throw { code: 401, message: '请先登录' } as ApiError; }
  let result = await withOriginRetry(downloadOnce);
  if (result.statusCode === 401) {
    try { await refreshTokens(); } catch { throw authExpired({ url }); }
    result = await downloadOnce();
    if (result.statusCode === 401) throw authExpired({ url });
  }
  if (result.statusCode !== 200 || !result.tempFilePath) throw { code: result.statusCode, message: '工资条下载失败，请重试' } as ApiError;
  return result.tempFilePath;
}

/** 业务单据下载使用独立路径白名单，不修改工资条下载规则。 */
export async function downloadBusinessPdf(url: string): Promise<string> {
  if (!/^\/business\/(?:receivables|receipts)\/\d+\/pdf$/.test(url) && !/^\/business\/summary\/pdf\?from=\d{4}-\d{2}$/.test(url)) throw { code: 400, message: '下载地址无效' } as ApiError;
  await ensureApiOrigin();
  if (!isApiOriginReachable()) throw unreachableError();
  const downloadOnce = () => new Promise<WechatMiniprogram.DownloadFileSuccessCallbackResult>((resolve, reject) => {
    wx.downloadFile({ url: buildUrl(url), header: { Authorization: `Bearer ${getToken()}` }, timeout: 60000, success: resolve,
      fail: (e) => {
        if (!isTimeoutFailure(e)) invalidateApiOrigin();
        reject({ code: -1, message: isTimeoutFailure(e) ? '下载超时，请稍后重试' : '下载失败，请检查网络后重试' } as ApiError);
      } });
  });
  if (!getToken()) { redirectToLogin(); throw { code: 401, message: '请先登录' } as ApiError; }
  let result = await withOriginRetry(downloadOnce);
  if (result.statusCode === 401) {
    try { await refreshTokens(); } catch { throw authExpired({ url }); }
    result = await downloadOnce();
    if (result.statusCode === 401) throw authExpired({ url });
  }
  if (result.statusCode === 503) {
    throw { code: 503, message: '系统维护中，请 2 点后再试' } as ApiError;
  }
  if (result.statusCode !== 200 || !result.tempFilePath) {
    throw { code: result.statusCode, message: '下载失败，请检查业务员绑定或重试' } as ApiError;
  }
  return result.tempFilePath;
}

export function put<T>(url: string, data?: unknown, options: Partial<RequestOptions> = {}): Promise<T> {
  return request<T>({ url, method: 'PUT', data, ...options });
}

export function del<T>(url: string, data?: unknown, options: Partial<RequestOptions> = {}): Promise<T> {
  return request<T>({ url, method: 'DELETE', data, ...options });
}

export interface UploadOptions {
  url: string;
  filePath: string;
  name?: string;
  formData?: Record<string, string | number>;
  header?: Record<string, string>;
  silent?: boolean;
}

async function uploadOnce(options: UploadOptions): Promise<WechatMiniprogram.UploadFileSuccessCallbackResult> {
  await ensureApiOrigin();
  if (!isApiOriginReachable()) throw unreachableError(options.silent);
  return new Promise((resolve, reject) => {
    wx.uploadFile({
      url: buildUrl(options.url),
      filePath: options.filePath,
      name: options.name || 'file',
      formData: options.formData || {},
      header: {
        ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}),
        ...(options.header || {}),
      },
      success: resolve,
      fail: (e) => {
        const timeout = isTimeoutFailure(e);
        if (!timeout) invalidateApiOrigin();
        console.warn('[api] 上传失败', buildUrl(options.url));
        const err: ApiError = { code: -1, message: timeout ? '上传超时，请稍后重试' : '网络连接失败，请确认手机与电脑在同一网络' };
        if (!options.silent) toastError(err.message);
        reject(err);
      },
    });
  });
}

/** wx.uploadFile 的 Promise 封装，带 401 刷新重试 */
export async function upload<T>(options: UploadOptions): Promise<T> {
  if (!getToken()) {
    redirectToLogin();
    throw { code: 401, message: '请先登录' } as ApiError;
  }

  let res = await withOriginRetry(() => uploadOnce(options));
  if (res.statusCode === 401) {
    try {
      await refreshTokens();
    } catch {
      const err = authExpired(options);
      throw err;
    }
    res = await uploadOnce(options);
    if (res.statusCode === 401) {
      throw authExpired(options);
    }
  }

  return unwrap<T>(res.statusCode, res.data, options.silent);
}
