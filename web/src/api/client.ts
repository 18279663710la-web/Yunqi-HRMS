const API_BASE = (import.meta.env?.VITE_API_BASE as string | undefined) || '/api';
const TOKEN_KEY = 'yunqi_admin_token';

export class ApiError extends Error {
  status: number;
  code: number;

  constructor(status: number, code: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

export function getToken(): string {
  return localStorage.getItem(TOKEN_KEY) || '';
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  auth?: boolean;
  headers?: Record<string, string>;
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const token = getToken();
  const isFormData = options.body instanceof FormData;
  const headers: Record<string, string> = {
    ...(options.body !== undefined && !isFormData ? { 'Content-Type': 'application/json' } : {}),
    ...(options.auth !== false && token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options.headers || {}),
  };

  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method: options.method || 'GET',
      headers,
      body: options.body === undefined ? undefined : isFormData ? options.body as FormData : JSON.stringify(options.body),
    });
  } catch {
    throw new ApiError(0, -1, '无法连接后端服务，请确认 npm run dev 已启动');
  }

  let payload: unknown = null;
  const text = await response.text();
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }

  if (response.status === 401 && options.auth !== false) {
    clearToken();
    if (window.location.pathname !== '/login') {
      window.location.replace('/login');
    }
  }

  const body = payload as { code?: number; message?: string; data?: unknown } | null;
  if (!response.ok || !body || body.code !== 0) {
    const message = body && body.message ? body.message : `请求失败 (${response.status})`;
    throw new ApiError(response.status, body?.code ?? response.status, message);
  }

  return body.data as T;
}

export function buildQuery(params: Record<string, string | number | boolean | undefined | null>): string {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return;
    search.set(key, String(value));
  });
  const text = search.toString();
  return text ? `?${text}` : '';
}

/** 下载受管理员认证保护的文件，不将令牌放入 URL。 */
export async function downloadFile(path: string, filename: string): Promise<void> {
  const token = getToken();
  let response: Response;
  try { response = await fetch(`${API_BASE}${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} }); }
  catch { throw new ApiError(0, -1, '无法连接后端服务'); }
  if (!response.ok) {
    if (response.status === 401) { clearToken(); if (window.location.pathname !== '/login') window.location.replace('/login'); }
    const body = await response.json().catch(() => null) as { code?: number; message?: string } | null;
    throw new ApiError(response.status, body?.code ?? response.status, body?.message || `下载失败 (${response.status})`);
  }
  const objectUrl = URL.createObjectURL(await response.blob());
  const anchor = document.createElement('a'); anchor.href = objectUrl; anchor.download = filename.replace(/[\\/\x00-\x1f\x7f]/g, '_');
  document.body.appendChild(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}
