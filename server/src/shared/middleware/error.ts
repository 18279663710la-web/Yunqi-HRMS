import type { NextFunction, Request, Response } from 'express';

import { HttpError } from '../utils/errors';

export function notFoundHandler(_req: Request, res: Response): void {
  res.status(404).json({ code: 404, message: '接口不存在' });
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof HttpError) {
    res.status(err.status).json({ code: err.code, message: err.message });
    return;
  }

  const e = err as { message?: string; code?: string };
  if (e && e.code === 'ER_DUP_ENTRY') {
    res.status(409).json({ code: 409, message: '数据已存在，请勿重复提交' });
    return;
  }

  console.error('[server error]', err);
  res.status(500).json({ code: 500, message: '服务器内部错误' });
}
