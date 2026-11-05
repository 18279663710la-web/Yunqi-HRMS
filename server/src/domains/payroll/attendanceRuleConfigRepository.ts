import { queryOne, transaction } from '../../shared/db/pool';
import { attendanceRuleConfigSchema, type AttendanceRuleConfig } from './attendanceRuleConfig';

export const ATTENDANCE_RULE_CONFIG_KEY = 'payroll_attendance_rule_config';
const LEGACY_RULES_KEY = 'payroll_attendance_rules';

export async function readAttendanceRuleConfig(): Promise<AttendanceRuleConfig | null> {
  const row = await queryOne<{ value_json: unknown }>('SELECT value_json FROM hr_settings WHERE setting_key = ?', [ATTENDANCE_RULE_CONFIG_KEY]);
  if (!row) return null;
  return attendanceRuleConfigSchema.parse(typeof row.value_json === 'string' ? JSON.parse(row.value_json) : row.value_json);
}

export async function saveAttendanceRuleConfig(config: AttendanceRuleConfig): Promise<void> {
  const sql = 'INSERT INTO hr_settings (setting_key, value_json, updated_at) VALUES (?, ?, NOW()) ON DUPLICATE KEY UPDATE value_json = VALUES(value_json), updated_at = NOW()';
  await transaction(async conn => {
    await conn.execute(sql, [ATTENDANCE_RULE_CONFIG_KEY, JSON.stringify(config)]);
    if (config.mode === 'rate_attendance') await conn.execute(sql, [LEGACY_RULES_KEY, JSON.stringify(config.rules)]);
  });
}
