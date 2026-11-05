import assert from 'node:assert/strict';
import test from 'node:test';

test('发票上传后先查重再验真，失败或删除时不可继续提交', async () => {
  let definition: any;
  const requests: string[] = [];
  let mode = 'valid';
  let pending: any;
  let latest: any;
  const oldComponent = (globalThis as any).Component;
  const oldWx = (globalThis as any).wx;
  (globalThis as any).Component = (value: unknown) => { definition = value; };
  (globalThis as any).wx = {
    getStorageSync: () => 'token',
    showToast() {},
    request(options: any) {
      requests.push(options.url.split('/').pop()!);
      if (options.url.endsWith('/invoices/duplicate')) {
        if (mode === 'hold') { pending = options; return; }
        return options.success({ statusCode: 200, data: { code: 0, data: { duplicated: mode === 'duplicate', blocking: mode === 'duplicate', hits: [] } } });
      }
      if (mode === 'holdVerify') { pending = options; return; }
      const result = mode === 'valid' ? { status: 'valid', mock: false, message: '核验通过' } : mode === 'mock' ? { status: 'valid', mock: true, message: '模拟结果' } : { status: 'notFound', mock: false, message: '查无此票' };
      options.success({ statusCode: 200, data: { code: 0, data: result } });
    },
  };
  try {
    await import('../../miniprogram/components/invoice-uploader/index');
    const invoice = { id: 'i', invoiceNumber: '12345678901234567890', invoiceCode: '', invoiceType: '数电发票', invoiceDate: '2026-10-05', amount: 20, taxAmount: 0, totalAmount: 20 };
    const item = () => ({ id: 'i', status: 'done', result: invoice, checkState: 'pending', checkMessage: '', batchDuplicate: false, source: 'qr' });
    const component: any = { ...definition.methods, data: { ...definition.data, invoices: [item()] }, setData(data: object) { Object.assign(this.data, data); }, triggerEvent(_name: string, data: unknown) { latest = data; } };
    await component.checkInvoice('i');
    assert.deepEqual(requests, ['duplicate', 'verify']);
    assert.equal(component.data.invoices[0].checkState, 'clear');
    assert.equal(latest.checkReady, true);
    mode = 'holdVerify';
    const verifying = component.checkInvoice('i');
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(component.data.invoices[0].checkState, 'verifying');
    assert.equal(latest.checkReady, false);
    pending.success({ statusCode: 200, data: { code: 0, data: { status: 'valid', mock: false } } });
    await verifying;
    assert.equal(latest.checkReady, true);
    mode = 'duplicate'; requests.length = 0;
    await component.checkInvoice('i');
    assert.deepEqual(requests, ['duplicate']);
    assert.equal(latest.checkReady, false);
    mode = 'notFound'; requests.length = 0;
    await component.checkInvoice('i');
    assert.equal(component.data.invoices[0].checkMessage, '查无此票');
    assert.equal(latest.checkReady, false);
    mode = 'mock';
    await component.checkInvoice('i');
    assert.equal(latest.checkReady, false);
    mode = 'hold'; requests.length = 0;
    const checking = component.checkInvoice('i');
    component.onRemove({ currentTarget: { dataset: { id: 'i' } } });
    pending.success({ statusCode: 200, data: { code: 0, data: { duplicated: false, blocking: false, hits: [] } } });
    await checking;
    assert.deepEqual(requests, ['duplicate']);
    assert.equal(latest.checkReady, false);
  } finally { (globalThis as any).Component = oldComponent; (globalThis as any).wx = oldWx; }
});
