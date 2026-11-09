import type { WorkflowTestCase, WorkflowTestField } from './api';

function initialValue(field: WorkflowTestField): string {
  if (field.type === 'picker') return field.options?.[0] ?? '';
  if (field.type === 'date') return '2026-01-01';
  if (field.type === 'time') return field.default || (field.key.toLowerCase().includes('end') ? '18:00' : '09:00');
  if (field.type === 'number' || field.type === 'money') return '1';
  return field.required ? '测试' : '';
}

export function createWorkflowTestCase(fields: WorkflowTestField[], number: number): WorkflowTestCase {
  const suffix = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return { id: suffix, name: `用例 ${number}`, values: Object.fromEntries(fields.map(field => [field.key, initialValue(field)])) };
}

export function reconcileWorkflowCases(cases: WorkflowTestCase[], fields: WorkflowTestField[]): WorkflowTestCase[] {
  if (!cases.length) return [createWorkflowTestCase(fields, 1)];
  return cases.map(item => ({ ...item, values: Object.fromEntries(fields.map(field => {
    const previous = item.values[field.key];
    const value = previous === undefined ? initialValue(field) : field.type === 'picker' && previous && !field.options?.includes(previous) ? '' : previous;
    return [field.key, value];
  })) }));
}

export function withDerivedTestValues(type: string, values: Record<string, string>): Record<string, string> {
  if (type !== 'leave') return values;
  const parse = (date: string, time: string): number | null => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)) return null;
    const [year, month, day] = date.split('-').map(Number);
    const [hour, minute] = time.split(':').map(Number);
    const stamp = Date.UTC(year, month - 1, day, hour, minute);
    const parsed = new Date(stamp);
    return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day ? stamp : null;
  };
  const start = parse(values.startDate || '', values.startClock || '');
  const end = parse(values.endDate || '', values.endClock || '');
  return { ...values, days: start === null || end === null || end <= start ? '' : String(Math.max(1, Math.round((end - start) / 86400000))) };
}
