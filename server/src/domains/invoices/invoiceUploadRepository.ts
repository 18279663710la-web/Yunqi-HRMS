import { execute } from '../../shared/db/pool';

export async function recordInvoiceUpload(fileUrl: string, employeeId: string): Promise<void> {
  await execute('INSERT INTO expense_uploads (file_id, owner_id, created_at) VALUES (?, ?, NOW())', [fileUrl, employeeId]);
}
