import { request } from '../../api/client';
import type {
AdminAccountItem,
AdminRole,
AdminUser
} from '../../types';

export function fetchChairpersonAccount(): Promise<{ loginName: string; status: 'active' | 'disabled' } | null> {
  return request('/admin/chairperson-account');
}

export function createChairpersonAccount(input: { loginName: string; password: string }): Promise<{ loginName: string }> {
  return request('/admin/chairperson-account', { method: 'POST', body: input });
}

export function fetchAdmins(): Promise<AdminAccountItem[]> {
  return request<AdminAccountItem[]>('/admin/admins');
}

export function createAdmin(input: {
  username: string;
  password: string;
  name: string;
  role: AdminRole;
}): Promise<AdminUser> {
  return request<AdminUser>('/admin/admins', { method: 'POST', body: input });
}

export function setAdminStatus(id: number, status: boolean): Promise<AdminUser> {
  return request<AdminUser>(`/admin/admins/${id}/status`, { method: 'PATCH', body: { status } });
}

export function resetAdminPassword(id: number, password: string): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(`/admin/admins/${id}/reset-password`, {
    method: 'POST',
    body: { password },
  });
}
