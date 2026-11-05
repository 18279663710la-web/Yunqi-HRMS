import type { ZodType } from 'zod';

import { badRequest } from '../utils/errors';

export function parse<T>(schema: ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw badRequest(issue ? `${issue.path.join('.') || '参数'}：${issue.message}` : '参数格式错误');
  }
  return result.data;
}
