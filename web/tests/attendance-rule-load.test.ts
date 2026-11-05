import assert from 'node:assert/strict';
import test from 'node:test';
import { ApiError } from '../src/api/client';
import { loadAttendanceRuleConfig } from '../src/modules/models-formulas/attendance/attendanceRuleLoader';

test('首次读取失败后可重试，只有成功获取规则才允许继续', async () => {
  let calls = 0;
  const load = async () => {
    calls++;
    if (calls === 1) throw new ApiError(503, 503, '服务暂不可用');
    return { mode: 'days_absence' as const, calculation: 'unit' as const, unitAdjustment: 100 };
  };
  assert.deepEqual(await loadAttendanceRuleConfig(load), { status: 'error', message: '服务暂不可用' });
  assert.deepEqual(await loadAttendanceRuleConfig(load), { status: 'ready', config: { mode: 'days_absence', calculation: 'unit', unitAdjustment: 100 } });
  assert.equal(calls, 2);
});

test('旧规则存在冲突时保留原有由管理员重新配置的行为', async () => {
  const result = await loadAttendanceRuleConfig(async () => { throw new ApiError(409, 409, '不同员工存在不同的旧规则'); });
  assert.deepEqual(result, { status: 'conflict', message: '不同员工存在不同的旧规则' });
});

test('服务响应格式不完整时拒绝解锁保存', async () => {
  const load = async () => ({ mode: 'days_absence', calculation: 'unit' }) as any;
  assert.equal((await loadAttendanceRuleConfig(load)).status, 'error');
});
