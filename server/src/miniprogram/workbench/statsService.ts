import type { CurrentUser, TodoStats } from '../../shared/types/models';
import { getAttendanceStats, getTodayAttendance } from '../../domains/attendance/attendanceService';
import { getApprovalTabCounts } from '../../domains/approvals/approvalService';
import { getUnreadNoticeCount } from '../../domains/notices/noticeService';

export async function getTodoStats(user: CurrentUser): Promise<TodoStats> {
  const [counts, unreadNotice, attendance] = await Promise.all([
    getApprovalTabCounts(user),
    getUnreadNoticeCount(user.id),
    getTodayAttendance(user.id),
  ]);
  return { ...counts, unreadNotice, attendance };
}
