import { request } from '../../api/client';

export interface NoticeBlock {
  type: 'p' | 'h' | 'list' | 'quote';
  text?: string;
  items?: string[];
}

export interface NoticeAttachment {
  name: string;
  size: string;
  ext: string;
  fileID?: string;
}

export interface NoticeReadStats {
  readCount: number;
  totalCount: number;
  readPercent: number;
  readers: Array<{ employeeId: string; name: string; department: string; readAt: string }>;
}

export interface AdminNotice {
  id: string;
  title: string;
  category: string;
  categoryName: string;
  isTop: boolean;
  publishTime: string;
  publisher: string;
  publisherDept: string;
  banner: string;
  summary: string;
  blocks: NoticeBlock[];
  attachments: NoticeAttachment[];
  readStats: NoticeReadStats;
}

export interface NoticeInput {
  title: string;
  category: string;
  isTop: boolean;
  publishTime: string;
  publisherDept: string;
  summary: string;
  blocks: NoticeBlock[];
  attachments: NoticeAttachment[];
}

export const CATEGORY_OPTIONS = [
  { value: 'company', label: '公司公告' },
  { value: 'hr', label: '人事行政' },
  { value: 'it', label: '技术规范' },
  { value: 'activity', label: '活动通知' },
];

export function fetchAdminNotices(params: { keyword?: string; category?: string; page: number; pageSize: number }): Promise<{ list: AdminNotice[]; total: number; page: number; pageSize: number; hasMore: boolean }> {
  const query = new URLSearchParams();
  if (params.keyword) query.set('keyword', params.keyword);
  if (params.category && params.category !== 'all') query.set('category', params.category);
  query.set('page', String(params.page));
  query.set('pageSize', String(params.pageSize));
  const qs = query.toString();
  return request(`/admin/notices${qs ? `?${qs}` : ''}`);
}

export function fetchAdminNotice(id: string): Promise<AdminNotice> {
  return request(`/admin/notices/${encodeURIComponent(id)}`);
}

export function createNotice(payload: NoticeInput): Promise<AdminNotice> {
  return request('/admin/notices', { method: 'POST', body: payload });
}

export function updateNotice(id: string, payload: NoticeInput): Promise<AdminNotice> {
  return request(`/admin/notices/${encodeURIComponent(id)}`, { method: 'PUT', body: payload });
}

export function deleteNotice(id: string): Promise<{ ok: boolean }> {
  return request(`/admin/notices/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export function uploadNoticeFile(file: File): Promise<NoticeAttachment> {
  const form = new FormData();
  form.append('file', file);
  return request('/admin/notice-files', { method: 'POST', body: form });
}
