import type {
CurrentUser
} from '../../types/models';
import {
logout as clearLoginSession,
get,
getCachedUser,
login as loginRequest
} from '../../utils/request';

export function getCachedCurrentUser(): CurrentUser | null {
  return getCachedUser();
}

export function getCurrentUser(): Promise<CurrentUser> {
  return get<CurrentUser>('/me');
}

export function login(loginName: string, password: string): Promise<CurrentUser> {
  return loginRequest(loginName, password);
}

export function logout(): void {
  clearLoginSession();
}
