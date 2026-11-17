import fs from 'node:fs';
import path from 'node:path';
import type { Request } from 'express';

import { config } from '../../config';
import { dateKey } from '../utils/datetime';

export type LogScope = 'admin' | 'miniprogram' | 'system' | 'ops';
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogMeta {
  userId?: string;
  ip?: string;
  detail?: string;
}

const SCOPES: LogScope[] = ['admin', 'miniprogram', 'system', 'ops'];
const queues = new Map<string, Promise<void>>();

/** 请求路径到日志模块的映射；按前缀归类，未识别的统一落到 other。 */
const ADMIN_MODULES: Array<[string, string]> = [
  ['/api/admin/auth', 'auth'],
  ['/api/admin/employees', 'employees'],
  ['/api/admin/hr', 'hr'],
  ['/api/admin/attendance', 'attendance'],
  ['/api/admin/approvals', 'approvals'],
  ['/api/admin/approval-workflows', 'approvals'],
  ['/api/admin/approval-summary', 'approvals'],
  ['/api/admin/approval-summary-options', 'approvals'],
  ['/api/admin/approval-summary-fields', 'approvals'],
  ['/api/admin/approval-types', 'approvals'],
  ['/api/admin/approval-approvers', 'approvals'],
  ['/api/admin/notices', 'notices'],
  ['/api/admin/departments', 'organizations'],
  ['/api/admin/admins', 'admin-accounts'],
  ['/api/admin/models-formulas', 'models-formulas'],
  ['/api/admin/onboarding-form', 'onboarding'],
  ['/api/admin/offboarding-form', 'offboarding'],
  ['/api/admin/u9', 'u9'],
  ['/api/admin/dashboard', 'dashboard'],
  ['/api/admin/logs', 'audit'],
];

const MINIPROGRAM_MODULES: Array<[string, string]> = [
  ['/api/admin', 'other'],
  ['/api/approvals', 'approvals'],
  ['/api/approval-files', 'approvals'],
  ['/api/auth', 'auth'],
  ['/api/attendance', 'attendance'],
  ['/api/invoices', 'invoices'],
  ['/api/notices', 'notices'],
  ['/api/payslips', 'workbench'],
  ['/api/onboarding-form', 'onboarding'],
  ['/api/todo-stats', 'workbench'],
  ['/api/company', 'workbench'],
  ['/api/quick-actions', 'workbench'],
  ['/api/approval-types', 'workbench'],
  ['/api/job-titles', 'contacts'],
  ['/api/business', 'business'],
];

