/**
 * app.ts — 公司管理小程序入口（TypeScript / 前后端分离）
 *
 * 登录态由 utils/request.ts 统一维护：员工在登录页输入管理员创建的账号，
 * 登录后携带 Bearer Token；401 时自动刷新，失败则返回登录页。
 */

import { getCachedUser, getToken, resetWechatAutoLoginSuppression } from './utils/request';
import type { CurrentUser } from './types/models';
import { getEntryDestination, ONBOARDING_REQUIRED } from './services/onboarding/onboardingGate';
import { isOnboardingRoute } from './services/onboarding/onboardingRoutes';

export interface IAppOption {
  globalData: {
    /** 当前登录用户（来自后端 /auth/password-login 或 /me） */
    userInfo: CurrentUser | null;
    /** 主题色，供页面/组件统一取用 */
    theme: {
      primary: string;
      primaryLight: string;
    };
    /** 系统安全区信息 */
    safeArea: WechatMiniprogram.SafeArea | null;
    /** 状态栏高度 */
    statusBarHeight: number;
    /** 胶囊按钮位置，供自定义头部使用 */
    menuRect: WechatMiniprogram.ClientRect | null;
  };
  initSystemInfo(): void;
}

App<IAppOption>({
  globalData: {
    userInfo: null,
    theme: {
      primary: '#3D6EF7',
      primaryLight: '#EAF0FF',
    },
    safeArea: null,
    statusBarHeight: 20,
    menuRect: null,
  },

  onLaunch() {
    this.initSystemInfo();
    // 冷启动复位静默登录抑制：上次运行中的“退出登录”不延续到本次启动
    resetWechatAutoLoginSuppression();
    this.globalData.userInfo = getCachedUser();
  },

  onShow() {
    // 从后台回到前台时刷新登录态
    this.globalData.userInfo = getCachedUser();

    // 深度链接 / 未登录时统一进入登录页（登录页自身不再跳转）
    const pages = getCurrentPages() as Array<{ route?: string }>;
    const route = pages.length ? pages[pages.length - 1].route || '' : '';
    if (!getToken() && route && route !== 'pages/login/login') {
      wx.reLaunch({ url: '/pages/login/login' });
    } else if (getToken() && this.globalData.userInfo && route &&
      !['pages/login/login', 'pages/index/index'].includes(route) && !isOnboardingRoute(route)) {
      void getEntryDestination().then((destination) => {
        const current = getCurrentPages();
        if (destination === ONBOARDING_REQUIRED && current[current.length - 1]?.route === route) wx.reLaunch({ url: destination });
      }).catch(() => { const current = getCurrentPages(); if (current[current.length - 1]?.route === route) wx.reLaunch({ url: '/pages/login/login' }); });
    }
  },

  /**
   * 采集设备信息，统一处理新版/旧版 API 差异
   */
  initSystemInfo() {
    let windowInfo: WechatMiniprogram.WindowInfo | WechatMiniprogram.SystemInfo;
    try {
      windowInfo = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
    } catch {
      windowInfo = {} as WechatMiniprogram.WindowInfo;
    }

    this.globalData.statusBarHeight = windowInfo.statusBarHeight || 20;
    this.globalData.safeArea = windowInfo.safeArea || null;

    // 计算胶囊按钮位置，供自定义导航栏预留右侧空间
    try {
      const menuRect = wx.getMenuButtonBoundingClientRect
        ? wx.getMenuButtonBoundingClientRect()
        : null;
      if (menuRect && menuRect.width) {
        this.globalData.menuRect = menuRect;
      }
    } catch {
      this.globalData.menuRect = null;
    }
  },
});
