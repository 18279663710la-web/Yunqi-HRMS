import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import { probeWorkflowAiUrl } from '../src/domains/approvals/workflowAiUrlProbe';

test('AI 节点测试只检查 HTTP 响应，不发送密钥、审批材料或模型请求', async () => {
  const requests: Array<{ method?: string; authorization?: string; body: string; path?: string }> = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', chunk => { body += String(chunk); });
    req.on('end', () => {
      requests.push({ method: req.method, authorization: req.headers.authorization, body, path: req.url });
      res.writeHead(404); res.end('not a model endpoint');
    });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  try {
    const result = await probeWorkflowAiUrl(`http://127.0.0.1:${address.port}/api`);
    assert.deepEqual(result, { reachable: true, status: 404 });
    assert.deepEqual(requests, [{ method: 'GET', authorization: undefined, body: '', path: '/api' }]);
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});

test('不合法地址和连接失败不能视为测试通过', async () => {
  assert.equal((await probeWorkflowAiUrl('file:///etc/passwd')).reachable, false);
  assert.equal((await probeWorkflowAiUrl('https://user:secret@example.test')).reachable, false);
  assert.equal((await probeWorkflowAiUrl('http://127.0.0.1:1', 500)).reachable, false);
});
