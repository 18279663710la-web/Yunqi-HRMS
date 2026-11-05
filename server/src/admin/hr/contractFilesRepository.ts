import { execute, queryOne, queryRows } from '../../shared/db/pool';

export function findEmployee(id: string) {
  return queryOne('SELECT id FROM employees WHERE id = ?', [id]);
}

export function listFiles(employeeId: string) {
  return queryRows('SELECT id, file_name AS name, file_size AS size, mime_type AS mimeType, created_at AS createdAt FROM hr_contract_files FORCE INDEX (idx_contract_files_employee) WHERE employee_id = ? ORDER BY id DESC LIMIT 200', [employeeId]);
}

export function insertFile(employeeId: string, name: string, mime: string, file: Express.Multer.File, adminId: number) {
  return execute('INSERT INTO hr_contract_files (employee_id, file_name, mime_type, file_size, file_data, uploaded_by, created_at) VALUES (?, ?, ?, ?, ?, ?, NOW())', [employeeId, name, mime, file.size, file.buffer, adminId]);
}

export function findFile(employeeId: string, fileId: number) {
  return queryOne<{ file_name: string; mime_type: string; file_data: Buffer }>('SELECT file_name, mime_type, file_data FROM hr_contract_files WHERE employee_id = ? AND id = ?', [employeeId, fileId]);
}
