import assert from 'node:assert/strict';
import test from 'node:test';
import { apiOriginForPlatform } from '../../miniprogram/utils/apiOrigin';

test('开发者工具连接本机后端，真机保留配置的网络地址', () => {
  const deviceOrigin = 'http://192.0.2.1:3100';
  assert.equal(apiOriginForPlatform('devtools', deviceOrigin), 'http://127.0.0.1:3100');
  assert.equal(apiOriginForPlatform('ios', deviceOrigin), deviceOrigin);
  assert.equal(apiOriginForPlatform('android', deviceOrigin), deviceOrigin);
  assert.equal(apiOriginForPlatform('', deviceOrigin), deviceOrigin);
});
