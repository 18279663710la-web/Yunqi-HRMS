import type { PoolConnection, RowDataPacket } from 'mysql2/promise';
import { queryRows, transaction } from '../../shared/db/pool';
import { defaultOvertimeRules, overtimeRuleConfigKey, overtimeRuleConfigSchema, overtimeRulesKey, overtimeRulesSchema, type OvertimeRuleConfig } from './overtimePayrollService';

export const OVERTIME_RULE_CONFIG_KEY = overtimeRuleConfigKey;
const decode = (value: unknown) => typeof value === 'string' ? JSON.parse(value) : value;

export async function readOvertimeRuleConfig(conn?: PoolConnection): Promise<OvertimeRuleConfig> {
  const sql = 'SELECT setting_key, value_json FROM hr_settings WHERE setting_key IN (?, ?)';
  const params = [OVERTIME_RULE_CONFIG_KEY, overtimeRulesKey];
  const rows = conn ? (await conn.query<RowDataPacket[]>(sql, params))[0] : await queryRows<{ setting_key: string; value_json: unknown }>(sql, params);
  const config = rows.find(row => row.setting_key === OVERTIME_RULE_CONFIG_KEY);
  if (config) return overtimeRuleConfigSchema.parse(decode(config.value_json));
  const legacy = rows.find(row => row.setting_key === overtimeRulesKey);
  return { calculation: 'range', rules: legacy ? overtimeRulesSchema.parse(decode(legacy.value_json)) : defaultOvertimeRules };
}

export async function saveOvertimeRuleConfig(config: OvertimeRuleConfig): Promise<void> {
  const sql = 'INSERT INTO hr_settings (setting_key, value_json, updated_at) VALUES (?, ?, NOW()) ON DUPLICATE KEY UPDATE value_json = VALUES(value_json), updated_at = NOW()';
  await transaction(async conn => {
    await conn.execute(sql, [OVERTIME_RULE_CONFIG_KEY, JSON.stringify(config)]);
    if (config.calculation === 'range') await conn.execute(sql, [overtimeRulesKey, JSON.stringify(config.rules)]);
  });
}
