import { request } from '../../api/client';

export interface U9Operator { id: string; code: string; name: string; orgId: string; orgName: string }

export function fetchU9Operators(keyword = ''): Promise<U9Operator[]> {
  return request(`/admin/u9/operators?keyword=${encodeURIComponent(keyword)}`);
}
export function fetchU9Binding(employeeId: string): Promise<U9Operator | null> {
  return request(`/admin/u9/bindings/${encodeURIComponent(employeeId)}`);
}
export function saveU9Binding(employeeId: string, operatorId: string): Promise<U9Operator> {
  return request(`/admin/u9/bindings/${encodeURIComponent(employeeId)}`, { method: 'PUT', body: { operatorId } });
}
export function deleteU9Binding(employeeId: string): Promise<void> {
  return request(`/admin/u9/bindings/${encodeURIComponent(employeeId)}`, { method: 'DELETE' });
}
