import assert from 'node:assert/strict';
import test from 'node:test';
import { extractPartialReason, SseDecoder } from '../src/domains/approvals/expenseAiStream';

test('AI 原因在 JSON 流中逐步显示，转义字符不破坏输出', () => {
  assert.equal(extractPartialReason('{"reason":"缺少行'), '缺少行');
  assert.equal(extractPartialReason('{"reason":"请补充\\n行程单'), '请补充\n行程单');
  assert.equal(extractPartialReason('{"reason":"\\u4'), '');
});

test('模型 SSE 可跨块分割并忽略 keep-alive', () => {
  const events: string[] = [];
  const decoder = new SseDecoder((data) => events.push(data));
  decoder.push(': keep-alive\r\ndata: {"choices":');
  decoder.push('[]}\r\n\r\ndata: [DONE]\n\n');
  assert.deepEqual(events, ['{"choices":[]}', '[DONE]']);
});
