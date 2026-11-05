import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { Spin } from 'antd';
import { useAuth } from './auth/AuthContext';
import { AdminLayout } from './layout/AdminLayout';
import { LoginPage } from './modules/auth/Login';

function ProtectedRoute() {
  const { admin, loading } = useAuth();
  const location = useLocation();
  if (loading) return <div className="app-loading"><Spin size="large" tip="正在校验登录状态…" /></div>;
  if (!admin) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <Outlet />;
}

export default function App() {
  return <BrowserRouter><Routes>
    <Route path="/login" element={<LoginPage />} />
    <Route element={<ProtectedRoute />}><Route path="*" element={<AdminLayout />} /></Route>
  </Routes></BrowserRouter>;
}
