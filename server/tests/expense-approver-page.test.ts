import assert from 'node:assert/strict';
import test from 'node:test';

test('报销申请页面展示服务端配置的发票审批人，配置不可用时禁止提交', async () => {
  let definition: any;
  let available = true;
  const oldPage = (globalThis as any).Page;
  const oldWx = (globalThis as any).wx;
  (globalThis as any).Page = (page: unknown) => { definition = page; };
  (globalThis as any).wx = {
    getStorageSync: () => 'test-token',
    request(options: any) {
      assert.ok(options.url.endsWith('/approvals/expense-approver'));
      if (available) options.success({ statusCode: 200, data: { code: 0, data: { id: 'U011', name: '审批人', role: '发票审批人' } } });
      else options.success({ statusCode: 400, data: { code: 400, message: '报销审批人不可用' } });
    },
  };
  try {
    await import('../../miniprogram/pages/approval-create/approval-create');
    const page: any = { ...definition, data: { ...definition.data, typeKey: 'expense' }, setData(update: object) { Object.assign(this.data, update); } };
    await page.loadExpenseApprover();
    assert.equal(page.data.expenseApproverReady, true);
    assert.deepEqual(page.data.leader, { name: '审批人', position: '发票审批人' });
    available = false;
    await page.loadExpenseApprover();
    assert.equal(page.data.expenseApproverReady, false);
    assert.match(page.data.leader.name, /不可用/);
  } finally { (globalThis as any).Page = oldPage; (globalThis as any).wx = oldWx; }
});
