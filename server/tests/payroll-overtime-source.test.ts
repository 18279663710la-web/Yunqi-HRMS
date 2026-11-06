import assert from 'node:assert/strict';
import test from 'node:test';
import type { PoolConnection } from 'mysql2/promise';
import { readPayrollAttendance } from '../src/domains/attendance/payrollAttendanceSource';

const paid = JSON.stringify([{ label: '补偿方式', value: '加班费' }]);
const leave = JSON.stringify([{ label: '补偿方式', value: '调休' }]);
function connection(rows: object[]): PoolConnection {
  return { query: async (sql: string) => [sql.includes('hr_settings') ? [{ setting_key: 'payroll_overtime_rule_config', value_json: JSON.stringify({ calculation: 'unit', hourlyRate: 10 }) }] : rows] } as unknown as PoolConnection;
}

test('加班费按原始秒数计算，排除调休及无记录员工', async () => {
  const values = await readPayrollAttendance(connection([
    { employee_id: '1', check_out: 'done', seconds: 61, form_json: paid },
    { employee_id: '1', check_out: null, seconds: null, form_json: leave },
  ]), [{ id: '1', name: '甲' }, { id: '2', name: '乙' }], '2020-01', new Set(['overtimePay']));
  assert.equal(values.get('1')?.overtimePay, 0.17);
  assert.equal(values.get('1')?.overtimeCalculation?.seconds, 61);
  assert.equal(values.get('2')?.overtimePay, 0);
});

test('计费加班未结束或时长无效时阻止计算', async () => {
  const employees = [{ id: '1', name: '甲' }];
  await assert.rejects(readPayrollAttendance(connection([{ employee_id: '1', check_out: null, seconds: null, form_json: paid }]), employees, '2020-01', new Set(['overtimePay'])), /未完成/);
  await assert.rejects(readPayrollAttendance(connection([{ employee_id: '1', check_out: 'done', seconds: -1, form_json: paid }]), employees, '2020-01', new Set(['overtimePay'])), /时长无效/);
});
