import { randomUUID } from 'node:crypto';
import type { PoolConnection } from 'mysql2/promise';
import type { RowDataPacket } from 'mysql2';
import { transaction, queryOne } from '../../shared/db/pool';
import { parse } from '../../shared/middleware/validate';
import { badRequest, notFound } from '../../shared/utils/errors';
import { formTemplateSchema, type AnswerValue, type AttachmentRef, type FormField } from './onboardingForm';
import { lockPendingOnboarding } from './employeeOnboardingRepository';

const decode = (value: unknown) => typeof value === 'string' ? JSON.parse(value) : value;
const keyFor = (field: string, child?: string) => JSON.stringify([field, child || null]);

export async function saveOnboardingFile(employeeId: string, field: string, child: string | undefined, file: Express.Multer.File | undefined, requestedName?: string): Promise<AttachmentRef> {
  if (!file || !file.buffer.length || file.size > 10 * 1024 * 1024) throw badRequest('请选择不超过 10MB 的附件');
  const name = (requestedName || file.originalname).replace(/[\\/\x00-\x1f\x7f]/g, '_').trim().slice(0, 255);
  if (!name) throw badRequest('附件名称无效');
  return transaction(async conn => {
    const row = await lockPendingOnboarding(conn, employeeId);
    if (!row) throw notFound('没有待填写的入职申请');
    const template = parse(formTemplateSchema, decode(row.template_json));
    const parent = template.find(item => item.name === field);
    const target = child && parent?.type === 'table' ? parent.children.find(item => item.name === child) : !child ? parent : undefined;
    if (!target || target.type !== 'attachment') throw badRequest('附件字段不存在');
    const key = keyFor(field, child);
    const [existing] = await conn.query<RowDataPacket[]>('SELECT COUNT(*) AS total FROM hr_onboarding_attachments WHERE onboarding_id = ? AND field_key = ?', [row.id, key]);
    const limit = child ? 250 : 5;
    if (Number(existing[0]?.total) >= limit) throw badRequest(child ? '该列附件已达到 250 个上限' : '该字段最多上传 5 个附件');
    const id = randomUUID();
    await conn.execute('INSERT INTO hr_onboarding_attachments (id,onboarding_id,field_key,file_name,file_size,file_data,created_at) VALUES (?,?,?,?,?,?,NOW())', [id, row.id, key, name, file.size, file.buffer]);
    return { id, name, size: file.size };
  });
}

export async function verifyOnboardingFiles(conn: PoolConnection, onboardingId: number, fields: FormField[], answers: Record<string, AnswerValue>): Promise<void> {
  const items: Array<{ ref: AttachmentRef; key: string }> = [];
  for (const field of fields) {
    const value = answers[field.name];
    if (field.type === 'attachment' && Array.isArray(value)) for (const ref of value as AttachmentRef[]) items.push({ ref, key: keyFor(field.name) });
    if (field.type === 'table' && Array.isArray(value)) {
      for (const row of value as Record<string, string | number | AttachmentRef[]>[]) for (const child of field.children) {
        if (child.type === 'attachment' && Array.isArray(row[child.name])) for (const ref of row[child.name] as AttachmentRef[]) items.push({ ref, key: keyFor(field.name, child.name) });
      }
    }
  }
  if (!items.length) return;
  if (new Set(items.map(item => item.ref.id)).size !== items.length) throw badRequest('附件不能重复使用');
  const [files] = await conn.query<RowDataPacket[]>('SELECT id, field_key, file_name, file_size FROM hr_onboarding_attachments WHERE onboarding_id=? AND id IN (?)', [onboardingId, items.map(item => item.ref.id)]);
  const byId = new Map(files.map(file => [file.id, file]));
  for (const { ref, key } of items) {
    const file = byId.get(ref.id);
    if (!file || file.field_key !== key || file.file_name !== ref.name || Number(file.file_size) !== ref.size) throw badRequest('附件无效，请重新上传');
  }
}

export async function getOnboardingFile(id: string) {
  const file = await queryOne<{ file_name: string; file_data: Buffer }>('SELECT file_name,file_data FROM hr_onboarding_attachments WHERE id=?', [id]);
  if (!file) throw notFound('附件不存在');
  return file;
}
