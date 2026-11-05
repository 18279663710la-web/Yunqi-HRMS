import { buildQuery,request } from '../../api/client';
import type {
DashboardData,
OperationLog
} from '../../types';

export function fetchDashboard(): Promise<DashboardData> {
  return request<DashboardData>('/admin/dashboard');
}

export function fetchLogs(limit = 20): Promise<OperationLog[]> {
  return request<OperationLog[]>(`/admin/logs${buildQuery({ limit })}`);
}
