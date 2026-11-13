import { HttpError } from '../../shared/utils/errors';

/** ODBC 连接仅在 U9 功能被访问时建立。 */
export function u9ConnectionString(): string {
  const value = (name: string, fallback: string) => `{${(process.env[name] || fallback).replace(/}/g, '}}')}}`;
  return `Driver=${value('U9_SQL_DRIVER', 'ODBC Driver 17 for SQL Server')};Server=${value('U9_SQL_SERVER', '.')};Database=${value('U9_SQL_DATABASE', 'U9数据库')};Trusted_Connection=Yes;TrustServerCertificate=Yes;ApplicationIntent=ReadOnly;`;
}

export async function u9Sql<T>(statement: string, params: string[] = []): Promise<T[]> {
  try {
    const driver = await import('msnodesqlv8');
    return await new Promise<T[]>((resolve, reject) => {
      driver.query(u9ConnectionString(), statement, params, (err, rows) =>
        err ? reject(err) : resolve(rows as T[])
      );
    });
  } catch (error) {
    console.error('[U9] 数据库查询失败', error instanceof Error ? error.message : '未知错误');
    throw new HttpError(503, 503, 'U9 数据库暂不可用，请联系管理员');
  }
}

/** 将 ID 列表按 chunk 切开，避免超长 IN。 */
export function chunkIds(ids: string[], chunkSize: number): string[][] {
  const size = Math.max(1, chunkSize);
  const out: string[][] = [];
  for (let i = 0; i < ids.length; i += size) out.push(ids.slice(i, i + size));
  return out;
}
