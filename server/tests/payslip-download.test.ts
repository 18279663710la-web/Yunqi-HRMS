import assert from 'node:assert/strict';
import test from 'node:test';

test('工资条下载使用请求头并在登录过期时刷新重试', async () => {
  const storage: Record<string, unknown> = { access_token: 'old-token', refresh_token: 'refresh-token', current_user: { id: 'U1' } };
  const downloads: Array<{ url: string; authorization: string }> = [];
  (globalThis as any).getCurrentPages = () => [];
  (globalThis as any).wx = {
    getStorageSync: (key: string) => storage[key],
    setStorageSync: (key: string, value: unknown) => { storage[key] = value; },
    removeStorageSync: (key: string) => { delete storage[key]; },
    downloadFile: (options: any) => {
      downloads.push({ url: options.url, authorization: options.header.Authorization });
      options.success(downloads.length === 1 ? { statusCode: 401, tempFilePath: '' } : { statusCode: 200, tempFilePath: 'wxfile://payslip.pdf' });
    },
    request: (options: any) => options.success({ statusCode: 200, data: { code: 0, data: { accessToken: 'new-token', refreshToken: 'new-refresh', user: { id: 'U1' } } } }),
  };
  const { downloadAuthenticatedFile } = await import('../../miniprogram/utils/request');
  assert.equal(await downloadAuthenticatedFile('/payslips/12/pdf'), 'wxfile://payslip.pdf');
  assert.deepEqual(downloads.map(item => item.authorization), ['Bearer old-token', 'Bearer new-token']);
  assert.ok(downloads.every(item => !item.url.includes('token')));
  await assert.rejects(downloadAuthenticatedFile('https://example.com/payslips/12/pdf'));
});
