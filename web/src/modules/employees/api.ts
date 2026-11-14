import { buildQuery,request } from '../../api/client';
import type {
AdminEmployee,
CreateEmployeeInput,
EmployeeAccountInput,
EmployeeInput,
EmployeeListResponse,
EmployeeOption,
JobCategoryName
} from '../../types';

export interface EmployeeListQuery {
  keyword?: string;
  deptId?: string;
  jobCategory?: JobCategoryName;
  accountStatus?: 'all' | 'active' | 'disabled' | 'none';
  page?: number;
  pageSize?: number;
}

export function fetchEmployees(params: EmployeeListQuery): Promise<EmployeeListResponse> {
  return request<EmployeeListResponse>(`/admin/employees${buildQuery(params as Record<string, string | number | undefined>)}`);
}

export function fetchEmployeeOptions(): Promise<EmployeeOption[]> {
  return request<EmployeeOption[]>('/admin/employees/options');
}

export function fetchEmployee(id: string): Promise<AdminEmployee> {
  return request<AdminEmployee>(`/admin/employees/${encodeURIComponent(id)}`);
}

export function createEmployee(input: CreateEmployeeInput): Promise<AdminEmployee> {
  return request<AdminEmployee>('/admin/employees', { method: 'POST', body: input });
}

export function updateEmployee(id: string, input: EmployeeInput): Promise<AdminEmployee> {
  return request<AdminEmployee>(`/admin/employees/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: input,
  });
}

export function upsertEmployeeAccount(id: string, input: EmployeeAccountInput): Promise<AdminEmployee> {
  return request<AdminEmployee>(`/admin/employees/${encodeURIComponent(id)}/account`, {
    method: 'POST',
    body: input,
  });
}

export function setEmployeeAccountStatus(
  id: string,
  status: 'active' | 'disabled'
): Promise<AdminEmployee> {
  return request<AdminEmployee>(`/admin/employees/${encodeURIComponent(id)}/account/status`, {
    method: 'PATCH',
    body: { status },
  });
}

export function resetEmployeeAccountPassword(id: string, password: string): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(
    `/admin/employees/${encodeURIComponent(id)}/account/reset-password`,
    { method: 'POST', body: { password } }
  );
}
