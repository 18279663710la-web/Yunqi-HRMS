import assert from 'node:assert/strict';
import test from 'node:test';
import type { Express } from 'express';

interface Layer {
  route?: { path: string; methods: Record<string, boolean> };
  handle?: { stack?: Layer[] };
}

function collectRoutes(layers: Layer[]): string[] {
  const paths: string[] = [];
  for (const layer of layers) {
    if (layer.route) {
      const methods = Object.entries(layer.route.methods)
        .filter(([, enabled]) => enabled)
        .map(([method]) => method.toUpperCase());
      paths.push(`${methods.join(',')} ${layer.route.path}`);
    }
    if (layer.handle?.stack) paths.push(...collectRoutes(layer.handle.stack));
  }
  return paths;
}

test('员工接口不再提供重置演示数据', async () => {
  const { createApp } = await import('../src/app');
  const app = createApp() as Express & { _router?: { stack?: Layer[] } };
  const routes = collectRoutes(app._router?.stack || []);
  assert.ok(routes.some((route) => route.includes('/attendance/punch')));
  assert.equal(routes.some((route) => route.includes('demo/reset')), false);
});
