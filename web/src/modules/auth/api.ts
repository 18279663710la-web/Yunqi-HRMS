import { request } from '../../api/client';
import type {
AdminUser,
LoginResponse
} from '../../types';

export function adminLogin(username: string, password: string): Promise<LoginResponse> {
  return request<LoginResponse>('/admin/auth/login', {
    method: 'POST',
    body: { username, password },
    auth: false,
  });
}

export function getMe(): Promise<AdminUser> {
  return request<AdminUser>('/admin/auth/me');
}

export function changePassword(oldPassword: string, newPassword: string): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>('/admin/auth/change-password', {
    method: 'POST',
    body: { oldPassword, newPassword },
  });
}
