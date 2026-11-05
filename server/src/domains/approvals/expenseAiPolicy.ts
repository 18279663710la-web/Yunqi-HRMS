export interface AiAdvice {
  recommendation: 'approve' | 'reject' | null;
  reason: string;
  rule: string;
  missingAttachments: string[];
  attachmentIssues: Array<{ name: string; issue: string }>;
}

export function parseAiAdvice(text: string): AiAdvice {
  const inconclusive: AiAdvice = { recommendation: null, reason: '资料不足或结果不明确，请人工复核', rule: '', missingAttachments: [], attachmentIssues: [] };
  try {
    const data: unknown = JSON.parse(text);
    if (!data || typeof data !== 'object') return inconclusive;
    const value = data as Record<string, unknown>;
    const reason = typeof value.reason === 'string' ? value.reason.trim().slice(0, 1000) : '';
    const rule = typeof value.rule === 'string' ? value.rule.trim().slice(0, 1000) : '';
    if ((value.recommendation !== 'approve' && value.recommendation !== 'reject') || !reason || !rule) return { ...inconclusive, reason: reason || inconclusive.reason };
    const missingAttachments = value.recommendation === 'reject' && Array.isArray(value.missingAttachments)
      ? value.missingAttachments.filter((item): item is string => typeof item === 'string').map((item) => item.trim().slice(0, 100)).filter(Boolean).slice(0, 20)
      : [];
    const attachmentIssues = value.recommendation === 'reject' && Array.isArray(value.attachmentIssues)
      ? value.attachmentIssues.flatMap((item: unknown) => {
          if (!item || typeof item !== 'object') return [];
          const entry = item as Record<string, unknown>;
          const name = typeof entry.name === 'string' ? entry.name.trim().slice(0, 100) : '';
          const issue = typeof entry.issue === 'string' ? entry.issue.trim().slice(0, 500) : '';
          return name && issue ? [{ name, issue }] : [];
        }).slice(0, 20) : [];
    return { recommendation: value.recommendation, reason, rule, missingAttachments, attachmentIssues };
  } catch { return inconclusive; }
}

/** 为提交时的规则快照生成稳定编号，供模型选择后由服务端还原原文。 */
export function splitApprovalRules(rules: string): Array<{ id: string; text: string }> {
  return (rules.match(/[^\n。！？]+[。！？]?/g) || []).map((part) => part.trim()).filter(Boolean).map((text, index) => ({ id: `R${index + 1}`, text }));
}

/** 只接受有效编号或快照中的原文，避免把模型改写的文字误判为不存在。 */
export function parseGroundedAdvice(text: string, rules: string): AiAdvice | null {
  try {
    const value: unknown = JSON.parse(text);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const data = value as Record<string, unknown>;
    if (Array.isArray(data.ruleIds) && data.ruleIds.length) {
      const references = new Map(splitApprovalRules(rules).map((rule) => [rule.id, rule.text]));
      if (data.ruleIds.length > 20 || data.ruleIds.some((id) => typeof id !== 'string' || !references.has(id))) return null;
      data.rule = [...new Set(data.ruleIds as string[])].map((id) => references.get(id)!).join('\n');
    } else {
      const original = typeof data.rule === 'string' ? data.rule.trim() : '';
      if (!original || !rules.includes(original)) return null;
    }
    const advice = parseAiAdvice(JSON.stringify(data));
    return advice.recommendation ? advice : null;
  } catch { return null; }
}

/** 只记录错误类别，避免将业务资料或模型输出写入日志。 */
export function classifyAiError(error: unknown): string {
  if (!(error instanceof Error)) return 'service_error';
  if (error.name === 'AbortError' || error.name === 'TimeoutError') return 'timeout_or_aborted';
  const http = /^AI 服务请求失败 \((\d{3})\)$/.exec(error.message);
  if (http) return `provider_http_${http[1]}`;
  if (error.message === 'AI 建议的规则编号或结果格式无效') return 'invalid_output';
  if (error.message === 'AI 流式响应中断') return 'stream_interrupted';
  return 'service_error';
}

export function localUploadFilename(value: string): string | null {
  const match = /^\/uploads\/([\w.-]+)$/.exec(value);
  return match && match[1] !== '.' && match[1] !== '..' ? match[1] : null;
}
