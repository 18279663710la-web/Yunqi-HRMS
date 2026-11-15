import fs from 'node:fs';
import path from 'node:path';

import { config } from '../../config';
import { execute, queryOne, queryRows, transaction } from '../../shared/db/pool';
import type { NoticeAttachment, NoticeBlock } from '../../shared/types/models';
import { badRequest, notFound } from '../../shared/utils/errors';
import { toMinuteText } from '../../shared/utils/datetime';

export interface NoticeAdminInput {
  title: string;
  category: string;
  categoryName: string;
  isTop: boolean;
  publishTime: string;
  publisherDept: string;
  summary: string;
  blocks: NoticeBlock[];
  attachments: NoticeAttachment[];
}

export interface NoticeReadStats {
  readCount: number;
  totalCount: number;
  readPercent: number;
  readers: Array<{ employeeId: string; name: string; department: string; readAt: string }>;
}

/** 分类对应卡片渐变（展示样式随分类固定分配） */
const CATEGORY_BANNERS: Record<string, string> = {
  company: 'linear-gradient(135deg, #3D6EF7, #7A5AF8)',
  hr: 'linear-gradient(135deg, #0BA5EC, #3D6EF7)',
  it: 'linear-gradient(135deg, #16B364, #0BA5EC)',
  activity: 'linear-gradient(135deg, #F04438, #FDB022)',
};

/** 在职员工口径：员工主档存在且未离职（含待复职，离职状态未恢复即不在职） */
const ACTIVE_EMPLOYEE_TOTAL_SQL =
  '(SELECT COUNT(*) FROM employees e2 WHERE NOT EXISTS(SELECT 1 FROM hr_employee_departures d2 WHERE d2.employee_id = e2.id AND d2.status = \'departed\'))';

function activeReadCountSql(): string {
  return `(SELECT COUNT(DISTINCT r2.employee_id) FROM notice_reads r2
     JOIN employees er ON er.id = r2.employee_id
     WHERE r2.notice_id = n.id
       AND NOT EXISTS(SELECT 1 FROM hr_employee_departures d2 WHERE d2.employee_id = er.id AND d2.status = 'departed'))`;
}

function newNoticeId(): string {
  return `N${Date.now()}${Math.floor(Math.random() * 90 + 10)}`;
}

function bannerOf(category: string): string {
  return CATEGORY_BANNERS[category] || CATEGORY_BANNERS.company;
}

export function noticeAttachmentDir(): string {
  return path.join(config.uploadDir, 'notice');
}

function humanSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${bytes}B`;
}

interface AdminNoticeRow {
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
}

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

function mapAdminNotice(row: AdminNoticeRow, readStats: NoticeReadStats) {
  return {
    id: row.id,
    title: row.title,
    category: row.category,
    categoryName: row.category_name,
    isTop: !!row.is_top,
    publishTime: toMinuteText(row.publish_time),
    publisher: row.publisher,
    publisherDept: row.publisher_dept,
    banner: row.banner,
    summary: row.summary,
    blocks: parseArray<NoticeBlock>(row.blocks_json),
    attachments: parseArray<NoticeAttachment>(row.attachments_json),
    readStats,
  };
}

/** 已读回执（在职员工口径）+ 已读名单 */
async function readStatsOf(noticeId: string): Promise<NoticeReadStats> {
  const stats = await queryOne<{ read_count: number; total_count: number }>(
    `SELECT ${activeReadCountSql()} AS read_count, ${ACTIVE_EMPLOYEE_TOTAL_SQL} AS total_count
     FROM notices n WHERE n.id = ?`,
    [noticeId]
  );
  const readers = await queryRows<{ employee_id: string; name: string; department: string; read_at: string }>(
    `SELECT r.employee_id, e.name, COALESCE(dep.name, '-') AS department, DATE_FORMAT(r.read_at, '%Y-%m-%d %H:%i') AS read_at
     FROM notice_reads r
     JOIN employees e ON e.id = r.employee_id
     LEFT JOIN departments dep ON dep.id = e.dept_id
     WHERE r.notice_id = ?
       AND NOT EXISTS(SELECT 1 FROM hr_employee_departures d WHERE d.employee_id = r.employee_id AND d.status = 'departed')
     ORDER BY r.read_at DESC`,
    [noticeId]
  );
  const readCount = Number(stats?.read_count) || 0;
  const totalCount = Number(stats?.total_count) || 0;
  return {
    readCount,
    totalCount,
    readPercent: totalCount ? Math.round((readCount / totalCount) * 100) : 0,
    readers: readers.map((r) => ({
      employeeId: String(r.employee_id),
      name: String(r.name),
      department: String(r.department),
      readAt: String(r.read_at),
    })),
  };
}

export interface AdminNoticeListParams {
  keyword?: string;
  category?: string;
  page: number;
  pageSize: number;
}

export async function listAdminNotices(params: AdminNoticeListParams) {
  const where: string[] = [];
  const args: unknown[] = [];
  const keyword = String(params.keyword || '').trim();
  if (keyword) {
    where.push('(n.title LIKE ? OR n.summary LIKE ?)');
    args.push(`%${keyword}%`, `%${keyword}%`);
  }
  const category = String(params.category || '').trim();
  if (category && category !== 'all') {
    where.push('n.category = ?');
    args.push(category);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const pageSize = Math.min(50, Math.max(1, Math.trunc(params.pageSize) || 10));
  const page = Math.max(1, Math.trunc(params.page) || 1);

  const [totalRow, rows] = await Promise.all([
    queryOne<{ total: number }>(`SELECT COUNT(*) AS total FROM notices n ${whereSql}`, args),
    queryRows<AdminNoticeRow>(
      `SELECT n.*, ${activeReadCountSql()} AS read_count, ${ACTIVE_EMPLOYEE_TOTAL_SQL} AS total_count
       FROM notices n ${whereSql}
       ORDER BY n.is_top DESC, n.publish_time DESC, n.id DESC
       LIMIT ? OFFSET ?`,
      [...args, pageSize, (page - 1) * pageSize]
    ),
  ]);
  const total = Number(totalRow?.total) || 0;
  const list = [];
  for (const row of rows) {
    list.push(mapAdminNotice(row, await readStatsOf(row.id)));
  }
  return { list, total, page, pageSize, hasMore: page * pageSize < total };
}

export async function getAdminNotice(id: string) {
  const row = await queryOne<AdminNoticeRow>(
    `SELECT n.*, ${activeReadCountSql()} AS read_count, ${ACTIVE_EMPLOYEE_TOTAL_SQL} AS total_count
     FROM notices n WHERE n.id = ?`,
    [id]
  );
  if (!row) throw notFound('公告不存在');
  return mapAdminNotice(row, await readStatsOf(id));
}

export async function createNotice(input: NoticeAdminInput, publisher: string) {
  const id = newNoticeId();
  await execute(
    `INSERT INTO notices
      (id, title, category, category_name, is_top, publish_time, publisher, publisher_dept, banner,
       summary, read_count, total_count, blocks_json, attachments_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ${ACTIVE_EMPLOYEE_TOTAL_SQL}, ?, ?)`,
    [
      id, input.title, input.category, input.categoryName, input.isTop ? 1 : 0,
      input.publishTime, publisher, input.publisherDept, bannerOf(input.category),
      input.summary, JSON.stringify(input.blocks), JSON.stringify(input.attachments),
    ]
  );
  return getAdminNotice(id);
}

export async function updateNotice(id: string, input: NoticeAdminInput) {
  const exists = await queryOne<{ id: string }>('SELECT id FROM notices WHERE id = ?', [id]);
  if (!exists) throw notFound('公告不存在');
  await execute(
    `UPDATE notices SET title=?, category=?, category_name=?, is_top=?, publish_time=?,
       publisher_dept=?, banner=?, summary=?, blocks_json=?, attachments_json=?,
       total_count=${ACTIVE_EMPLOYEE_TOTAL_SQL}
     WHERE id=?`,
    [
      input.title, input.category, input.categoryName, input.isTop ? 1 : 0,
      input.publishTime, input.publisherDept, bannerOf(input.category), input.summary,
      JSON.stringify(input.blocks), JSON.stringify(input.attachments), id,
    ]
  );
  return getAdminNotice(id);
}

/** 删除公告：级联清理阅读回执与附件文件 */
export async function deleteNotice(id: string) {
  const row = await queryOne<{ attachments_json: string | NoticeAttachment[] }>(
    'SELECT attachments_json FROM notices WHERE id = ?',
    [id]
  );
  if (!row) throw notFound('公告不存在');
  await transaction(async (conn) => {
    await conn.query('DELETE FROM notice_reads WHERE notice_id = ?', [id]);
    await conn.query('DELETE FROM notices WHERE id = ?', [id]);
  });
  for (const att of parseArray<NoticeAttachment>(row.attachments_json)) {
    if (!att.fileID || !att.fileID.startsWith('/notice-files/')) continue;
    const name = path.basename(att.fileID);
    if (!/^[A-Za-z0-9._-]+$/.test(name)) continue;
    try {
      fs.unlinkSync(path.join(noticeAttachmentDir(), name));
    } catch {
      // 文件缺失不阻断删除
    }
  }
  return { ok: true };
}

/** 保存上传的公告附件（仅登记目录与文件名，元数据由调用方写入公告 attachments_json） */
export function storeNoticeAttachmentFile(originalName: string, storedName: string): NoticeAttachment {
  const ext = (path.extname(originalName) || '').replace('.', '').toLowerCase();
  const full = path.join(noticeAttachmentDir(), storedName);
  let size = '';
  try {
    size = humanSize(fs.statSync(full).size);
  } catch {
    size = '';
  }
  return {
    name: path.basename(originalName),
    size,
    ext: ext || 'file',
    fileID: `/notice-files/${storedName}`,
  };
}

/** 员工下载附件：校验文件名确属某公告附件后回源文件 */
export async function resolveNoticeAttachment(storedName: string): Promise<{ filePath: string; downloadName: string } | null> {
  if (!/^[A-Za-z0-9._-]+$/.test(storedName)) return null;
  const fileID = `/notice-files/${storedName}`;
  // JSON 列的字符串化格式带空格，须用 JSON_SEARCH 按值匹配而非 LIKE
  const row = await queryOne<{ id: string; attachments_json: string | NoticeAttachment[] }>(
    'SELECT id, attachments_json FROM notices WHERE JSON_SEARCH(attachments_json, \'one\', ?) IS NOT NULL LIMIT 1',
    [fileID]
  );
  if (!row) return null;
  const match = parseArray<NoticeAttachment>(row.attachments_json).find((a) => a.fileID === fileID);
  if (!match) return null;
  const filePath = path.join(noticeAttachmentDir(), storedName);
  if (!fs.existsSync(filePath)) return null;
  return { filePath, downloadName: match.name || storedName };
}
