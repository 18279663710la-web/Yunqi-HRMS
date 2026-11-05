import assert from 'node:assert/strict';
import test from 'node:test';
import { extractPartialReason, SseDecoder } from '../src/domains/approvals/expenseAiStream';
import { AiStreamDecoder } from '../../miniprogram/utils/expense-ai-stream';

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

test('小程序流消息在分块后能还原中文和最终结果', () => {
  const events: unknown[] = [];
  const decoder = new AiStreamDecoder((event) => events.push(event));
  const data = 'data: {"type":"progress","text":"\\u7f3a\\u5c11"}\n\ndata: {"type":"result","status":"completed"}\n\n';
  const bytes = new TextEncoder().encode(data);
  decoder.push(bytes.slice(0, 17).buffer);
  decoder.push(bytes.slice(17, 53).buffer);
  decoder.push(bytes.slice(53).buffer);
  assert.deepEqual(events, [{ type: 'progress', text: '缺少' }, { type: 'result', status: 'completed' }]);
});
