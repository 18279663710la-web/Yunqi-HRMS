import assert from 'node:assert/strict';
import test from 'node:test';
import { streamPost } from '../../miniprogram/utils/request';

test('流式预审登录过期时刷新令牌并重试', async () => {
  const oldWx = (globalThis as any).wx;
  const store: Record<string, unknown> = { access_token: 'old', refresh_token: 'refresh' };
  const auth: string[] = [];
  (globalThis as any).wx = {
    getStorageSync: (key: string) => store[key], setStorageSync: (key: string, value: unknown) => { store[key] = value; },
    request(options: any) {
      if (options.url.endsWith('/auth/refresh')) {
        queueMicrotask(() => options.success({ statusCode: 200, data: { code: 0, data: { accessToken: 'new', refreshToken: 'fresh', user: {} } } }));
        return {};
      }
      auth.push(options.header.Authorization);
      return { abort() {}, onChunkReceived(listener: any) { queueMicrotask(() => {
        if (auth.length === 1) options.success({ statusCode: 401, data: new ArrayBuffer(0) });
        else { listener({ data: new TextEncoder().encode('data: {"type":"result","status":"no_rules","advice":null}\n\n').buffer }); options.success({ statusCode: 200, data: new ArrayBuffer(0) }); }
      }); } };
    },
  };
  try {
    const events: unknown[] = [];
    await streamPost('/approvals/expense-precheck/stream', {}, 10000, (e) => events.push(e)).promise;
    assert.deepEqual(auth, ['Bearer old', 'Bearer new']);
    assert.deepEqual(events, [{ type: 'result', status: 'no_rules', advice: null }]);
  } finally { (globalThis as any).wx = oldWx; }
});

test('流式响应未收到最终结果时报告连接中断', async () => {
  const oldWx = (globalThis as any).wx;
  (globalThis as any).wx = { getStorageSync: () => 'token', request(options: any) {
    return { abort() {}, onChunkReceived(listener: any) { queueMicrotask(() => {
      listener({ data: new TextEncoder().encode('data: {"type":"progress","text":"partial"}\n\n').buffer });
      options.success({ statusCode: 200, data: new ArrayBuffer(0) });
    }); } };
  } };
  try { await assert.rejects(streamPost('/test', {}, 1000, () => {}).promise, /./); }
  finally { (globalThis as any).wx = oldWx; }
});
