import React from 'react';
import ReactDOM from 'react-dom/client';
import { App as AntApp, ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import dayjs from 'dayjs';
import 'dayjs/locale/zh-cn';

import App from './App';
import { AuthProvider } from './auth/AuthContext';
import '@xyflow/react/dist/style.css';
import './styles.css';

dayjs.locale('zh-cn');

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <ConfigProvider
      locale={zhCN}
      theme={{
        token: {
          colorPrimary: '#3D6EF7',
          borderRadius: 10,
          colorBgLayout: '#F5F7FB',
          colorText: '#1F2937',
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif',
        },
        components: {
          Table: {
            headerBg: '#F8FAFC',
            headerColor: '#5B6475',
            rowHoverBg: '#F7F9FF',
          },
          Menu: {
            itemSelectedBg: '#EAF0FF',
            itemSelectedColor: '#3D6EF7',
          },
        },
      }}
    >
      <AntApp>
        <AuthProvider>
          <App />
        </AuthProvider>
      </AntApp>
    </ConfigProvider>
  </React.StrictMode>
);
