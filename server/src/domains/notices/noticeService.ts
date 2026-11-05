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

export async function getNotices(
  employeeId: string,
  params: { category?: string; keyword?: string } = {}
): Promise<Notice[]> {
  const where: string[] = [];
  const args: unknown[] = [employeeId];

  const category = String(params.category || 'all').trim();
  if (category && category !== 'all') {
    where.push('n.category = ?');
    args.push(category);
  }

  const keyword = String(params.keyword || '').trim();
  if (keyword) {
    where.push('(n.title LIKE ? OR n.summary LIKE ?)');
    args.push(`%${keyword}%`, `%${keyword}%`);
  }

  const rows = await queryRows<NoticeRow>(
    `SELECT n.*, CASE WHEN r.employee_id IS NULL THEN 0 ELSE 1 END AS is_read
     FROM notices n
     LEFT JOIN notice_reads r ON r.notice_id = n.id AND r.employee_id = ?
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY n.is_top DESC, n.publish_time DESC`,
    args
  );

  return rows.map(mapNotice);
}

export async function getNoticeDetail(id: string, employeeId: string): Promise<NoticeDetail | null> {
  const exists = await queryOne<{ id: string }>('SELECT id FROM notices WHERE id = ?', [id]);
  if (!exists) return null;

  // 首次阅读：写入回执并把全局已读数 +1（不超过总人数）
  await transaction(async (conn) => {
    const [result] = await conn.query(
      'INSERT IGNORE INTO notice_reads (notice_id, employee_id, read_at) VALUES (?, ?, NOW())',
      [id, employeeId]
    );
    const info = result as { affectedRows?: number };
    if (info.affectedRows) {
      await conn.query(
        'UPDATE notices SET read_count = LEAST(total_count, read_count + 1) WHERE id = ?',
        [id]
      );
    }
  });

  const row = await queryOne<NoticeRow>(
    `SELECT n.*, 1 AS is_read
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
