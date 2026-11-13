import { config } from '../../config';

type Entry = { at: number; value: unknown };

const cache = new Map<string, Entry>();

export function u9CacheGet<T>(key: string): T | undefined {
  const hit = cache.get(key);
  if (!hit) return undefined;
  if (Date.now() - hit.at > config.u9Mirror.queryCacheTtlMs) {
    cache.delete(key);
    return undefined;
  }
  return hit.value as T;
}

export function u9CacheSet(key: string, value: unknown): void {
  cache.set(key, { at: Date.now(), value });
}

export function invalidateU9QueryCache(): void {
  cache.clear();
}

export async function withU9Cache<T>(key: string, loader: () => Promise<T>): Promise<T> {
  const cached = u9CacheGet<T>(key);
  if (cached !== undefined) return cached;
  const value = await loader();
  u9CacheSet(key, value);
  return value;
}
