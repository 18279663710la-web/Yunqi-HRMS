import React from 'react';
import ReactDOM from 'react-dom/client';
import { App as AntApp, ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import dayjs from 'dayjs';
import 'dayjs/locale/zh-cn';

import App from './App';
import { AuthProvider } from './auth/AuthContext';
import { AdminThemeProvider, adminThemeConfig, useAdminTheme } from './layout/AdminTheme';
import '@xyflow/react/dist/style.css';
import './styles.css';

dayjs.locale('zh-cn');

/** 主题状态挂在 ConfigProvider 之外，算法与色板随主题切换。 */
function ThemedRoot({ children }: { children: React.ReactNode }) {
  const { theme } = useAdminTheme();
  return <ConfigProvider locale={zhCN} theme={adminThemeConfig(theme)}>{children}</ConfigProvider>;
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <AdminThemeProvider>
      <ThemedRoot>
        <AntApp>
          <AuthProvider>
            <App />
          </AuthProvider>
        </AntApp>
      </ThemedRoot>
    </AdminThemeProvider>
  </React.StrictMode>
);
