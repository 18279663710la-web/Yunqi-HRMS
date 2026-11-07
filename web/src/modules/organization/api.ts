import { request } from '../../api/client';
import type {
DepartmentNode
} from '../../types';

export function fetchDepartments(): Promise<DepartmentNode[]> {
  return request<DepartmentNode[]>('/admin/departments');
}

export interface JobTitleEmployee {
  id: string; name: string; employeeNo: string; position: string; phone: string; joinDate: string;
  isLeader: boolean; accountStatus: 'active' | 'disabled' | 'none'; loginName: string | null;
}
export interface JobTitle { id: number; name: string; count: number; employees: JobTitleEmployee[] }
export const fetchJobTitles = () => request<JobTitle[]>('/admin/job-titles');
export const createJobTitle = (name: string) => request<Pick<JobTitle, 'id' | 'name'>>('/admin/job-titles', { method: 'POST', body: { name } });
export const deleteJobTitle = (id: number) => request<void>(`/admin/job-titles/${id}`, { method: 'DELETE' });
