import path from 'node:path';
import { badRequest, notFound } from '../../shared/utils/errors';
import * as repository from './contractFilesRepository';

const fileTypes: Record<string, { mime: string; header: Buffer }> = {
  '.pdf': { mime: 'application/pdf', header: Buffer.from('%PDF-') },
  '.doc': { mime: 'application/msword', header: Buffer.from('d0cf11e0a1b11ae1', 'hex') },
  '.docx': { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', header: Buffer.from('504b0304', 'hex') },
  '.jpg': { mime: 'image/jpeg', header: Buffer.from('ffd8ff', 'hex') },
  '.jpeg': { mime: 'image/jpeg', header: Buffer.from('ffd8ff', 'hex') },
  '.png': { mime: 'image/png', header: Buffer.from('89504e470d0a1a0a', 'hex') },
};

async function requireEmployee(id: string): Promise<void> {
  if (!await repository.findEmployee(id)) throw notFound('员工不存在');
}

export async function listContractFiles(employeeId: string) {
  await requireEmployee(employeeId);
  return repository.listFiles(employeeId);
}

export async function saveContractFile(employeeId: string, file: Express.Multer.File | undefined, adminId: number) {
  await requireEmployee(employeeId);
  if (!file) throw badRequest('请选择合同文件');
  const name = file.originalname.replace(/[\\/\x00-\x1f\x7f]/g, '_').trim();
  if (!name || name.length > 200) throw badRequest('合同文件名不能为空且不能超过 200 个字符');
  const format = fileTypes[path.extname(name).toLowerCase()];
  if (!format || !file.size || !file.buffer.subarray(0, format.header.length).equals(format.header)) throw badRequest('请选择有效的 PDF、Word、JPG 或 PNG 文件');
  return repository.insertFile(employeeId, name, format.mime, file, adminId);
}

export async function getContractFile(employeeId: string, fileId: number) {
  const file = await repository.findFile(employeeId, fileId);
  if (!file) throw notFound('合同文件不存在');
  return file;
}
