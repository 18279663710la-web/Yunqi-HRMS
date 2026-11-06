import assert from 'node:assert/strict';
import test from 'node:test';
import { applyAttendanceInterface, clearSalaryInterface } from '../src/modules/models-formulas/salary/salaryInterfaceConfig';

test('确认考勤接口后保存选定项目，并约束字段类型及用途', () => {
  assert.deepEqual(applyAttendanceInterface('overtimeHours'), {
    interfaceSource: 'attendance', attendanceMetric: 'overtimeHours', calculationRule: 'direct', type: 'number', category: 'info',
  });
  assert.throws(() => applyAttendanceInterface(undefined), /请选择考勤数据/);
});

test('切换为无时清除此前的考勤项目', () => {
  assert.deepEqual(clearSalaryInterface(), { interfaceSource: 'none', attendanceMetric: undefined, calculationRule: undefined });
});

test('加班费来源固定为数字收入', () => {
  assert.deepEqual(applyAttendanceInterface('overtimeHours', 'overtime'), {
    interfaceSource: 'attendance', attendanceMetric: 'overtimeHours', calculationRule: 'overtime', type: 'number', category: 'income',
  });
});

test('出勤绩效规则绑定出勤数据，直接输出保留仅记录', () => {
  assert.deepEqual(applyAttendanceInterface('presentDays', 'attendance'), {
    interfaceSource: 'attendance', attendanceMetric: 'presentDays', calculationRule: 'attendance', type: 'number', category: 'income',
  });
  assert.throws(() => applyAttendanceInterface('overtimeHours', 'attendance'), /不匹配/);
  assert.throws(() => applyAttendanceInterface('presentDays', 'overtime'), /不匹配/);
});
