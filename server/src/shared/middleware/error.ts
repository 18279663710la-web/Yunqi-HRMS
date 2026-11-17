import type { NextFunction, Request, Response } from 'express';

import { HttpError } from '../utils/errors';
import { logRequestError } from '../logging/logger';

const UPLOAD_LIMIT_CODES = new Set([
  'LIMIT_PART_COUNT',
  'LIMIT_FILE_COUNT',
  'LIMIT_FIELD_KEY',
  'LIMIT_FIELD_VALUE',
  'LIMIT_FIELD_COUNT',
  'LIMIT_UNEXPECTED_FILE',
]);

type TaggedError = { code?: string; type?: string };

function reject(res: Response, status: number, message: string): void {
  res.status(status).json({ code: status, message });
}

export function notFoundHandler(_req: Request, res: Response): void {
  res.status(404).json({ code: 404, message: '接口不存在' });
}

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof HttpError) {
    res.status(err.status).json({ code: err.code, message: err.message });
    return;
  }

  const tagged = (err && typeof err === 'object' ? err : {}) as TaggedError;
  if (tagged.code === 'ER_DUP_ENTRY') {
    reject(res, 409, '数据已存在，请勿重复提交');
    return;
  }
  if (tagged.type === 'entity.parse.failed') {
    reject(res, 400, '请求体不是合法的 JSON');
    return;
  }
  if (tagged.type === 'entity.too.large') {
    reject(res, 413, '请求体过大');
    return;
  }
  if (tagged.code === 'LIMIT_FILE_SIZE') {
    reject(res, 400, '上传文件过大');
    return;
  }
  if (tagged.code && UPLOAD_LIMIT_CODES.has(tagged.code)) {
    reject(res, 400, '上传文件不符合限制');
    return;
  }

  logRequestError(req, err);
  res.status(500).json({ code: 500, message: '服务器内部错误' });
}
