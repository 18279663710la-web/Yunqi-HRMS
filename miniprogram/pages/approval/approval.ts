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

const PAGE_SIZE = 20;

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
  loadGeneration: number;
  page: number;
  hasMore: boolean;
  loadingMore: boolean;
  loadCounts(): Promise<void>;
  loadList(silent?: boolean): Promise<void>;
  loadMore(): Promise<void>;
  onTab(e: TapEvent): void;
  onReachBottom(): void;
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

  loadGeneration: 0,
  page: 1,
  hasMore: false,
  loadingMore: false,

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
    // 代际保护：快速切换页签时丢弃旧请求的响应，避免慢返回覆盖新页签数据
    const generation = ++this.loadGeneration;
    this.page = 1;
    this.hasMore = false;
    if (!silent) this.setData({ loading: true });
    try {
      const list = await approvalsApi.getApprovalList(this.data.activeTab, { page: 1, pageSize: PAGE_SIZE });
      if (generation !== this.loadGeneration) return;
      this.hasMore = list.length === PAGE_SIZE;
      this.setData({
        list: list.map((item) => ({ ...item, summary: item.summary.replace(/，补偿方式：加班费/g, ''), typeIcon: TYPE_ICON[item.type] || '审' })),
        loading: false,
      });
    } catch {
      if (generation !== this.loadGeneration) return;
      this.setData({ loading: false });
    }
  },

  onReachBottom() {
    if (this.loadingMore || !this.hasMore || this.data.loading) return;
    void this.loadMore();
  },

  async loadMore(): Promise<void> {
    if (this.loadingMore || !this.hasMore) return;
    const generation = this.loadGeneration;
    const page = this.page + 1;
    this.loadingMore = true;
    try {
      const list = await approvalsApi.getApprovalList(this.data.activeTab, { page, pageSize: PAGE_SIZE });
      if (generation !== this.loadGeneration) return;
      this.page = page;
      this.hasMore = list.length === PAGE_SIZE;
      this.setData({
        list: this.data.list.concat(list.map((item) => ({ ...item, summary: item.summary.replace(/，补偿方式：加班费/g, ''), typeIcon: TYPE_ICON[item.type] || '审' }))),
      });
    } catch {
      // 请求层已提示
    } finally {
      if (generation === this.loadGeneration) this.loadingMore = false;
    }
  },

  onTab(e: TapEvent) {
    const key = e.currentTarget.dataset.key as ApprovalTab;
    if (key === this.data.activeTab) return;
    this.hasMore = false;
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
