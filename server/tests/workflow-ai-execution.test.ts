import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';

test('实际流程 AI 节点使用节点模型设置生成建议', async () => {
  process.env.EXPENSE_AI_DRIVER = 'local';
  process.env.EXPENSE_AI_BASE_URL = 'http://127.0.0.1:1';
  const { generateExpenseAdvice } = await import('../src/domains/approvals/expenseAiService');
  let received: { authorization?: string; model?: string } = {};
  const server = http.createServer((req, res) => {
    let body = ''; req.on('data', chunk => { body += String(chunk); });
    req.on('end', () => {
      const parsed = JSON.parse(body) as { model: string };
      received = { authorization: req.headers.authorization, model: parsed.model };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ recommendation: 'approve', reason: '材料齐全', ruleIds: ['R1'], missingAttachments: [], attachmentIssues: [] }) } }] }));
    });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address(); assert.ok(addr && typeof addr !== 'string');
  try {
    const advice = await generateExpenseAdvice({ title: '测试', form: [], invoices: [], verification: [] }, '测试规则', {
      modelSettings: { provider: 'openai-compatible', model: 'test-model', baseUrl: `http://127.0.0.1:${addr.port}/v1`, apiKey: 'test-only-key' },
    });
    assert.equal(advice.recommendation, 'approve');
    assert.deepEqual(received, { authorization: 'Bearer test-only-key', model: 'test-model' });
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});
