import { getPendingCount } from '../services/approvals/api';
import { getCachedUser } from '../utils/request';
import type { TapEvent } from '../types/ui';
import { getCurrentUser } from '../services/auth/api';

const normalTabs: TabBarItem[] = [
  { pagePath: '/pages/index/index', text: '工作台', icon: 'grid' },
  { pagePath: '/pages/approval/approval', text: '审批', icon: 'approval' },
  { pagePath: '/pages/contacts/contacts', text: '通讯录', icon: 'contacts' },
  { pagePath: '/pages/mine/mine', text: '我的', icon: 'mine' },
];
const businessTab = { pagePath: '/subpackages/business/pages/index/index', text: '业务', icon: 'business' };

interface TabBarItem {
  pagePath: string;
  text: string;
  icon: string;
}

interface TabBarData {
  hidden: boolean;
  selected: number;
  badge: number;
  list: TabBarItem[];
}

type TabBarMethods = Record<string, Function> & {
  refreshBadge(): Promise<void>;
  onSwitch(e: TapEvent): void;
};

Component<TabBarData, Record<string, never>, TabBarMethods, never[]>({
  data: {
    hidden: false,
    selected: 0,
    badge: 0,
    list: normalTabs,
  },

  attached() {
    const pages = getCurrentPages();
    const page = pages[pages.length - 1];
    if (page?.route === 'subpackages/business/pages/index/index') this.setData({ selected: 4 });
    if (page?.route === 'pages/index/index') {
      const ready = (page.data as { ready?: boolean } | undefined)?.ready === true;
      this.setData({ hidden: !ready });
      if (!ready) return;
    }
    if (getCachedUser()?.isChairperson) {
      this.setData({ selected: 0, list: [{ pagePath: '/pages/approval/approval', text: '审批', icon: 'approval' }] });
    } else if (getCachedUser()?.position === '业务员') {
      this.setData({ list: [...normalTabs, businessTab], ...(page?.route === 'subpackages/business/pages/index/index' ? { selected: 4 } : {}) });
    }
    void this.refreshBadge();
  },

  methods: {
    /**
     * 刷新「审批」角标，页面 onShow 时会主动调用
     */
    async refreshBadge(): Promise<void> {
      try {
        const user = await getCurrentUser();
        const list = user.isChairperson ? [{ pagePath: '/pages/approval/approval', text: '审批', icon: 'approval' }]
          : user.position === '业务员' ? [...normalTabs, businessTab] : normalTabs;
        this.setData({ list });
      } catch { /* 保留上次导航状态，服务端仍会校验权限 */ }
      try {
        const badge = await getPendingCount();
        if (badge !== this.data.badge) {
          this.setData({ badge });
        }
      } catch {
        // 静默失败，不影响导航
      }
    },

    onSwitch(e: TapEvent) {
      const index = Number(e.currentTarget.dataset.index);
      const path = String(e.currentTarget.dataset.path || '');
      if (index === this.data.selected || !path) return;
      if (path === businessTab.pagePath) wx.navigateTo({ url: path, fail: () => wx.showToast({ title: '业务模块打开失败，请重试', icon: 'none' }) });
      else { wx.switchTab({ url: path }); this.setData({ selected: index }); }
    },
  },
});
