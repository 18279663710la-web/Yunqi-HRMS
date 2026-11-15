import React from 'react';
import ReactDOM from 'react-dom/client';
import { App as AntApp, ConfigProvider, theme } from 'antd';
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
        // 黑底白字暗色主题：白色为主交互色，仅保留用于区分种类的低饱和辅助色，其余一律灰阶。
        algorithm: theme.darkAlgorithm,
        token: {
          colorPrimary: '#FFFFFF',
          colorInfo: '#8BA6C1',
          colorSuccess: '#80BB9E',
          colorWarning: '#C9A75C',
          colorError: '#C97474',
          colorTextLightSolid: '#1A1A1A',
          colorWhite: '#1A1A1A',
          fontWeightStrong: 600,
          borderRadius: 10,
          colorBgLayout: '#141414',
          colorBgContainer: '#1F1F1F',
          colorBgElevated: '#262626',
          colorText: '#E8E8E8',
          colorBorder: '#333333',
          colorBorderSecondary: '#2E2E2E',
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif',
        },
        components: {
          Button: {
            fontWeight: 500,
          },
          Table: {
            headerBg: 'transparent',
            headerColor: '#FFFFFF',
            rowHoverBg: '#262626',
            headerSplitColor: 'transparent',
          },
          Menu: {
            itemHeight: 48,
            itemMarginInline: 12,
            itemBorderRadius: 9,
            itemSelectedBg: '#303030',
            itemSelectedColor: '#FFFFFF',
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
