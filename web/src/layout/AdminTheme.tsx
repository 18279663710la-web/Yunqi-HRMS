import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { theme as antdTheme, type ThemeConfig } from 'antd';

export type AdminTheme = 'dark' | 'light';
const STORAGE_KEY = 'yunqi.admin-theme';

const AdminThemeContext = createContext<{ theme: AdminTheme; setTheme: (theme: AdminTheme) => void }>({
  theme: 'dark',
  setTheme: () => undefined,
});

function initialTheme(): AdminTheme {
  try { return localStorage.getItem(STORAGE_KEY) === 'light' ? 'light' : 'dark'; } catch { return 'dark'; }
}

/** 深浅主题共用字体与圆角，仅切换配色算法与色板。 */
export function adminThemeConfig(theme: AdminTheme): ThemeConfig {
  if (theme === 'light') {
    return {
      algorithm: antdTheme.defaultAlgorithm,
      token: {
        colorPrimary: '#3D6EF7',
        colorInfo: '#3D6EF7',
        colorSuccess: '#16B364',
        colorWarning: '#F79009',
        colorError: '#D45B5B',
        colorTextLightSolid: '#FFFFFF',
        colorWhite: '#FFFFFF',
        fontWeightStrong: 600,
        borderRadius: 10,
        colorBgLayout: '#F5F7FB',
        colorBgContainer: '#FFFFFF',
        colorBgElevated: '#FFFFFF',
        colorText: '#1F1F1F',
        colorBorder: '#D9DEE7',
        colorBorderSecondary: '#E8ECF2',
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif',
      },
      components: {
        Button: { fontWeight: 500 },
        Table: { headerBg: 'transparent', headerColor: '#1F1F1F', rowHoverBg: '#F0F4FA', headerSplitColor: 'transparent' },
        Menu: { itemHeight: 48, itemMarginInline: 12, itemBorderRadius: 9, itemSelectedBg: '#E8EEF9', itemSelectedColor: '#1F1F1F' },
      },
    };
  }
  return {
    // 黑底白字暗色主题：白色为主交互色，仅保留用于区分种类的低饱和辅助色，其余一律灰阶。
    algorithm: antdTheme.darkAlgorithm,
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
      Button: { fontWeight: 500 },
      Table: { headerBg: 'transparent', headerColor: '#FFFFFF', rowHoverBg: '#262626', headerSplitColor: 'transparent' },
      Menu: { itemHeight: 48, itemMarginInline: 12, itemBorderRadius: 9, itemSelectedBg: '#303030', itemSelectedColor: '#FFFFFF' },
    },
  };
}

export function AdminThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<AdminTheme>(initialTheme);
  useEffect(() => {
    document.documentElement.classList.toggle('admin-theme-light', theme === 'light');
    try { localStorage.setItem(STORAGE_KEY, theme); } catch { /* 存储不可用时忽略 */ }
  }, [theme]);
  const value = useMemo(() => ({ theme, setTheme }), [theme]);
  return <AdminThemeContext.Provider value={value}>{children}</AdminThemeContext.Provider>;
}

export function useAdminTheme() {
  return useContext(AdminThemeContext);
}
