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
