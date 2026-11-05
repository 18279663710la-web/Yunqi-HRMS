import type { IAppOption } from '../../app';
import * as authApi from '../../services/auth/api';
import * as workbenchApi from '../../services/workbench/api';
import type { Company, CurrentUser, TodoStats, TodayAttendance } from '../../types/models';
import { getCustomTabBar, type TapEvent } from '../../types/ui';
import { toast } from '../../utils/util';

interface MenuItem {
  key: string;
  name: string;
  icon: string;
  desc?: string;
  danger?: boolean;
}

interface MineData {
  user: CurrentUser;
  userInitial: string;
  roleTitle: string;
  company: Company;
  stats: TodoStats;
  menu: MenuItem[];
  settings: MenuItem[];
}

interface MineCustom {
  load(): Promise<void>;
  onMenuTap(e: TapEvent): void;
  onSettingTap(e: TapEvent): void;
  showNotifySetting(): void;
  showAbout(): void;
  showLogout(): void;
  showReset(): void;
}

Page<MineData, MineCustom>({
  data: {
    user: {} as CurrentUser,
    userInitial: '',
    roleTitle: '',
    company: {} as Company,
    stats: {
      pending: 0,
      mine: 0,
      done: 0,
      unreadNotice: 0,
      attendance: {} as TodayAttendance,
    },
    menu: [
      { key: 'approval', name: '我的审批', icon: 'doc', desc: '' },
      { key: 'attendance', name: '我的考勤', icon: 'clock', desc: '' },
      { key: 'notice', name: '公告通知', icon: 'bell', desc: '' },
      { key: 'invoiceTool', name: '发票工具台', icon: 'qr', desc: '图片识别 · 发票查重' },
    ],
    settings: [
      { key: 'notify', name: '消息提醒设置', icon: 'bell' },
      { key: 'about', name: '关于云启科技', icon: 'info' },
      { key: 'logout', name: '退出登录', icon: 'logout', danger: true },
      { key: 'reset', name: '重置演示数据', icon: 'refresh', danger: true },
    ],
  },

  onShow() {
    const tabBar = getCustomTabBar(this);
    if (tabBar) {
      tabBar.setData({ selected: 3 });
      tabBar.refreshBadge();
    }
    void this.load();
  },

  async load(): Promise<void> {
    try {
      const [user, stats, company] = await Promise.all([
        authApi.getCurrentUser(),
        workbenchApi.getTodoStats(),
        workbenchApi.getCompany(),
      ]);
      const roleTitle = !user.isLeader
        ? ''
        : user.jobCategory === '研发员'
          ? '研发组负责人'
          : user.jobCategory === '业务员'
            ? '业务组负责人'
            : '负责人';

      this.setData({
        user,
        userInitial: user.name.slice(0, 1),
        roleTitle,
        company,
        stats,
        menu: [
          { key: 'approval', name: '我的审批', icon: 'doc', desc: `${stats.pending} 条待办 · ${stats.mine} 条我发起` },
          { key: 'attendance', name: '我的考勤', icon: 'clock', desc: `今日 ${stats.attendance.statusText}` },
          {
            key: 'notice',
            name: '公告通知',
            icon: 'bell',
            desc: stats.unreadNotice ? `${stats.unreadNotice} 条未读` : '已全部读完',
          },
          { key: 'invoiceTool', name: '发票工具台', icon: 'qr', desc: '图片识别 · 发票查重' },
        ],
      });
    } catch {
      // 请求层已提示
    }
  },

  onMenuTap(e: TapEvent) {
    const key = String(e.currentTarget.dataset.key || '');
    if (key === 'approval') wx.switchTab({ url: '/pages/approval/approval' });
    else if (key === 'attendance') wx.navigateTo({ url: '/pages/record/record' });
    else if (key === 'notice') wx.navigateTo({ url: '/pages/notice/notice' });
    else if (key === 'invoiceTool') wx.navigateTo({ url: '/pages/invoice-tool/invoice-tool' });
  },

  onSettingTap(e: TapEvent) {
    const key = String(e.currentTarget.dataset.key || '');
    if (key === 'notify') this.showNotifySetting();
    else if (key === 'about') this.showAbout();
    else if (key === 'logout') this.showLogout();
    else if (key === 'reset') this.showReset();
  },

  showNotifySetting() {
    wx.showModal({
      title: '消息提醒设置',
      content:
        '订阅消息需在「微信公众平台 → 小程序后台 → 功能 → 订阅消息」中申请模板。审批结果与公告提醒会以服务通知形式推送。',
      showCancel: false,
      confirmText: '知道了',
    });
  },

  showAbout() {
    const { company } = this.data;
    wx.showModal({
      title: company.name,
      content: `办公地址：${company.address}\n工作时间：${company.workTime}\n考勤规则：${company.flexible}`,
      showCancel: false,
      confirmText: '关闭',
    });
  },

  showLogout() {
    wx.showModal({
      title: '退出登录',
      content: '退出后需要重新输入员工账号和密码登录，确定继续吗？',
      confirmText: '退出登录',
      confirmColor: '#F04438',
      success: (res) => {
        if (!res.confirm) return;
        authApi.logout();
        getApp<IAppOption>().globalData.userInfo = null;
        wx.reLaunch({ url: '/pages/login/login' });
      },
    });
  },

  showReset() {
    wx.showModal({
      title: '重置演示数据',
      content: '将重置打卡记录、公告和已读状态，保留审批与发票数据。确定继续吗？',
      confirmText: '确认重置',
      confirmColor: '#F04438',
      success: (res) => {
        if (!res.confirm) return;
        void (async () => {
          try {
            await workbenchApi.resetDemoData();
            const tabBar = getCustomTabBar(this);
            if (tabBar) tabBar.refreshBadge();
            await this.load();
            toast('演示数据已重置');
          } catch {
            // 请求层已提示
          }
        })();
      },
    });
  },
});
