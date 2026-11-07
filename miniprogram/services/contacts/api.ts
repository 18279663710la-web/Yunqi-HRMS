import type {
DepartmentFlat,
DepartmentNode,
EmployeeDetail,
EmployeeGroup,
EmployeeListItem
} from '../../types/models';
import {
get
} from '../../utils/request';

export function getDepartmentTree(): Promise<DepartmentNode[]> {
  return get<DepartmentNode[]>('/departments/tree');
}

export function getDepartmentList(): Promise<DepartmentFlat[]> {
  return get<DepartmentFlat[]>('/departments');
}

export interface JobTitle { id: number; name: string; count: number }
export function getJobTitles(): Promise<JobTitle[]> { return get<JobTitle[]>('/job-titles'); }

export function getEmployeeList(params: { deptId?: string; keyword?: string } = {}): Promise<EmployeeListItem[]> {
  return get<EmployeeListItem[]>('/employees', params);
}

export function getEmployeeGroups(
  params: { deptId?: string; keyword?: string; jobTitle?: string } = {}
): Promise<EmployeeGroup[]> {
  return get<EmployeeGroup[]>('/employees/groups', params);
}

export function getEmployeeDetail(id: string): Promise<EmployeeDetail> {
  return get<EmployeeDetail>(`/employees/${encodeURIComponent(id)}`);
}
