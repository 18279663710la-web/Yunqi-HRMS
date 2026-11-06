import assert from 'node:assert/strict';
import test from 'node:test';
import { applyAttendanceInterface, clearSalaryInterface } from '../src/modules/models-formulas/salary/salaryInterfaceConfig';

test('确认考勤接口后保存选定项目，并约束字段类型及用途', () => {
  assert.deepEqual(applyAttendanceInterface('overtimeHours'), {
    interfaceSource: 'attendance', attendanceMetric: 'overtimeHours', type: 'number', category: 'info',
  });
  assert.throws(() => applyAttendanceInterface(undefined), /请选择考勤数据/);
});

test('切换为无时清除此前的考勤项目', () => {
  assert.deepEqual(clearSalaryInterface(), { interfaceSource: 'none', attendanceMetric: undefined });
});

test('加班费来源固定为数字收入', () => {
  assert.deepEqual(applyAttendanceInterface('overtimePay'), {
    interfaceSource: 'attendance', attendanceMetric: 'overtimePay', type: 'number', category: 'income',
  });
});
