const LOCAL_ADMIN_ORIGINS = ['http://localhost:5173', 'http://127.0.0.1:5173'];

/** `*` 与空值只放行本机管理后台，不反射任意来源。显式名单按逗号拆分。 */
export function corsAllowedOrigins(configured: string): string[] {
  const value = configured.trim();
  if (value === '' || value === '*') return [...LOCAL_ADMIN_ORIGINS];
  return value.split(',').map((item) => item.trim()).filter(Boolean);
}
