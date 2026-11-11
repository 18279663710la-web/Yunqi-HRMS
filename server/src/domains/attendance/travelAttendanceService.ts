import type { PoolConnection, RowDataPacket } from 'mysql2/promise';
import { queryRows } from '../../shared/db/pool';

export interface TravelRange { start: string; end: string }

interface TravelApprovalRow {
  applicant_id: string;
  form_json: unknown;
  summary: string | null;
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function validDate(value: string | undefined | null): value is string {
  if (!value || !DATE_PATTERN.test(value)) return false;
  const time = Date.parse(`${value}T00:00:00Z`);
  return !Number.isNaN(time) && new Date(time).toISOString().slice(0, 10) === value;
}

/** 从出差表单中解析起止日期；按字段名匹配，日期缺失时回退摘要中的“开始 至 结束”。 */
export function parseTravelRange(formJson: unknown, summary?: string | null): TravelRange | null {
  let form: unknown = formJson;
  if (typeof form === 'string') {
    try { form = JSON.parse(form); } catch { form = null; }
  }
  if (Array.isArray(form)) {
    const pick = (label: string): string | undefined => {
      const matches = form.filter((item): item is { label: string; value: string } =>
        !!item && typeof item === 'object' && (item as { label?: unknown }).label === label && typeof (item as { value?: unknown }).value === 'string')
        .map((item) => (item as { value: string }).value.trim());
      return matches.length === 1 ? matches[0] : undefined;
    };
    const start = pick('开始日期');
    const end = pick('结束日期');
    if (validDate(start) && validDate(end) && start <= end) return { start, end };
  }
  const text = typeof summary === 'string' ? summary : '';
  const match = /(\d{4}-\d{2}-\d{2})\s*至\s*(\d{4}-\d{2}-\d{2})/.exec(text);
  if (match && validDate(match[1]) && validDate(match[2]) && match[1] <= match[2]) {
    return { start: match[1], end: match[2] };
  }
  return null;
}

function overlaps(range: TravelRange, from: string, to: string): boolean {
  return range.start <= to && range.end >= from;
}

function expandRange(range: TravelRange, from: string, to: string): Set<string> {
  const result = new Set<string>();
  const DAY_MS = 86400000;
  let start = Date.parse(`${range.start}T00:00:00Z`);
  const end = Date.parse(`${range.end}T00:00:00Z`);
  const fromTime = Date.parse(`${from}T00:00:00Z`);
  const toTime = Date.parse(`${to}T00:00:00Z`);
  if (start < fromTime) start = fromTime;
  // 保护性上限：异常区间最多展开 3660 天。
  for (let time = start; time <= end && time <= toTime && (time - fromTime) / DAY_MS <= 3660; time += DAY_MS) {
    result.add(new Date(time).toISOString().slice(0, 10));
  }
  return result;
}

function mapTravelRows(rows: TravelApprovalRow[], from: string, to: string): Map<string, Set<string>> {
  const result = new Map<string, Set<string>>();
  for (const row of rows) {
    const range = parseTravelRange(row.form_json, row.summary);
    if (!range || !overlaps(range, from, to)) continue;
    const employeeId = String(row.applicant_id);
    const dates = result.get(employeeId) ?? new Set<string>();
    for (const date of expandRange(range, from, to)) dates.add(date);
    result.set(employeeId, dates);
  }
  return result;
}

/** 查询员工在日期范围内已通过的出差审批，展开为每人每天的出差日期集合。 */
export async function getTravelDateMapForEmployees(
  employeeIds: string[],
  from: string,
  to: string,
  conn?: PoolConnection
): Promise<Map<string, Set<string>>> {
  const unique = Array.from(new Set(employeeIds));
  if (!unique.length) return new Map();
  const placeholders = unique.map(() => '?').join(',');
  const sql = `SELECT applicant_id, form_json, summary FROM approvals
     WHERE type = 'travel' AND status = 'approved' AND applicant_id IN (${placeholders})`;
  const rows = conn
    ? (await conn.query<RowDataPacket[]>(sql, unique))[0] as unknown as TravelApprovalRow[]
    : await queryRows<TravelApprovalRow>(sql, unique);
  return mapTravelRows(rows, from, to);
}

export async function getTravelDatesForEmployee(
  employeeId: string,
  from: string,
  to: string,
  conn?: PoolConnection
): Promise<Set<string>> {
  const map = await getTravelDateMapForEmployees([employeeId], from, to, conn);
  return map.get(employeeId) ?? new Set();
}
