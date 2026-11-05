import assert from 'node:assert/strict';
import test from 'node:test';

import { departments, employees } from '../src/shared/db/seedData';

test('演示员工每种职位各保留一位负责人与一位普通员工', () => {
  const expected = new Map([
    ['U005', true], ['U001', false],
    ['U012', true], ['U013', false],
    ['U010', true], ['U011', false],
  ]);
  assert.equal(employees.length, expected.size);
  for (const employee of employees) {
    assert.equal(expected.get(employee.id), employee.isLeader, employee.id);
    expected.delete(employee.id);
  }
  assert.equal(expected.size, 0);
});

test('演示部门的负责人均为保留的员工', () => {
  const ids = new Set(employees.map((employee) => employee.id));
  for (const department of departments) {
    assert.ok(!department.leaderId || ids.has(department.leaderId), department.id);
  }
});
