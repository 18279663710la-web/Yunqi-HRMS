import type {
Notice,
NoticeCategory,
NoticeDetail
} from '../../types/models';
import {
get
} from '../../utils/request';

export function getNotices(
  params: { category?: string; keyword?: string } = {}
): Promise<Notice[]> {
  return get<Notice[]>('/notices', params);
}

export function getNoticeCategories(): Promise<NoticeCategory[]> {
  return get<NoticeCategory[]>('/notices/categories');
}

export function getNoticeDetail(id: string): Promise<NoticeDetail> {
  return get<NoticeDetail>(`/notices/${encodeURIComponent(id)}`);
}

export function getUnreadNoticeCount(): Promise<number> {
  return get<number>('/notices/unread-count');
}

export interface NoticePage {
  items: Notice[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

/** 分页列表（公告页触底加载） */
export function getNoticePage(params: { category?: string; keyword?: string; page: number; pageSize?: number }): Promise<NoticePage> {
  const query = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
    .join('&');
  return get<NoticePage>(`/notices/page${query ? `?${query}` : ''}`);
}
