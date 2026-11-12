import { randomUUID } from 'node:crypto';
import type { ResultSetHeader, RowDataPacket } from 'mysql2';
import { queryOne, queryRows, transaction } from '../../shared/db/pool';
import { pad } from '../../shared/utils/datetime';
import { badRequest, notFound } from '../../shared/utils/errors';

const MAX_PHOTOS = 3;
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const ALLOWED_PHOTO_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

export interface VisitPhotoRef {
  id: string;
  name: string;
  size: number;
}

export interface VisitRecord {
  id: number;
  employeeId: string;
  employeeName: string;
  employeeNo: string;
  position: string;
  visitTime: string;
  customerName: string;
  purpose: string;
  addressName: string;
  address: string;
  latitude: number;
  longitude: number;
  accuracy: number | null;
  remark: string;
  photoCount: number;
  photoIds: string[];
}

export interface VisitInput {
  customerName: string;
  purpose: string;
  addressName?: string;
  address: string;
  latitude: number;
  longitude: number;
  accuracy?: number;
  remark?: string;
  photoIds: string[];
}

export interface VisitQuery {
  month?: string;
  employeeId?: string;
  keyword?: string;
  page?: number;
  pageSize?: number;
}

export interface VisitPage {
  month: string;
  startDate: string;
  endDate: string;
  page: number;
  pageSize: number;
  total: number;
  list: VisitRecord[];
}

interface VisitRow extends RowDataPacket {
  id: number;
  employee_id: string;
  employee_name: string | null;
  employee_no: string | null;
  position: string | null;
  visit_time: string;
  customer_name: string;
  purpose: string;
  address_name: string;
  address: string;
  latitude: number;
  longitude: number;
  accuracy: number | null;
  remark: string;
  photo_count: number;
}

const VISIT_SELECT = `
  SELECT v.id, v.employee_id, e.name AS employee_name, e.employee_no, e.position,
         v.visit_time, v.customer_name, v.purpose, v.address_name, v.address,
         v.latitude, v.longitude, v.accuracy, v.remark, v.photo_count
  FROM attendance_visits v
  LEFT JOIN employees e ON e.id = v.employee_id`;

function currentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;
}

function resolveMonth(month?: string): { month: string; start: string; end: string; startDate: string; endDate: string } {
  const value = month && /^\d{4}-(0[1-9]|1[0-2])$/.test(month) ? month : currentMonth();
  const [year, monthNumber] = value.split('-').map(Number);
  const next = monthNumber === 12
    ? `${year + 1}-01`
    : `${year}-${String(monthNumber + 1).padStart(2, '0')}`;
  const lastDay = new Date(year, monthNumber, 0).getDate();
  return {
    month: value,
    start: `${value}-01 00:00:00`,
    end: `${next}-01 00:00:00`,
    startDate: `${value}-01`,
    endDate: `${value}-${pad(lastDay)}`,
  };
}

function mapVisit(row: VisitRow, photoIds: string[]): VisitRecord {
  return {
    id: Number(row.id),
    employeeId: row.employee_id,
    employeeName: row.employee_name || '',
    employeeNo: row.employee_no || '',
    position: row.position || '',
    visitTime: row.visit_time,
    customerName: row.customer_name,
    purpose: row.purpose,
    addressName: row.address_name,
    address: row.address,
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
    accuracy: row.accuracy === null ? null : Number(row.accuracy),
    remark: row.remark,
    photoCount: Number(row.photo_count),
    photoIds,
  };
}

async function photoIdsByVisit(visitIds: number[]): Promise<Map<number, string[]>> {
  const result = new Map<number, string[]>();
  if (!visitIds.length) return result;
  const rows = await queryRows<{ id: string; visit_id: number }>(
    'SELECT id, visit_id FROM attendance_visit_photos WHERE visit_id IN (?) ORDER BY created_at, id',
    [visitIds]
  );
  for (const row of rows) {
    const key = Number(row.visit_id);
    const list = result.get(key) || [];
    list.push(row.id);
    result.set(key, list);
  }
  return result;
}

function sanitizeFileName(value: string): string {
  const name = String(value || '').replace(/[\\/\x00-\x1f\x7f]/g, '_').trim().slice(0, 255);
  return name || 'photo';
}

/** 以文件头识别图片类型，兼容小程序上传时缺失或错误的 MIME。 */
function detectImageMime(buffer: Buffer): string | null {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buffer.length >= 6) {
    const header = buffer.subarray(0, 6).toString('ascii');
    if (header === 'GIF87a' || header === 'GIF89a') return 'image/gif';
  }
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  return null;
}

/** 上传现场照片，先保存为未归属照片，提交拜访时再绑定。 */
export async function saveVisitPhoto(employeeId: string, file: Express.Multer.File | undefined): Promise<VisitPhotoRef> {
  if (!file || !file.buffer.length) throw badRequest('请选择现场照片');
  if (file.size > MAX_PHOTO_BYTES) throw badRequest('单张现场照片不能超过 5MB');
  const mimeType = detectImageMime(file.buffer);
  if (!mimeType || !ALLOWED_PHOTO_TYPES.has(mimeType)) throw badRequest('现场照片仅支持 JPG、PNG、WebP 或 GIF');
  const id = randomUUID();
  const name = sanitizeFileName(file.originalname);
  await transaction(async (conn) => {
    await conn.query(
      'DELETE FROM attendance_visit_photos WHERE employee_id = ? AND visit_id IS NULL AND created_at < DATE_SUB(NOW(), INTERVAL 1 DAY)',
      [employeeId]
    );
    await conn.execute(
      `INSERT INTO attendance_visit_photos (id, employee_id, visit_id, file_name, mime_type, file_size, file_data, created_at)
       VALUES (?, ?, NULL, ?, ?, ?, ?, NOW())`,
      [id, employeeId, name, mimeType, file.size, file.buffer]
    );
  });
  return { id, name, size: file.size };
}

