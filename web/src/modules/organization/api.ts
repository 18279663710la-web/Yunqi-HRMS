import { request } from '../../api/client';
import type {
DepartmentNode
} from '../../types';

export function fetchDepartments(): Promise<DepartmentNode[]> {
  return request<DepartmentNode[]>('/admin/departments');
}
