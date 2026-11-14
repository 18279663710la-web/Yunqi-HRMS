import { getReceiptNotification, markReceiptNotificationRead, type ReceiptNotificationDetail } from '../../../../services/business/api';
import { getCurrentUser } from '../../../../services/auth/api';

interface Data { id: number; detail: ReceiptNotificationDetail | null; loading: boolean; error: string }
interface Methods { load(): Promise<void>; retry(): void }

Page<Data, Methods>({
  data: { id: 0, detail: null, loading: true, error: '' },

  onLoad(options: Record<string, string | undefined>) {
    const id = Number(options.id || '');
    if (!Number.isInteger(id) || id <= 0) {
      this.setData({ loading: false, error: '通知参数无效' });
      return;
    }
    this.setData({ id });
    void getCurrentUser().then(user => {
      if (user.position !== '业务员') { wx.switchTab({ url: '/pages/index/index' }); return; }
      void this.load();
    }).catch(() => this.setData({ loading: false, error: '无法确认账号权限，请重试' }));
  },

  async load() {
    if (!this.data.id) return;
    this.setData({ loading: true, error: '' });
    try {
      const detail = await getReceiptNotification(this.data.id);
      this.setData({ detail });
      void markReceiptNotificationRead(this.data.id).catch(() => undefined);
    } catch (error) {
      this.setData({ error: (error as { message?: string }).message || '加载失败，请重试' });
    } finally {
      this.setData({ loading: false });
    }
  },

  retry() {
    void this.load();
  },
});
