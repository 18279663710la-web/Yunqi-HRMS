import * as authApi from '../../services/auth/api';
import * as workbenchApi from '../../services/workbench/api';
import * as attendanceApi from '../../services/attendance/api';
import * as approvalsApi from '../../services/approvals/api';
import * as payslipsApi from '../../services/workbench/payslips';
import { nextUnreadPayslip, payslipReminderKey } from '../../services/workbench/payslipPrompt';
import * as noticesApi from '../../services/notices/api';
import type {
  ApprovalDecorated,
  Company,
  CurrentUser,
  Notice,
  QuickAction,
  TodayAttendance,
  TodoStats,
} from '../../types/models';
import { getCustomTabBar, type TapEvent } from '../../types/ui';
import { getGreeting } from '../../utils/util';
import { getCachedUser } from '../../utils/request';
import { getEntryDestination, ONBOARDING_REQUIRED } from '../../services/onboarding/onboardingGate';

/** 考勤状态 -> 标签样式 */
const ATT_STATUS_CLASS: Record<string, string> = {
  normal: 'tag-green',
  missing_in: 'tag-orange',
  missing_out: 'tag-orange',
  absent: 'tag-red',
  leave: 'tag-blue',
  rest: 'tag-gray',
};

interface IndexData {
  ready: boolean;
  gateError: boolean;
  greeting: string;
  user: CurrentUser;
  userInitial: string;
  company: Company;
  attendance: TodayAttendance & { statusClass: string };
  todo: TodoStats;
  actions: QuickAction[];
  pendingList: ApprovalDecorated[];
  noticeList: Notice[];
}

interface IndexCustom {
  gateTimer?: ReturnType<typeof setInterval>;
  reminderKeys?: Set<string>;
  reminderLoading?: boolean;
  reminderEpoch?: number;
  checkPayslips(): Promise<void>;
  checkAccess(): Promise<void>;
  checkPendingWhileVisible(): Promise<void>;
  loadAll(): Promise<void>;
  goAttendance(): void;
  goApproval(): void;
  goNotice(): void;
  goApprovalDetail(e: TapEvent): void;
  goNoticeDetail(e: TapEvent): void;
  onAction(e: TapEvent): void;
}

