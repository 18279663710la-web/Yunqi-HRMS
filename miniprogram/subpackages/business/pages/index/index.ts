import { get, getCachedUser } from '../../../../utils/request';
import { downloadBusinessPdf } from '../../../../utils/request';
import { getCurrentUser } from '../../../../services/auth/api';
import type { PickerEvent, TapEvent } from '../../../../types/ui';

type Kind = 'receivables' | 'receipts' | 'summary';
interface Document { id: string; docNo: string; date: string; customer: string; amount: string; currency: string }
interface Data { kind: Kind; items: Document[]; page: number; more: boolean; loading: boolean; opening: boolean; error: string; from: string; to: string }
interface Methods {
  load(reset?: boolean): Promise<void>;
  selectKind(e: TapEvent): void;
  loadMore(): void;
  changeFrom(e: PickerEvent): void;
  changeTo(e: PickerEvent): void;
  openDocument(e: TapEvent): void;
  openSummary(): void;
  download(url: string): void;
}
const today = new Date();
const period = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
const first = `${today.getFullYear()}-01`;

Page<Data, Methods>({
  data: { kind: 'receivables', items: [], page: 1, more: false, loading: false, opening: false, error: '', from: first, to: period },
  onShow() {
    void getCurrentUser().then(user => {
      if (user.isChairperson || user.position !== '业务员') { wx.switchTab({ url: '/pages/index/index' }); return; }
      void this.load(true);
    }).catch(() => this.setData({ error: '无法确认账号权限，请重试' }));
  },
  async load(reset = false) {
    if (this.data.loading || this.data.kind === 'summary') return;
    const kind = this.data.kind;
    const page = reset ? 1 : this.data.page + 1;
    this.setData({ loading: true, error: '' });
    try {
      const items = await get<Document[]>(`/business/${kind}?page=${page}`);
      if (kind === this.data.kind) this.setData({ items: reset ? items : [...this.data.items, ...items], page, more: items.length === 50 });
    } catch (error) { this.setData({ error: (error as { message?: string }).message || '加载失败，请重试' }); }
    finally { this.setData({ loading: false }); }
  },
  selectKind(e) {
    const kind = String(e.currentTarget.dataset.kind) as Kind;
    if (!['receivables', 'receipts', 'summary'].includes(kind) || kind === this.data.kind || this.data.loading) return;
    this.setData({ kind, items: [], page: 1, more: false, error: '' });
    if (kind !== 'summary') void this.load(true);
  },
  loadMore() { if (this.data.more) void this.load(); },
  changeFrom(e) { this.setData({ from: String(e.detail.value) }); },
  changeTo(e) { this.setData({ to: String(e.detail.value) }); },
  openDocument(e) {
    const id = String(e.currentTarget.dataset.id || '');
    if (!/^\d+$/.test(id) || this.data.kind === 'summary') return;
    this.download(`/business/${this.data.kind}/${id}/pdf`);
  },
  openSummary() {
    if (this.data.from > this.data.to) { wx.showToast({ title: '请选择有效的期间', icon: 'none' }); return; }
    this.download(`/business/summary/pdf?from=${this.data.from}&to=${this.data.to}`);
  },
  download(url) {
    if (this.data.opening) return;
    const employeeId = getCachedUser()?.id;
    if (!employeeId) { wx.showToast({ title: '请重新登录', icon: 'none' }); return; }
    this.setData({ opening: true });
    void downloadBusinessPdf(url).then(filePath => {
      if (getCachedUser()?.id !== employeeId) throw { message: '登录账号已变更，请重试' };
      return new Promise<void>((resolve, reject) => wx.openDocument({ filePath, fileType: 'pdf', showMenu: true, success: () => resolve(), fail: reject }));
    })
      .catch((error: { message?: string }) => wx.showToast({ title: error.message || '打开失败，请重试', icon: 'none' }))
      .finally(() => this.setData({ opening: false }));
  },
});
