import assert from 'node:assert/strict';
import test from 'node:test';
import { destinationFor } from '../../miniprogram/services/onboarding/onboardingGate';

test('员工待填写时进入入职引导，已提交进入工作台，董事长进入审批', () => {
  assert.equal(destinationFor(false, true), '/pages/onboarding-required/onboarding-required');
  assert.equal(destinationFor(false, false), '/pages/index/index');
  assert.equal(destinationFor(true, false), '/pages/approval/approval');
});
