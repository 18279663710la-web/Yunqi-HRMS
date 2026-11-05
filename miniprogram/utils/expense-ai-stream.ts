import type { ExpensePrecheckResult } from '../types/models';

export type AiStreamEvent = { type: 'progress'; text: string } | ({ type: 'result' } & ExpensePrecheckResult);

/** 后端将非 ASCII 字符编码为 JSON 转义，分块时不会拆坏中文。 */
export class AiStreamDecoder {
  private buffer = '';
  constructor(private readonly onEvent: (event: AiStreamEvent) => void) {}
  push(data: ArrayBuffer): void {
    const bytes = new Uint8Array(data);
    for (let i = 0; i < bytes.length; i += 1) this.buffer += String.fromCharCode(bytes[i]);
    let end = this.buffer.indexOf('\n\n');
    while (end >= 0) {
      const frame = this.buffer.slice(0, end);
      this.buffer = this.buffer.slice(end + 2);
      const dataLine = frame.split('\n').find((line) => line.startsWith('data: '));
      if (dataLine) {
        try { this.onEvent(JSON.parse(dataLine.slice(6)) as AiStreamEvent); } catch { /* 忽略无效帧，等待最终结果 */ }
      }
      end = this.buffer.indexOf('\n\n');
    }
  }
}
