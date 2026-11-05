import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { adminLogin, getMe } from '../modules/auth/api';
import { clearToken, getToken, setToken } from '../api/client';
import type { AdminUser } from '../types';

interface AuthContextValue {
  admin: AdminUser | null;
  loading: boolean;
  login(username: string, password: string): Promise<void>;
  logout(): void;
  refresh(): Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [admin, setAdmin] = useState<AdminUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!getToken()) {
      setAdmin(null);
      setLoading(false);
      return;
    }
    try {
      setAdmin(await getMe());
    } catch {
      clearToken();
      setAdmin(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const login = useCallback(async (username: string, password: string) => {
    const result = await adminLogin(username, password);
    setToken(result.token);
    setAdmin(result.admin);
  }, []);

  const logout = useCallback(() => {
    clearToken();
    setAdmin(null);
  }, []);

  const value = useMemo(
    () => ({ admin, loading, login, logout, refresh }),
    [admin, loading, login, logout, refresh]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth 必须在 AuthProvider 内使用');
  return ctx;
}
