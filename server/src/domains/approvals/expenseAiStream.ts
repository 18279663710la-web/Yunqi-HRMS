/** 增量解析 SSE，处理分块边界、CRLF 和服务端保活行。 */
export class SseDecoder {
  private buffer = '';
  private lines: string[] = [];
  constructor(private readonly onData: (data: string) => void) {}
  push(chunk: string): void {
    this.buffer += chunk;
    let end = this.buffer.indexOf('\n');
    while (end >= 0) {
      const line = this.buffer.slice(0, end).replace(/\r$/, '');
      this.buffer = this.buffer.slice(end + 1);
      if (!line) {
        if (this.lines.length) this.onData(this.lines.join('\n'));
        this.lines = [];
      } else if (line.startsWith('data:')) this.lines.push(line.slice(5).replace(/^ /, ''));
      end = this.buffer.indexOf('\n');
    }
  }
}

/** 仅提取模型正在生成的原因字段，完整结果仍需校验。 */
export function extractPartialReason(json: string): string {
  const match = /"reason"\s*:\s*"((?:\\.|[^"\\])*)/.exec(json);
  if (!match) return '';
  let value = match[1];
  for (let i = 0; i < 7 && value; i += 1) {
    try { return String(JSON.parse(`"${value}"`)).slice(0, 1000); }
    catch { value = value.slice(0, -1); }
  }
  return '';
}
