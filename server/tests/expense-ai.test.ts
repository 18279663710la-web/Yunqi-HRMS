import assert from 'node:assert/strict';
import test from 'node:test';
import { parseAiAdvice, localUploadFilename, parseGroundedAdvice, splitApprovalRules, classifyAiError } from '../src/domains/approvals/expenseAiPolicy';

test('AI 建议必须包含真实依据，驳回可列出需要补充的附件', () => {
  const result = parseAiAdvice(JSON.stringify({ recommendation: 'reject', reason: '未提供行程单', rule: '差旅费须提供行程单', missingAttachments: ['行程单'] }));
  assert.deepEqual(result, { recommendation: 'reject', reason: '未提供行程单', rule: '差旅费须提供行程单', missingAttachments: ['行程单'], attachmentIssues: [] });
});

test('材料不符合规则时展示具体材料和原因，不应只显示缺失材料', () => {
  const result = parseAiAdvice(JSON.stringify({ recommendation: 'reject', reason: '发票抬头不符', rule: '发票抬头应为公司名称', missingAttachments: [], attachmentIssues: [{ name: '发票', issue: '抬头与公司名称不一致' }] }));
  assert.deepEqual(result.attachmentIssues, [{ name: '发票', issue: '抬头与公司名称不一致' }]);
});

test('AI 输出不明确或格式错误时不产生同意或驳回建议', () => {
  assert.equal(parseAiAdvice('{"recommendation":"approve"}').recommendation, null);
  assert.equal(parseAiAdvice('not json').recommendation, null);
  assert.equal(parseAiAdvice('{"recommendation":"unknown","reason":"看不清"}').recommendation, null);
});

test('仅识别本地上传路径，拒绝任意外部 URL 和路径穿越', () => {
  assert.equal(localUploadFilename('/uploads/123_abc.png'), '123_abc.png');
  assert.equal(localUploadFilename('https://example.com/uploads/123_abc.png'), null);
  assert.equal(localUploadFilename('/uploads/../config.ts'), null);
});

test('依据规则编号还原真实规则，模型改写文字不会导致意见丢失', () => {
  const rules = '差旅费须提供行程单。住宿每晚不超过500元，超标须附负责人说明。';
  assert.deepEqual(splitApprovalRules(rules), [
    { id: 'R1', text: '差旅费须提供行程单。' },
    { id: 'R2', text: '住宿每晚不超过500元，超标须附负责人说明。' },
  ]);
  const advice = parseGroundedAdvice(JSON.stringify({ recommendation: 'reject', reason: '未提供超标说明', ruleIds: ['R2'], rule: '住宿超标应提供说明', missingAttachments: ['超标说明'] }), rules);
  assert.equal(advice?.recommendation, 'reject');
  assert.equal(advice?.rule, '住宿每晚不超过500元，超标须附负责人说明。');
  assert.deepEqual(advice?.missingAttachments, ['超标说明']);
});

test('无效规则编号或伪造依据不能当作有效同意意见', () => {
  const rules = '差旅费须提供行程单。';
  assert.equal(parseGroundedAdvice(JSON.stringify({ recommendation: 'approve', reason: '材料齐全', ruleIds: ['R9'] }), rules), null);
  assert.equal(parseGroundedAdvice(JSON.stringify({ recommendation: 'approve', reason: '材料齐全', rule: '虚构的规则' }), rules), null);
});

test('多条规则依据分别还原为后台原文', () => {
  const rules = '差旅费须提供行程单。住宿每晚不超过500元，超标须附负责人说明。';
  const advice = parseGroundedAdvice(JSON.stringify({ recommendation: 'reject', reason: '缺少材料', ruleIds: ['R1', 'R2'], missingAttachments: ['行程单'] }), rules);
  assert.equal(advice?.recommendation, 'reject');
  assert.equal(advice?.rule.split('\n').every((rule) => rules.includes(rule)), true);
});

test('AI 服务失败记录安全的错误类别，不输出请求或模型内容', () => {
  assert.equal(classifyAiError(new Error('AI 服务请求失败 (402)')), 'provider_http_402');
  assert.equal(classifyAiError(new Error('AI 建议的规则编号或结果格式无效')), 'invalid_output');
  assert.equal(classifyAiError(new Error('敏感请求内容')), 'service_error');
});
