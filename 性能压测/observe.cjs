if (process.env.PERF_ISOLATED !== 'yes') throw new Error('事件循环观测只允许在隔离压测环境中运行');
const { monitorEventLoopDelay, performance } = require('node:perf_hooks');
const delay = monitorEventLoopDelay({ resolution: 10 });
delay.enable();
let previous = performance.eventLoopUtilization();
setInterval(() => {
  const current = performance.eventLoopUtilization();
  const usage = performance.eventLoopUtilization(current, previous);
  previous = current;
  console.log('[perf-observe]', JSON.stringify({ time: new Date().toISOString(), eventLoopUtilization: Number(usage.utilization.toFixed(3)), eventLoopP95Ms: Number((delay.percentile(95) / 1e6).toFixed(1)), eventLoopMaxMs: Number((delay.max / 1e6).toFixed(1)), rssMiB: Number((process.memoryUsage().rss / 1048576).toFixed(1)) }));
  delay.reset();
}, 1000).unref();