function pad(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

function stamp(date = new Date()): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${String(date.getMilliseconds()).padStart(3, '0')}`;
}

function safeModule(module: string): string {
  return /^[a-z0-9-]+$/.test(module) ? module : 'other';
}

/** 解析请求路径所属的端与业务模块，用于分文件写日志。 */
export function moduleForPath(pathname: string): { scope: Exclude<LogScope, 'system' | 'ops'>; module: string } {
  if (pathname.startsWith('/api/admin')) {
    for (const [prefix, module] of ADMIN_MODULES) {
      if (pathname === prefix || pathname.startsWith(`${prefix}/`) || pathname.startsWith(`${prefix}?`)) {
        return { scope: 'admin', module };
      }
    }
    return { scope: 'admin', module: 'other' };
  }
  for (const [prefix, module] of MINIPROGRAM_MODULES) {
    if (pathname === prefix || pathname.startsWith(`${prefix}/`) || pathname.startsWith(`${prefix}?`)) {
      return { scope: 'miniprogram', module };
    }
  }
  return { scope: 'miniprogram', module: 'other' };
}

function fileFor(scope: LogScope, module: string, date = new Date()): string {
  return path.join(config.logging.dir, scope, safeModule(module), `${dateKey(date)}.log`);
}

function metaText(meta?: LogMeta): string {
  if (!meta) return '';
  const parts: string[] = [];
  if (meta.userId) parts.push(`user=${meta.userId}`);
  if (meta.ip) parts.push(`ip=${meta.ip}`);
  if (meta.detail) parts.push(meta.detail);
  return parts.length ? ` ${parts.join(' ')}` : '';
}

function write(scope: LogScope, module: string, level: LogLevel, message: string, meta?: LogMeta): void {
  if (!config.logging.enabled) return;
  const safeScope = SCOPES.includes(scope) ? scope : 'system';
  const file = fileFor(safeScope, module);
  const line = `${stamp()} [${level.toUpperCase()}] [${safeScope}/${safeModule(module)}] ${message}${metaText(meta)}\n`;

  const previous = queues.get(file) ?? Promise.resolve();
  const next = previous
    .then(async () => {
      await fs.promises.mkdir(path.dirname(file), { recursive: true });
      await fs.promises.appendFile(file, line, 'utf8');
    })
    .catch((error) => {
      console.error('[logger] 写入日志失败', error);
    });
  queues.set(file, next);
  void next.finally(() => {
    if (queues.get(file) === next) queues.delete(file);
  });

  if (config.logging.console) {
    const text = `[${safeScope}/${safeModule(module)}] ${message}${metaText(meta)}`;
    if (level === 'error') console.error(text);
    else if (level === 'warn') console.warn(text);
    else console.log(text);
  }
}

/** 写指定端的模块日志。 */
export function logModule(scope: 'admin' | 'miniprogram' | 'system', module: string, level: LogLevel, message: string, meta?: LogMeta): void {
  write(scope, module, level, message, meta);
}

/** 系统级任务（U9 同步、服务启动、AI 队列等）。 */
export function logSystem(module: string, level: LogLevel, message: string, meta?: LogMeta): void {
  write('system', module, level, message, meta);
}

/** 记录一次 API 请求；不记录查询参数，避免把签名地址、令牌等写入日志。 */
export function logRequest(req: Request, status: number, durationMs: number): void {
  const pathname = req.originalUrl.split('?')[0];
  const { scope, module } = moduleForPath(pathname);
  const user = (req as Request & { user?: { id?: string } }).user;
  write(scope, module, status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info', `${req.method} ${pathname} ${status} ${durationMs}ms`, {
    userId: user?.id,
    ip: req.ip,
  });
}

/** 记录未处理异常，带堆栈，供排错。 */
export function logRequestError(req: Request, error: unknown): void {
  const pathname = req.originalUrl.split('?')[0];
  const { scope, module } = moduleForPath(pathname);
  const user = (req as Request & { user?: { id?: string } }).user;
  const message = error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error);
  write(scope, module, 'error', `${req.method} ${pathname} 500 未处理异常：${message}`, { userId: user?.id, ip: req.ip });
}

function isLogFile(name: string): boolean {
  return /^\d{4}-\d{2}-\d{2}\.log$/.test(name);
}

/** 删除超过保留天数的日志文件；只处理 <scope>/<module>/YYYY-MM-DD.log。 */
export async function cleanupOldLogs(): Promise<void> {
  if (!config.logging.enabled || config.logging.retentionDays <= 0) return;
  const cutoff = dateKey(new Date(Date.now() - config.logging.retentionDays * 24 * 60 * 60 * 1000));
  const walk = async (directory: string): Promise<void> => {
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
        continue;
      }
      if (!entry.isFile() || !isLogFile(entry.name)) continue;
      if (entry.name.slice(0, 10) >= cutoff) continue;
      try { await fs.promises.unlink(full); } catch { /* 文件被占用时下次再清理 */ }
    }
  };
  await walk(config.logging.dir);
}

/** 启动时清理一次，之后每 6 小时清理一次。 */
export function startLogMaintenance(): void {
  if (!config.logging.enabled) return;
  void cleanupOldLogs();
  const timer = setInterval(() => { void cleanupOldLogs(); }, 6 * 60 * 60 * 1000);
  timer.unref();
}
