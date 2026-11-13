import assert from 'node:assert/strict';
import test from 'node:test';

test('createEmployeeU9Gateway 按配置选择镜像或直连', async () => {
  const { config } = await import('../src/config');
  const { createEmployeeU9Gateway, getU9QuerySource } = await import('../src/domains/u9/createGateway');
  const { mirrorU9 } = await import('../src/domains/u9/mirrorGateway');
  const { sqlServerU9 } = await import('../src/domains/u9/sqlServerGateway');
  const gateway = createEmployeeU9Gateway();
  if (getU9QuerySource() === 'mysql') {
    assert.equal(gateway, mirrorU9);
  } else {
    assert.equal(gateway, sqlServerU9);
  }
  assert.ok(config.u9Mirror.querySource === 'mysql' || config.u9Mirror.querySource === 'sqlserver');
});
