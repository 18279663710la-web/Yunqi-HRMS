import type { NextFunction, Request, RequestHandler, Response } from 'express';

/** 把 async 路由的 rejected promise 交给 Express 错误中间件 */
export function asyncHandler(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>
): RequestHandler {
  return (req, res, next) => {
    handler(req, res, next).catch(next);
  };
}
