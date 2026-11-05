export interface AttendanceRule { minRate: number; maxRate: number; adjustment: number }

const hasTwoDecimals = (value: number) => Math.abs(value * 100 - Math.round(value * 100)) < 0.000001;

export function normalizeAttendanceRules(input: AttendanceRule[] | undefined): AttendanceRule[] {
  const source = Array.isArray(input) ? input : [];
  const full = source.find(rule => rule && rule.minRate === 100 && rule.maxRate === 100);
  const fullAdjustment = full && Number.isFinite(full.adjustment) ? full.adjustment : 0;
  const nonFull = source
    .filter(rule => rule && Number.isFinite(rule.minRate) && Number.isFinite(rule.adjustment) && !(rule.minRate === 100 && rule.maxRate === 100))
    .sort((a, b) => b.minRate - a.minRate);
  const result: AttendanceRule[] = [{ minRate: 100, maxRate: 100, adjustment: fullAdjustment }];
  let previousLower = 100;
  let bottomAdjustment: number | undefined;
  for (const rule of nonFull) {
    if (rule.minRate <= 0) { bottomAdjustment = rule.adjustment; break; }
    if (rule.minRate >= previousLower) continue;
    result.push({ minRate: rule.minRate, maxRate: previousLower, adjustment: rule.adjustment });
    previousLower = rule.minRate;
  }
  result.push({ minRate: 0, maxRate: previousLower, adjustment: bottomAdjustment ?? 0 });
  return result;
}

export function buildAttendanceRules(input: AttendanceRule[] | undefined): AttendanceRule[] {
  const values = Array.isArray(input) ? input : [];
  const lastIndex = values.length - 1;
  return values.map((rule, index) => ({
    minRate: index === 0 ? 100 : index === lastIndex ? 0 : rule.minRate,
    maxRate: index === 0 ? 100 : index === 1 ? 100 : values[index - 1]?.minRate ?? 100,
    adjustment: rule.adjustment,
  }));
}

export function validateAttendanceRules(rules: AttendanceRule[] | undefined): string | undefined {
  if (!rules || rules.length < 2) return '至少保留全勤规则和一条区间规则';
  if (rules.length > 30) return '最多设置 30 条规则';
  for (const rule of rules) {
    if (!rule || [rule.minRate, rule.maxRate, rule.adjustment].some(value => typeof value !== 'number' || !Number.isFinite(value))) return '请完整填写每条规则';
    if (rule.minRate < 0 || rule.maxRate > 100 || !hasTwoDecimals(rule.minRate) || !hasTwoDecimals(rule.maxRate)) return '出勤率须在 0% 到 100% 之间，最多两位小数';
    if (!(rule.minRate < rule.maxRate || (rule.minRate === 100 && rule.maxRate === 100))) return '区间下限须小于上限；100% 全勤可单独设置';
    if (Math.abs(rule.adjustment) > 9999999999.99 || !hasTwoDecimals(rule.adjustment)) return '调整金额无效，最多两位小数';
  }
  if (rules[0].minRate !== 100 || rules[0].maxRate !== 100) return '规则 1 必须为全勤规则';
  for (let index = 1; index < rules.length; index += 1) {
    const previous = rules[index - 1]; const current = rules[index];
    if (current.minRate === 100 && current.maxRate === 100) return '只能设置一条全勤规则';
    if (current.maxRate !== previous.minRate) return `规则 ${index + 1} 的上限必须等于上一条规则的下限`;
    if (index < rules.length - 1 && current.minRate <= 0) return '中间规则的下限必须大于 0';
  }
  if (rules[rules.length - 1].minRate !== 0) return '最后一条规则的下限必须为 0';
  return undefined;
}

export function formatAttendanceRules(input: unknown): string {
  if (!Array.isArray(input) || !input.length) return '未设置';
  return input.map((rule: AttendanceRule) => {
    const range = rule.minRate === 100 && rule.maxRate === 100 ? '100%（全勤）' : `${rule.minRate}% ≤ 出勤率 < ${rule.maxRate}%`;
    const adjustment = rule.adjustment > 0 ? `增加 ${rule.adjustment} 元` : rule.adjustment < 0 ? `扣减 ${Math.abs(rule.adjustment)} 元` : '不增不减';
    return `${range}：${adjustment}`;
  }).join('；');
}
