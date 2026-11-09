export type WorkflowAiUrlProbeResult = { reachable: true; status: number } | { reachable: false };

/** 只检测地址是否返回 HTTP 响应；不携带凭据或申请内容，也不跟随重定向。 */
export async function probeWorkflowAiUrl(input: string, timeoutMs = 5000): Promise<WorkflowAiUrlProbeResult> {
  let url: URL;
  try {
    url = new URL(input);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) return { reachable: false };
  } catch { return { reachable: false }; }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { method: 'GET', redirect: 'manual', signal: controller.signal });
    void response.body?.cancel().catch(() => {});
    return { reachable: true, status: response.status };
  } catch { return { reachable: false }; }
  finally { clearTimeout(timer); }
}
