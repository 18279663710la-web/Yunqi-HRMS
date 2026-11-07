import assert from 'node:assert/strict';
import test from 'node:test';
import { nextUnreadPayslip, payslipReminderKey } from '../../miniprogram/services/workbench/payslipPrompt';

test('工资条提醒逐一展示未读记录，重发版本可再次提醒', () => {
  const slips = [{ id: 1, revision: 1, read: true }, { id: 2, revision: 1, read: false }, { id: 3, revision: 1, read: false }];
  const shown = new Set<string>();
  assert.equal(nextUnreadPayslip(slips, shown)?.id, 2);
  shown.add(payslipReminderKey(slips[1]));
  assert.equal(nextUnreadPayslip(slips, shown)?.id, 3);
  shown.add(payslipReminderKey(slips[2]));
  assert.equal(nextUnreadPayslip(slips, shown), undefined);
  assert.equal(nextUnreadPayslip([{ ...slips[1], revision: 2 }], shown)?.id, 2);
});


test('工作台只提醒当前员工未读版本，离开页面的迟到响应不弹窗', async () => {
  let page: any;
  let route = 'pages/index/index';
  let revision = 1;
  let shown = 0;
  let delay: ((value: unknown) => void) | undefined;
  (globalThis as any).Page = (definition: any) => { page = definition; };
  (globalThis as any).getCurrentPages = () => [{ route }];
  (globalThis as any).wx = {
    getStorageSync: (key: string) => key === 'access_token' ? 'token' : key === 'current_user' ? { id: 'U1' } : '',
    request: (options: any) => {
      const response = { statusCode: 200, data: { code: 0, data: [{ id: 3, month: '2026-10', revision, read: false }] } };
      if (delay) delay(response); else options.success(response);
    },
    showModal: (options: any) => { shown++; options.success({ confirm: false, cancel: true }); },
  };
  await import('../../miniprogram/pages/index/index');
  const instance = { ...page, data: { ...page.data, ready: true }, reminderEpoch: 1, reminderKeys: new Set<string>() };
  await instance.checkPayslips();
  await instance.checkPayslips();
  assert.equal(shown, 1);
  revision = 2;
  await instance.checkPayslips();
  assert.equal(shown, 2);
  let release: ((value: any) => void) | undefined;
  (globalThis as any).wx.request = (options: any) => { release = options.success; };
  const pending = instance.checkPayslips();
  route = 'pages/mine/mine';
  release!({ statusCode: 200, data: { code: 0, data: [{ id: 4, month: '2026-10', revision: 1, read: false }] } });
  await pending;
  assert.equal(shown, 2);
});
