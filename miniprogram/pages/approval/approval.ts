import * as approvalsApi from '../../services/approvals/api';
import type { ApprovalListItem } from '../../types/models';
import { getCustomTabBar, type TapEvent } from '../../types/ui';

const TYPE_ICON: Record<string, string> = {
  leave: '休',
  expense: '¥',
  overtime: '加',
  travel: '差',
  purchase: '采',
};

type ApprovalTab = 'pending' | 'mine' | 'done';

interface ApprovalTabItem {
  key: ApprovalTab;
  name: string;
  count: number;
}

interface ApprovalData {
  tabs: ApprovalTabItem[];
  activeTab: ApprovalTab;
  list: ApprovalListItem[];
  loading: boolean;
}

interface ApprovalCustom {
  loadCounts(): Promise<void>;
  loadList(silent?: boolean): Promise<void>;
  onTab(e: TapEvent): void;
  goDetail(e: TapEvent): void;
  goCreate(): void;
}

Page<ApprovalData, ApprovalCustom>({
  data: {
    tabs: [
      { key: 'pending', name: '待我审批', count: 0 },
      { key: 'mine', name: '我发起的', count: 0 },
      { key: 'done', name: '已办结', count: 0 },
    ],
    activeTab: 'pending',
    list: [],
    loading: true,
  },

  onShow() {
    const tabBar = getCustomTabBar(this);
    if (tabBar) {
      tabBar.setData({ selected: 1 });
      tabBar.refreshBadge();
    }
    void this.loadCounts();
    void this.loadList();
  },

  onPullDownRefresh() {
    return Promise.all([this.loadCounts(), this.loadList(true)]).then(() => { wx.stopPullDownRefresh(); });
  },

  async loadCounts(): Promise<void> {
    try {
      const counts = await approvalsApi.getApprovalTabCounts();
      this.setData({
        tabs: [
          { key: 'pending', name: '待我审批', count: counts.pending },
          { key: 'mine', name: '我发起的', count: counts.mine },
          { key: 'done', name: '已办结', count: counts.done },
        ],
      });
    } catch {
      // 请求层已提示
    }
  },

  async loadList(silent = false): Promise<void> {
    if (!silent) this.setData({ loading: true });
    try {
      const list = await approvalsApi.getApprovalList(this.data.activeTab);
      this.setData({
        list: list.map((item) => ({ ...item, summary: item.summary.replace(/，补偿方式：加班费/g, ''), typeIcon: TYPE_ICON[item.type] || '审' })),
        loading: false,
      });
    } catch {
      this.setData({ loading: false });
    }
  },

  onTab(e: TapEvent) {
    const key = e.currentTarget.dataset.key as ApprovalTab;
    if (key === this.data.activeTab) return;
    this.setData({ activeTab: key, list: [] });
    void this.loadList();
  },

  goDetail(e: TapEvent) {
    wx.navigateTo({ url: `/pages/approval-detail/approval-detail?id=${e.currentTarget.dataset.id}` });
  },

  goCreate() {
    wx.navigateTo({ url: '/pages/approval-create/approval-create' });
  },
});
