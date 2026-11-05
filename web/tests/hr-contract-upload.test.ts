import assert from 'node:assert/strict';
import test from 'node:test';
import { uploadHrContractFile } from '../src/api/hr';
test('合同文件以管理员认证的 multipart 请求上传，不错误设置 JSON 请求头', async () => {
 let observed: RequestInit | undefined; let observedUrl = '';
 Object.assign(globalThis, { localStorage: { getItem: () => 'test-token' }, fetch: async (url: string, options: RequestInit) => { observedUrl = url; observed = options; return new Response(JSON.stringify({code:0,data:{id:3}}), {status:200,headers:{'Content-Type':'application/json'}}); } });
 const file = new File(['%PDF-test'], '劳动合同.pdf', { type: 'application/pdf' });
 assert.deepEqual(await uploadHrContractFile('U001', file), { id: 3 });
 assert.equal(observedUrl, '/api/admin/hr/employees/U001/contract-files'); assert.ok(observed?.body instanceof FormData);
 const headers = observed?.headers as Record<string,string>; assert.equal(headers.Authorization, 'Bearer test-token'); assert.equal(headers['Content-Type'], undefined);
 const sent = (observed?.body as FormData).get('file') as File; assert.equal(sent.name, '劳动合同.pdf'); assert.equal(await sent.text(), '%PDF-test');
});
