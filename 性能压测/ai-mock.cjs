if (process.env.PERF_ISOLATED !== 'yes') throw new Error('模拟 AI 只可在隔离环境运行');
const http = require('node:http');
const advice = JSON.stringify({ reason: 'Synthetic response', recommendation: 'approve', ruleIds: ['R1'], missingAttachments: [], attachmentIssues: [] });
http.createServer((req, res) => {
  if (req.method !== 'POST' || req.url !== '/v1/chat/completions') { res.writeHead(404); res.end(); return; }
  let body = '';
  req.on('data', chunk => { body += chunk; if (body.length > 1048576) req.destroy(); });
  req.on('end', () => {
    let input;
    try { input = JSON.parse(body); } catch { res.writeHead(400); res.end(); return; }
    setTimeout(() => {
      if (input.stream) {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: advice } }] })}\n\n`);
        res.end('data: [DONE]\n\n');
      } else {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ choices: [{ message: { content: advice } }] }));
      }
    }, 500);
  });
}).listen(9811, '127.0.0.1', () => console.log('isolated-ai-mock-ready'));
