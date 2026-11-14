import fs from 'node:fs';
import path from 'node:path';

import { Router } from 'express';

import { queryOne } from '../../shared/db/pool';
import { asyncHandler } from '../../shared/utils/asyncHandler';
import { resolveExpenseFilePath, verifyExpenseFileSignature } from '../../domains/approvals/expenseFileAccess';

const router = Router();
const CONTENT_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.heic': 'image/heic',
};

router.get('/:name', asyncHandler(async (req, res) => {
  const name = req.params.name;
  if (!verifyExpenseFileSignature(name, req.query.exp, req.query.sig)) {
    res.status(404).end();
    return;
  }
  const fileId = `/uploads/${name}`;
  const known = await queryOne(
    `SELECT file_id FROM expense_uploads WHERE file_id = ?
     UNION ALL SELECT file_id FROM invoices WHERE file_id = ?
     UNION ALL SELECT file_id FROM expense_attachments WHERE file_id = ?
     LIMIT 1`,
    [fileId, fileId, fileId],
  );
  const fullPath = known ? resolveExpenseFilePath(name) : null;
  if (!fullPath || !fs.existsSync(fullPath)) {
    res.status(404).end();
    return;
  }
  res.setHeader('Content-Type', CONTENT_TYPES[path.extname(name).toLowerCase()] || 'application/octet-stream');
  res.setHeader('Cache-Control', 'private, max-age=300');
  res.sendFile(fullPath);
}));

export default router;
