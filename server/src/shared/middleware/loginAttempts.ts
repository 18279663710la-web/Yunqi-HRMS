import { HttpError } from '../utils/errors';

const FAILURE_LIMIT = 10;
const WINDOW_MS = 10 * 60 * 1000;

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

export function loginAttemptKey(scope: 'employee' | 'admin', ip: string, loginName: string): string {
  return `${scope}\n${ip}\n${loginName.trim()}`;
}

function currentBucket(key: string, now: number): Bucket | undefined {
  const bucket = buckets.get(key);
  if (!bucket) return undefined;
  if (now >= bucket.resetAt) {
    buckets.delete(key);
    return undefined;
  }
  return bucket;
}

export function assertLoginAllowed(key: string, now = Date.now()): void {
  const bucket = currentBucket(key, now);
  if (bucket && bucket.count >= FAILURE_LIMIT) {
    throw new HttpError(429, 429, '尝试次数过多，请稍后再试');
  }
}

/** 记一次失败。达到上限时改为 429，调用方不必再返回原来的认证错误。 */
export function recordLoginFailure(key: string, now = Date.now()): void {
  const bucket = currentBucket(key, now);
  if (!bucket) {
    buckets.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return;
  }
  bucket.count += 1;
  if (bucket.count >= FAILURE_LIMIT) {
    throw new HttpError(429, 429, '尝试次数过多，请稍后再试');
  }
}

export function clearLoginFailures(key: string): void {
  buckets.delete(key);
}

export function resetLoginAttempts(): void {
  buckets.clear();
}

function isCredentialRejection(error: unknown): error is HttpError {
  return error instanceof HttpError && (error.status === 401 || error.status === 403);
}

export async function withLoginAttempt<T>(
  scope: 'employee' | 'admin',
  ip: string,
  loginName: string,
  attempt: () => Promise<T>,
): Promise<T> {
  const key = loginAttemptKey(scope, ip, loginName);
  assertLoginAllowed(key);
  try {
    const result = await attempt();
    clearLoginFailures(key);
    return result;
  } catch (error) {
    if (isCredentialRejection(error)) recordLoginFailure(key);
    throw error;
  }
}
