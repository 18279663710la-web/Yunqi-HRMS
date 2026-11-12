/**
 * 小程序后端地址解析。
 *
 * 开发者工具固定使用本机 127.0.0.1。
 * 真机按“手动设置 > 上次可用地址 > 候选地址”依次探测 `/health`，选择第一个可用的后端。
 * 校园网/手机热点切换后，请求失败会清空缓存，下次请求重新探测。
 */

const DEVTOOLS_ORIGIN = 'http://127.0.0.1:3100';
const CACHE_KEY = 'api_origin_cache_v1';
const OVERRIDE_KEY = 'api_origin_override_v1';
// 真机 Wi-Fi 往返可达 300ms 以上，探测超时过短会把可用地址误判为不可用。
const PROBE_TIMEOUT = 3000;
const OK_TTL = 5 * 60 * 1000;
const FAIL_TTL = 3 * 1000;

/**
 * 真机候选地址：校园网、手机热点、Windows 移动热点。
 * 地址变化时可在登录页长按底部“云启科技 · 企业办公”手动设置，设置后优先于自动探测。
 */
const DEVICE_ORIGINS = [
  'http://10.62.56.146:3100',
  'http://172.20.10.14:3100',
  'http://172.20.10.2:3100',
  'http://172.20.10.3:3100',
  'http://192.168.137.1:3100',
  'http://192.168.43.1:3100',
];

let platform = '';
try { platform = wx.getSystemInfoSync().platform; } catch { /* 真机调试等场景下回退为真机逻辑 */ }
const devtools = platform === 'devtools';

function readStorage<T>(key: string): T | null {
  try { return (wx.getStorageSync(key) as T) || null; } catch { return null; }
}

function writeStorage(key: string, value: unknown): void {
  try { wx.setStorageSync(key, value); } catch { /* 存储不可用时仅使用本次会话 */ }
}

function removeStorage(key: string): void {
  try { wx.removeStorageSync(key); } catch { /* ignore */ }
}

/** 接受 IP、IP:端口或完整 URL；未写端口时默认 3100。 */
export function normalizeOrigin(value: string): string {
  let text = String(value || '').trim();
  if (!text) return '';
  if (!/^https?:\/\//i.test(text)) text = `http://${text}`;
  const match = /^(https?:\/\/[^/:?#]+)(?::(\d+))?/i.exec(text);
  if (!match) return '';
  return `${match[1]}:${match[2] || '3100'}`;
}

function cachedOrigin(): string {
  const cached = readStorage<{ origin?: string }>(CACHE_KEY);
  return typeof cached?.origin === 'string' ? normalizeOrigin(cached.origin) : '';
}

function overrideOrigin(): string {
  const value = readStorage<string>(OVERRIDE_KEY);
  return typeof value === 'string' ? normalizeOrigin(value) : '';
}

let currentOrigin = devtools ? DEVTOOLS_ORIGIN : overrideOrigin() || cachedOrigin() || DEVICE_ORIGINS[0];
let expiresAt = 0;
let resolving: Promise<string> | null = null;
let lastProbeOk = true;
let lastProbeAt = 0;
let timeoutOrigin = '';
let timeoutCount = 0;

/** 当前正在使用的后端地址（同步读取，可能尚未完成启动探测）。 */
export function getApiOrigin(): string {
  return devtools ? DEVTOOLS_ORIGIN : currentOrigin;
}

/** 最近一次探测是否有可用后端；尚未探测过时按可用处理。 */
export function isApiOriginReachable(): boolean {
  return devtools || !lastProbeAt || lastProbeOk;
}

export function isDevtoolsPlatform(): boolean {
  return devtools;
}

function saveOrigin(origin: string): void {
  currentOrigin = origin;
  writeStorage(CACHE_KEY, { origin, at: Date.now() });
}

function probe(origin: string): Promise<boolean> {
  return new Promise((resolve) => {
    wx.request({
      url: `${origin}/health`,
      method: 'GET',
      timeout: PROBE_TIMEOUT,
      success: (result) => {
        const data = result.data as { ok?: boolean } | undefined;
        resolve(result.statusCode === 200 && !!data && data.ok === true);
      },
      fail: () => resolve(false),
    });
  });
}

/** 并行探测一组地址，返回第一个可用的；全部失败时返回 null。 */
function firstReachable(origins: string[]): Promise<string | null> {
  return new Promise((resolve) => {
    if (!origins.length) { resolve(null); return; }
    let settled = false;
    let pending = origins.length;
    for (const origin of origins) {
      void probe(origin).then((ok) => {
        pending -= 1;
        if (ok && !settled) { settled = true; resolve(origin); return; }
        if (pending === 0 && !settled) { settled = true; resolve(null); }
      });
    }
  });
}

/** 真机启动或缓存失效时探测可用后端；开发者工具直接返回本机地址。 */
export async function ensureApiOrigin(force = false): Promise<string> {
  if (devtools) return DEVTOOLS_ORIGIN;
  if (!force && Date.now() < expiresAt) return currentOrigin;
  if (resolving) return resolving;
  resolving = (async () => {
    const override = overrideOrigin();
    if (override && await probe(override)) {
      saveOrigin(override);
      expiresAt = Date.now() + OK_TTL;
      lastProbeOk = true;
      lastProbeAt = Date.now();
      return override;
    }
    const candidates = Array.from(new Set([cachedOrigin(), ...DEVICE_ORIGINS].filter(Boolean)));
    const origin = await firstReachable(candidates);
    if (origin) {
      saveOrigin(origin);
      expiresAt = Date.now() + OK_TTL;
      lastProbeOk = true;
      lastProbeAt = Date.now();
      return origin;
    }
    // 全部不可用时短暂缓存，避免每个请求都等待多次探测。
    expiresAt = Date.now() + FAIL_TTL;
    lastProbeOk = false;
    lastProbeAt = Date.now();
    return currentOrigin;
  })();
  try {
    return await resolving;
  } finally {
    resolving = null;
  }
}

/** 请求失败后调用，让下一次请求重新探测网络。 */
export function invalidateApiOrigin(): void {
  expiresAt = 0;
}

/**
 * 请求超时说明地址可能可达但服务端慢，单次不清缓存；
 * 同一地址连续超时两次视为链路失效，强制下次请求重新探测（例如切换热点后）。
 */
export function noteRequestTimeout(): void {
  if (timeoutOrigin !== currentOrigin) { timeoutOrigin = currentOrigin; timeoutCount = 1; return; }
  timeoutCount += 1;
  if (timeoutCount >= 2) invalidateApiOrigin();
}

/** 请求成功后重置连续超时计数。 */
export function noteRequestSuccess(): void {
  timeoutOrigin = '';
  timeoutCount = 0;
}

/**
 * 设置手动覆盖地址；传空字符串清除并恢复自动探测。
 * 返回规范化后的地址、空字符串（已清除）或 null（格式无效）。
 */
export function setApiOriginOverride(value: string): string | null {
  const text = String(value || '').trim();
  if (!text) {
    removeStorage(OVERRIDE_KEY);
    currentOrigin = cachedOrigin() || DEVICE_ORIGINS[0];
    expiresAt = 0;
    return '';
  }
  const origin = normalizeOrigin(text);
  if (!origin) return null;
  writeStorage(OVERRIDE_KEY, origin);
  currentOrigin = origin;
  expiresAt = 0;
  return origin;
}
