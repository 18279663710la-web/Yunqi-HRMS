import crypto from 'node:crypto';
import path from 'node:path';

import { config } from '../../config';

const FILE_TTL_MS = 4 * 60 * 60 * 1000;
const SAFE_NAME = /^[\w.-]+$/;

export function expenseFileName(fileId: string): string | null {
  const match = /^\/uploads\/([\w.-]+)$/.exec(fileId);
  if (!match || !SAFE_NAME.test(match[1]) || match[1] === '.' || match[1] === '..') return null;
  return match[1];
}

function signature(name: string, exp: number): string {
  return crypto.createHmac('sha256', config.jwt.secret).update(`expense-file\n${name}\n${exp}`).digest('base64url');
}

/** 给报销图片签发短期地址。图片组件不携带登录头，签名本身就是访问凭据。 */
export function signExpenseFile(fileId: string, now = Date.now()): string {
  const name = expenseFileName(fileId);
  if (!name) return fileId;
  const exp = now + FILE_TTL_MS;
  return `/api/approval-files/${encodeURIComponent(name)}?exp=${exp}&sig=${signature(name, exp)}`;
}

export function verifyExpenseFileSignature(name: string, expRaw: unknown, sigRaw: unknown, now = Date.now()): boolean {
  if (!SAFE_NAME.test(name) || name === '.' || name === '..') return false;
  const exp = Number(expRaw);
  if (!Number.isSafeInteger(exp) || exp < now || exp > now + FILE_TTL_MS + 60_000) return false;
  const provided = String(sigRaw || '');
  const expected = signature(name, exp);
  const left = Buffer.from(provided);
  const right = Buffer.from(expected);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

export function resolveExpenseFilePath(name: string): string | null {
  if (!SAFE_NAME.test(name) || name === '.' || name === '..') return null;
  const root = path.resolve(config.uploadDir);
  const full = path.resolve(root, name);
  if (full !== path.join(root, name)) return null;
  return full;
}
