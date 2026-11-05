import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveLeaveApprover } from '../src/domains/approvals/leaveRouting';

const leaders = [
  { id: 'rd-leader', name: '研发负责人', jobCategory: '研发员' as const, isLeader: true, active: true },
  { id: 'sales-leader', name: '业务负责人', jobCategory: '业务员' as const, isLeader: true, active: true },
  { id: 'staff-leader', name: '员工负责人', jobCategory: '员工' as const, isLeader: true, active: true },
];
const chairperson = { id: 'chair', name: '董事长', active: true };

test('旧版职位路由：普通员工交给同职位负责人', () => {
  for (const leader of leaders) {
    const result = resolveLeaveApprover({ id: 'worker', jobCategory: leader.jobCategory, isLeader: false }, leaders, chairperson);
    assert.equal(result.id, leader.id);
  }
});

test('旧版职位路由：负责人交给董事长', () => {
  assert.equal(resolveLeaveApprover(leaders[0], leaders, chairperson).id, 'chair');
});

test('旧版职位路由：负责人或董事长不可用时不能自动通过', () => {
  const worker = { id: 'worker', jobCategory: '研发员' as const, isLeader: false };
  assert.throws(() => resolveLeaveApprover(worker, [], chairperson));
  assert.throws(() => resolveLeaveApprover(worker, [{ ...leaders[0], active: false }], chairperson));
  assert.throws(() => resolveLeaveApprover(worker, [leaders[0], { ...leaders[0], id: 'other' }], chairperson));
  assert.throws(() => resolveLeaveApprover(leaders[0], leaders, null));
  assert.throws(() => resolveLeaveApprover(leaders[0], leaders, { ...chairperson, active: false }));
  assert.throws(() => resolveLeaveApprover(leaders[0], leaders, { ...chairperson, id: leaders[0].id }));
});