export async function createVisit(employeeId: string, input: VisitInput): Promise<VisitRecord> {
  const photoIds = Array.from(new Set(input.photoIds.map((id) => String(id).trim()).filter(Boolean)));
  if (!photoIds.length) throw badRequest('请上传至少 1 张现场照片');
  if (photoIds.length > MAX_PHOTOS) throw badRequest(`现场照片最多 ${MAX_PHOTOS} 张`);
  const customerName = input.customerName.trim();
  const purpose = input.purpose.trim();
  const addressName = (input.addressName || '').trim();
  const address = input.address.trim();
  const remark = (input.remark || '').trim();
  if (!customerName) throw badRequest('请填写客户名称');
  if (!purpose) throw badRequest('请填写拜访目的');
  if (!address) throw badRequest('请获取拜访地点');
  if (!Number.isFinite(input.latitude) || !Number.isFinite(input.longitude) ||
      input.latitude < -90 || input.latitude > 90 || input.longitude < -180 || input.longitude > 180) {
    throw badRequest('拜访地点无效，请重新定位');
  }

  return transaction(async (conn) => {
    const [photos] = await conn.query<RowDataPacket[]>(
      'SELECT id FROM attendance_visit_photos WHERE employee_id = ? AND visit_id IS NULL AND id IN (?) FOR UPDATE',
      [employeeId, photoIds]
    );
    if (photos.length !== photoIds.length) throw badRequest('现场照片无效，请重新上传');

    const [result] = await conn.execute<ResultSetHeader>(
      `INSERT INTO attendance_visits
        (employee_id, visit_time, customer_name, purpose, address_name, address, latitude, longitude, accuracy, remark, photo_count, created_at)
       VALUES (?, NOW(), ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [employeeId, customerName, purpose, addressName, address, input.latitude, input.longitude,
        Number.isFinite(input.accuracy) ? Math.round(Number(input.accuracy)) : null, remark, photoIds.length]
    );
    const visitId = result.insertId;
    await conn.query(
      'UPDATE attendance_visit_photos SET visit_id = ? WHERE employee_id = ? AND visit_id IS NULL AND id IN (?)',
      [visitId, employeeId, photoIds]
    );
    const [rows] = await conn.query<VisitRow[]>(
      `${VISIT_SELECT} WHERE v.id = ? LIMIT 1`,
      [visitId]
    );
    return mapVisit(rows[0], photoIds);
  });
}

export async function listMyVisits(employeeId: string, month?: string, limit = 20): Promise<{ month: string; list: VisitRecord[] }> {
  const range = resolveMonth(month);
  const safeLimit = Math.min(Math.max(Math.trunc(limit) || 20, 1), 100);
  const rows = await queryRows<VisitRow>(
    `${VISIT_SELECT} WHERE v.employee_id = ? AND v.visit_time >= ? AND v.visit_time < ? ORDER BY v.visit_time DESC, v.id DESC LIMIT ${safeLimit}`,
    [employeeId, range.start, range.end]
  );
  const photos = await photoIdsByVisit(rows.map((row) => Number(row.id)));
  return { month: range.month, list: rows.map((row) => mapVisit(row, photos.get(Number(row.id)) || [])) };
}

export async function listAdminVisits(query: VisitQuery): Promise<VisitPage> {
  const range = resolveMonth(query.month);
  const page = Math.max(Math.trunc(Number(query.page)) || 1, 1);
  const pageSize = Math.min(Math.max(Math.trunc(Number(query.pageSize)) || 20, 1), 5000);
  const where = ['v.visit_time >= ?', 'v.visit_time < ?'];
  const params: unknown[] = [range.start, range.end];
  if (query.employeeId) {
    where.push('v.employee_id = ?');
    params.push(query.employeeId);
  }
  const keyword = (query.keyword || '').trim();
  if (keyword) {
    const like = `%${keyword.replace(/[%_]/g, (value) => `\\${value}`)}%`;
    where.push('(v.customer_name LIKE ? OR v.purpose LIKE ? OR v.address LIKE ? OR v.address_name LIKE ?)');
    params.push(like, like, like, like);
  }
  const whereSql = where.join(' AND ');
  const totalRow = await queryOne<{ total: number }>(
    `SELECT COUNT(*) AS total FROM attendance_visits v WHERE ${whereSql}`,
    params
  );
  const rows = await queryRows<VisitRow>(
    `${VISIT_SELECT} WHERE ${whereSql} ORDER BY v.visit_time DESC, v.id DESC LIMIT ? OFFSET ?`,
    [...params, pageSize, (page - 1) * pageSize]
  );
  const photos = await photoIdsByVisit(rows.map((row) => Number(row.id)));
  return {
    month: range.month,
    startDate: range.startDate,
    endDate: range.endDate,
    page,
    pageSize,
    total: Number(totalRow?.total || 0),
    list: rows.map((row) => mapVisit(row, photos.get(Number(row.id)) || [])),
  };
}

export async function getVisitPhoto(id: string, employeeId?: string): Promise<{ fileName: string; mimeType: string; data: Buffer }> {
  const row = await queryOne<{ file_name: string; mime_type: string; file_data: Buffer }>(
    `SELECT file_name, mime_type, file_data FROM attendance_visit_photos WHERE id = ?${employeeId ? ' AND employee_id = ?' : ''}`,
    employeeId ? [id, employeeId] : [id]
  );
  if (!row) throw notFound('现场照片不存在');
  return { fileName: row.file_name, mimeType: row.mime_type, data: row.file_data };
}
