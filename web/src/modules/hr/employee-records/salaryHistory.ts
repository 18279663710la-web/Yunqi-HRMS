import { formatAttendanceRules } from '../../models-formulas/attendance/attendanceRules';

const labels: Record<string, string> = { number: '合同编号', startDate: '开始日期', endDate: '结束日期', effectiveDate: '生效日期', base: '基本工资', allowance: '固定补贴', performance: '绩效工资', attendanceRules: '出勤率绩效规则', note: '备注' };

export function formatHrHistory(data: Record<string, unknown>, section: 'contract' | 'salary'): string {
  if (section === 'salary' && data.values && typeof data.values === 'object' && !Array.isArray(data.values)) {
    const values = data.values as Record<string, unknown>;
    const parts = Object.entries(values).filter(([, value]) => value !== null && value !== '').map(([key, value]) => `${key}：${value}`);
    if (data.effectiveDate !== undefined && data.effectiveDate !== '') parts.push(`生效日期：${data.effectiveDate}`);
    if (data.attendanceRules !== undefined) parts.push(`出勤率绩效规则：${formatAttendanceRules(data.attendanceRules)}`);
    if (data.note !== undefined && data.note !== '') parts.push(`备注：${data.note}`);
    return parts.join('　·　') || '—';
  }
  return Object.entries(data).filter(([, value]) => value !== null && value !== '').map(([key, value]) => `${labels[key] || key}：${key === 'attendanceRules' ? formatAttendanceRules(value) : value}`).join('　·　') || '—';
}
