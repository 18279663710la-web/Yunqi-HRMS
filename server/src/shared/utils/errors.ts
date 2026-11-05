export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: number,
    message: string
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export function badRequest(message: string): HttpError {
  return new HttpError(400, 400, message);
}

export function unauthorized(message = '登录已过期，请重新登录'): HttpError {
  return new HttpError(401, 401, message);
}

export function forbidden(message = '无权执行该操作'): HttpError {
  return new HttpError(403, 403, message);
}

export function notFound(message = '资源不存在'): HttpError {
  return new HttpError(404, 404, message);
}

export function conflict(message: string): HttpError {
  return new HttpError(409, 409, message);
}
