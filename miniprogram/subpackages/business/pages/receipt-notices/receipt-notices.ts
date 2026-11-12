import { getReceiptNotifications, type ReceiptNotificationSummary } from '../../../../services/business/api';
import { getCurrentUser } from '../../../../services/auth/api';
import type { TapEvent } from '../../../../types/ui';

interface Data { items: ReceiptNotificationSummary[]; page: number; more: boolean; loading: boolean; error: string }
interface Methods { load(reset?: boolean): Promise<void>; loadMore(): void; retry(): void; open(e: TapEvent): void; onPullDownRefresh(): void }

Page<Data, Methods>({
  data: { items: [], page: 1, more: false, loading: false, error: '' },

  onShow() {
    void getCurrentUser().then(user => {
      if (user.isChairperson || user.position !== '业务员') { wx.switchTab({ url: '/pages/index/index' }); return; }
      void this.load(true);
    }).catch(() => this.setData({ error: '无法确认账号权限，请重试' }));
  },

  async load(reset = false) {
    if (this.data.loading) return;
    const page = reset ? 1 : this.data.page + 1;
    this.setData({ loading: true, error: '' });
    try {
      const items = await getReceiptNotifications(page);
      this.setData({ items: reset ? items : [...this.data.items, ...items], page, more: items.length === 50 });
    } catch (error) {
      this.setData({ error: (error as { message?: string }).message || '加载失败，请重试' });
    } finally {
      this.setData({ loading: false });
    }
  },

  loadMore() {
    if (this.data.more) void this.load();
  },

  retry() {
    void this.load(true);
  },

  open(e: TapEvent) {
    const id = Number(e.currentTarget.dataset.id);
    if (!Number.isInteger(id) || id <= 0) return;
    wx.navigateTo({
      url: `/subpackages/business/pages/receipt-notice-detail/receipt-notice-detail?id=${id}`,
      fail: () => wx.showToast({ title: '打开失败，请重试', icon: 'none' }),
    });
  },

  onPullDownRefresh() {
    void this.load(true).finally(() => wx.stopPullDownRefresh());
  },
});
