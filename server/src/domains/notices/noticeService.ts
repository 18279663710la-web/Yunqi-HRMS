import { queryOne, queryRows, transaction } from '../../shared/db/pool';
import type {
  Notice,
  NoticeAttachment,
  NoticeBlock,
  NoticeCategory,
  NoticeDetail,
} from '../../shared/types/models';
import { toMinuteText } from '../../shared/utils/datetime';

interface NoticeRow {
  id: string;
  title: string;
  category: string;
  category_name: string;
  is_top: number;
  publish_time: string;
  publisher: string;
  publisher_dept: string;
  banner: string;
  summary: string;
  read_count: number;
  total_count: number;
  blocks_json: string | NoticeBlock[];
  attachments_json: string | NoticeAttachment[];
  is_read?: number;
}

const CATEGORIES: NoticeCategory[] = [
  { key: 'all', name: '全部' },
  { key: 'company', name: '公司公告' },
  { key: 'hr', name: '人事行政' },
  { key: 'it', name: '技术规范' },
  { key: 'activity', name: '活动通知' },
];

function parseArray<T>(value: string | T[] | null | undefined): T[] {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string' && value) {
    try {
      const parsed = JSON.parse(value) as unknown;
      return Array.isArray(parsed) ? (parsed as T[]) : [];
    } catch {
      return [];
    }
  }
  return [];
}

function mapNotice(row: NoticeRow): Notice {
  const publishTime = toMinuteText(row.publish_time);
  return {
    id: row.id,
    title: row.title,
    category: row.category,
    categoryName: row.category_name,
    isTop: !!row.is_top,
    isRead: !!row.is_read,
    publishTime,
    publisher: row.publisher,
    publisherDept: row.publisher_dept,
    banner: row.banner,
    summary: row.summary,
    readCount: Number(row.read_count) || 0,
    totalCount: Number(row.total_count) || 0,
    blocks: parseArray<NoticeBlock>(row.blocks_json),
    attachments: parseArray<NoticeAttachment>(row.attachments_json),
    timeText: publishTime,
    readPercent: row.total_count ? Math.round((Number(row.read_count) / Number(row.total_count)) * 100) : 0,
  };
}

export function getNoticeCategories(): NoticeCategory[] {
  return CATEGORIES.map((c) => ({ ...c }));
}

/** 在职员工口径：员工主档存在且未离职（待复职期间仍算离职） */
const ACTIVE_EMPLOYEE_TOTAL_SQL =
  "(SELECT COUNT(*) FROM employees e2 WHERE NOT EXISTS(SELECT 1 FROM hr_employee_departures d2 WHERE d2.employee_id = e2.id AND d2.status = 'departed'))";

function activeReadCountSql(): string {
  return `(SELECT COUNT(DISTINCT r2.employee_id) FROM notice_reads r2
     JOIN employees er ON er.id = r2.employee_id
     WHERE r2.notice_id = n.id
       AND NOT EXISTS(SELECT 1 FROM hr_employee_departures d2 WHERE d2.employee_id = er.id AND d2.status = 'departed'))`;
}

function noticeWhere(params: { category?: string; keyword?: string }): { whereSql: string; whereArgs: unknown[] } {
  const where: string[] = [];
  const whereArgs: unknown[] = [];
  const category = String(params.category || 'all').trim();
  if (category && category !== 'all') {
    where.push('n.category = ?');
    whereArgs.push(category);
  }
  const keyword = String(params.keyword || '').trim();
  if (keyword) {
    where.push('(n.title LIKE ? OR n.summary LIKE ?)');
    whereArgs.push(`%${keyword}%`, `%${keyword}%`);
  }
  return { whereSql: where.length ? `WHERE ${where.join(' AND ')}` : '', whereArgs };
}

function listSelectSql(employeeId: string, whereSql: string): string {
  return `SELECT n.*,
     CASE WHEN r.employee_id IS NULL THEN 0 ELSE 1 END AS is_read,
     ${activeReadCountSql()} AS read_count,
     ${ACTIVE_EMPLOYEE_TOTAL_SQL} AS total_count
   FROM notices n
   LEFT JOIN notice_reads r ON r.notice_id = n.id AND r.employee_id = ?
   ${whereSql}
   ORDER BY n.is_top DESC, n.publish_time DESC, n.id DESC`;
}

export async function getNotices(
  employeeId: string,
  params: { category?: string; keyword?: string } = {}
): Promise<Notice[]> {
  const { whereSql, whereArgs } = noticeWhere(params);
  const rows = await queryRows<NoticeRow>(listSelectSql(employeeId, whereSql), [employeeId, ...whereArgs]);
  return rows.map(mapNotice);
}

export interface NoticePageParams {
  category?: string;
  keyword?: string;
  page: number;
  pageSize: number;
}

/** 分页列表（小程序公告页触底加载） */
export async function getNoticesPage(employeeId: string, params: NoticePageParams) {
  const { whereSql, whereArgs } = noticeWhere(params);
  const pageSize = Math.min(50, Math.max(1, Math.trunc(params.pageSize) || 10));
  const page = Math.max(1, Math.trunc(params.page) || 1);
  const [totalRow, rows] = await Promise.all([
    queryOne<{ total: number }>(
      `SELECT COUNT(*) AS total FROM notices n ${whereSql}`,
      whereArgs
    ),
    queryRows<NoticeRow>(
      `${listSelectSql(employeeId, whereSql)} LIMIT ? OFFSET ?`,
      [employeeId, ...whereArgs, pageSize, (page - 1) * pageSize]
    ),
  ]);
  const total = Number(totalRow?.total) || 0;
  return {
    items: rows.map(mapNotice),
    total,
    page,
    pageSize,
    hasMore: page * pageSize < total,
  };
}

export async function getNoticeDetail(id: string, employeeId: string): Promise<NoticeDetail | null> {
  const exists = await queryOne<{ id: string }>('SELECT id FROM notices WHERE id = ?', [id]);
  if (!exists) return null;

  // 首次阅读：写入回执并把全局已读数 +1（不超过总人数）；同时把总人数刷新为当前在职员工数
  await transaction(async (conn) => {
    const [result] = await conn.query(
      'INSERT IGNORE INTO notice_reads (notice_id, employee_id, read_at) VALUES (?, ?, NOW())',
      [id, employeeId]
    );
    const info = result as { affectedRows?: number };
    if (info.affectedRows) {
      await conn.query(
        `UPDATE notices SET read_count = LEAST(total_count, read_count + 1), total_count = ${ACTIVE_EMPLOYEE_TOTAL_SQL} WHERE id = ?`,
        [id]
      );
    }
  });

  const row = await queryOne<NoticeRow>(
    `SELECT n.*, 1 AS is_read,
     ${activeReadCountSql()} AS read_count,
     ${ACTIVE_EMPLOYEE_TOTAL_SQL} AS total_count
     FROM notices n
     WHERE n.id = ?`,
    [id]
  );
  if (!row) return null;

  const notice = mapNotice(row);
  return {
    ...notice,
    isRead: true,
    dateText: notice.publishTime.slice(0, 10),
  };
}

export async function getUnreadNoticeCount(employeeId: string): Promise<number> {
  const row = await queryOne<{ total: number }>(
    `SELECT COUNT(*) AS total
     FROM notices n
     LEFT JOIN notice_reads r ON r.notice_id = n.id AND r.employee_id = ?
     WHERE r.notice_id IS NULL`,
    [employeeId]
  );
  return Number(row?.total || 0);
}