Page<IndexData, IndexCustom>({
  data: {
    ready: false, gateError: false,
    greeting: '',
    user: {} as CurrentUser,
    userInitial: '',
    company: {} as Company,
    attendance: {} as TodayAttendance & { statusClass: string },
    todo: {
      pending: 0,
      mine: 0,
      done: 0,
      unreadNotice: 0,
      attendance: {} as TodayAttendance,
    },
    actions: [],
    pendingList: [],
    noticeList: [],
  },

  onShow() {
    this.reminderKeys = new Set();
    this.reminderEpoch = (this.reminderEpoch || 0) + 1;
    if (this.gateTimer) clearInterval(this.gateTimer);
    this.setData({ ready: false, gateError: false });
    const tabBar = getCustomTabBar(this);
    if (tabBar) tabBar.setData({ hidden: true });
    void this.checkAccess();
  },

  onHide() { this.reminderEpoch = (this.reminderEpoch || 0) + 1; if (this.gateTimer) { clearInterval(this.gateTimer); this.gateTimer = undefined; } },
  onUnload() { this.reminderEpoch = (this.reminderEpoch || 0) + 1; if (this.gateTimer) { clearInterval(this.gateTimer); this.gateTimer = undefined; } },

  onPullDownRefresh() {
    if (!this.data.ready) { wx.stopPullDownRefresh(); return; }
    this.loadAll().finally(() => wx.stopPullDownRefresh());
  },

  async checkAccess() {
    this.setData({ gateError: false });
    try {
      const destination = await getEntryDestination();
      const pages = getCurrentPages();
      if (pages[pages.length - 1]?.route !== 'pages/index/index') return;
      if (destination === ONBOARDING_REQUIRED) { wx.reLaunch({ url: destination }); return; }
      if (destination !== '/pages/index/index') { wx.switchTab({ url: destination }); return; }
      this.setData({ ready: true }, () => {
        const tabBar = getCustomTabBar(this);
        if (tabBar) { tabBar.setData({ hidden: false, selected: 0 }); void tabBar.refreshBadge(); }
      });
      void this.loadAll();
      void this.checkPayslips();
      if (!this.gateTimer) this.gateTimer = setInterval(() => { void this.checkPendingWhileVisible(); }, 15000);
    } catch { this.setData({ gateError: true }); }
  },

  async checkPendingWhileVisible() {
    try {
      const destination = await getEntryDestination();
      const pages = getCurrentPages();
      if (destination === ONBOARDING_REQUIRED && pages[pages.length - 1]?.route === 'pages/index/index') {
        this.setData({ ready: false });
        const tabBar = getCustomTabBar(this); if (tabBar) tabBar.setData({ hidden: true });
        wx.reLaunch({ url: destination });
        return;
      }
      if (pages[pages.length - 1]?.route === 'pages/index/index' && this.data.ready) void this.checkPayslips();
    } catch { /* 网络暂时不可用时，下次重新检查 */ }
  },

  async checkPayslips() {
    if (this.reminderLoading || !this.data.ready) return;
    this.reminderLoading = true;
    const epoch = this.reminderEpoch;
    const employeeId = getCachedUser()?.id;
    try {
      const slips = await payslipsApi.listPayslips(true);
      const pages = getCurrentPages();
      if (epoch !== this.reminderEpoch || employeeId !== getCachedUser()?.id || pages[pages.length - 1]?.route !== 'pages/index/index' || !this.data.ready) return;
      const item = nextUnreadPayslip(slips, this.reminderKeys || new Set<string>());
      if (!item) return;
      this.reminderKeys?.add(payslipReminderKey(item));
      await new Promise<void>(resolve => wx.showModal({ title: '工资条', content: `您有一份 ${item.month} 的工资条`, confirmText: '查看', cancelText: '稍后', success: result => {
        void (async () => {
          if (result.confirm && epoch === this.reminderEpoch && employeeId === getCachedUser()?.id) {
            try { await payslipsApi.openPayslip(item); }
            catch (error) { wx.showToast({ title: (error as { message?: string }).message || '工资条打开失败', icon: 'none' }); }
          }
        })().finally(resolve);
      }, fail: () => resolve() }));
    } catch { /* 下次进入工作台或定时检查时重试 */ }
    finally { this.reminderLoading = false; }
  },

  async loadAll(): Promise<void> {
    try {
      const [user, company, attendance, todo, actions] = await Promise.all([
        authApi.getCurrentUser(),
        workbenchApi.getCompany(),
        attendanceApi.getTodayAttendance(),
        workbenchApi.getTodoStats(),
        workbenchApi.getQuickActions(),
      ]);

      this.setData({
        user,
        userInitial: user.name.slice(0, 1),
        company,
        attendance: {
          ...attendance,
          statusClass: ATT_STATUS_CLASS[attendance.status] || 'tag-gray',
        },
        todo,
        greeting: getGreeting(),
        actions,
      });

      const [pendingList, noticeList] = await Promise.all([
        approvalsApi.getApprovalList('pending'),
        noticesApi.getNotices({}),
      ]);
      this.setData({
        pendingList: pendingList.slice(0, 2),
        noticeList: noticeList.slice(0, 2),
      });
    } catch {
      // 请求层已统一提示，保留当前页面数据
    }
  },

  /* ---------------- 交互 ---------------- */

  goAttendance() {
    wx.navigateTo({ url: '/pages/attendance/attendance' });
  },

  goApproval() {
    wx.switchTab({ url: '/pages/approval/approval' });
  },

  goNotice() {
    wx.navigateTo({ url: '/pages/notice/notice' });
  },

  goApprovalDetail(e: TapEvent) {
    wx.navigateTo({ url: `/pages/approval-detail/approval-detail?id=${e.currentTarget.dataset.id}` });
  },

  goNoticeDetail(e: TapEvent) {
    wx.navigateTo({ url: `/pages/notice-detail/notice-detail?id=${e.currentTarget.dataset.id}` });
  },

  onAction(e: TapEvent) {
    const index = Number(e.currentTarget.dataset.index);
    const item = this.data.actions[index];
    if (!item) return;
    if (item.tab) {
      wx.switchTab({ url: item.url });
    } else {
      wx.navigateTo({ url: item.url });
    }
  },
});
