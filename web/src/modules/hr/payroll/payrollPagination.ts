export function getPayrollPage<T>(items: readonly T[], requestedPage: number, pageSize: number): { page: number; items: T[] } {
  const size = Math.max(1, Math.floor(pageSize) || 1);
  const lastPage = Math.max(1, Math.ceil(items.length / size));
  const page = Math.min(lastPage, Math.max(1, Math.floor(requestedPage) || 1));
  return { page, items: items.slice((page - 1) * size, page * size) };
}
