import type { Response } from 'express';

export interface ApiSuccess<T> {
  code: 0;
  message: 'ok';
  data: T;
}

export function success<T>(res: Response, data: T): void {
  const body: ApiSuccess<T> = { code: 0, message: 'ok', data };
  res.json(body);
}

export function successNoData(res: Response): void {
  success(res, null);
}
