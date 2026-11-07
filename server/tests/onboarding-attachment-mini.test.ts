import assert from 'node:assert/strict';
import test from 'node:test';

test('小程序附件支持相册、拍照和聊天文件，并回填表格子字段', async () => {
  let definition: any; let source = 0; let submitted: any; const uploads: Array<Record<string, unknown>> = [];
  (globalThis as any).Page = (page: unknown) => { definition = page; };
  (globalThis as any).wx = {
    getSystemInfoSync: () => ({ platform: 'devtools' }),
    getStorageSync: (key: string) => key === 'access_token' ? 'token' : '',
    showActionSheet: ({ success }: any) => success({ tapIndex: source }),
    chooseMedia: ({ sourceType, success }: any) => { assert.deepEqual(sourceType, [source === 0 ? 'album' : 'camera']); success({ tempFiles: [{ tempFilePath: '/temp/photo.jpg', size: 123 }] }); },
    chooseMessageFile: ({ type, success }: any) => { assert.equal(type, 'all'); success({ tempFiles: [{ path: '/temp/doc.pdf', name: '证明.pdf', size: 456 }] }); },
    uploadFile: (options: any) => { uploads.push(options.formData); options.success({ statusCode: 200, data: JSON.stringify({ code: 0, data: { id: `file-${uploads.length}`, name: options.formData.filename, size: options.filePath.endsWith('pdf') ? 456 : 123 } }) }); },
    request: (options: any) => { submitted = options.data; options.success({ statusCode: 200, data: { code: 0, data: {} } }); },
    reLaunch: () => {},
    showToast: () => {},
  };
  await import('../../miniprogram/pages/onboarding/onboarding');
  const page = { ...definition, data: { ...definition.data, onboarding: { template: [
    { name: '附件', type: 'attachment', value: '', files: [] },
    { name: '经历', type: 'table', value: '', children: [{ name: '证明', type: 'attachment' }], rows: [{ id: 'row1', values: {}, files: {} }] },
  ] } }, setData(data: unknown) { Object.assign(this.data, data); } };
  for (source = 0; source < 3; source += 1) {
    page.chooseAttachment({ currentTarget: { dataset: source === 2 ? { index: 1, row: 0, child: 0 } : { index: 0 } } });
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  assert.equal(page.data.onboarding.template[0].files.length, 2);
  assert.equal(page.data.onboarding.template[1].rows[0].files.证明[0].name, '证明.pdf');
  assert.deepEqual(uploads.map(item => [item.field, item.child || '']), [['附件', ''], ['附件', ''], ['经历', '证明']]);
  page.removeAttachment({ currentTarget: { dataset: { index: 0, id: 'file-1' } } });
  assert.equal(page.data.onboarding.template[0].files.length, 1);
  page.setData({ onboardingSignature: 'signature', declarationAccepted: true });
  await page.submitOnboarding();
  assert.equal(submitted.values.附件[0].id, 'file-2');
  assert.equal(submitted.values.经历[0].证明[0].name, '证明.pdf');
});
