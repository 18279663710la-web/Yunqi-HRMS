import { listPayslips, openPayslip, type Payslip } from '../../services/workbench/payslips';
import type { TapEvent } from '../../types/ui';

interface Data { items: Payslip[]; loading: boolean; error: boolean; opening: boolean }
interface Custom { load(): Promise<void>; open(e: TapEvent): void }
Page<Data, Custom>({
  data: { items: [], loading: false, error: false, opening: false },
  onShow() { void this.load(); },
  onPullDownRefresh() { this.load().finally(() => wx.stopPullDownRefresh()); },
  async load() {
    this.setData({ loading: true, error: false });
    try { this.setData({ items: await listPayslips() }); }
    catch { this.setData({ error: true }); }
    finally { this.setData({ loading: false }); }
  },
  open(e: TapEvent) {
    if (this.data.opening) return;
    const item = this.data.items.find(row => row.id === Number(e.currentTarget.dataset.id));
    if (!item) return;
    this.setData({ opening: true });
    void openPayslip(item).then(() => this.load()).catch((error: { message?: string }) => wx.showToast({ title: error.message || '工资条打开失败', icon: 'none' })).finally(() => this.setData({ opening: false }));
  },
});
