import { downloadBusinessPdf, get, getCachedUser } from '../../../../utils/request';
import { getCurrentUser } from '../../../../services/auth/api';
import { getReceiptNotificationUnreadCount, getReceiptCustomers, getReceivableCustomers, type ReceivableCustomer } from '../../../../services/business/api';
import type { InputEvent, PickerEvent, TapEvent } from '../../../../types/ui';

type Kind = 'receivables' | 'receipts' | 'summary';
interface ReceiptDocument { id: string; docNo: string; date: string; customer: string; amount: string; currency: string }
interface ReceivableLine {
  lineNum: number; itemName: string; itemCode: string; uom: string; qty: string;
  nonTaxPrice: string; taxPrice: string; nonTaxAmount: string; taxAmount: string;
  taxIncludedTotal: string; totalAmount: string; totalBalance: string;
  bizOrg: string; maturity: string | null; lineStatus: string;
}
interface ReceivableDocument {
  id: string; docNo: string; customer: string; businessDate: string; postPeriod: string;
  srcOrg: string; invoiceDate: string | null; invoiceNum: string; lines: ReceivableLine[];
}
interface ReceivableFilters { period?: string; customerId?: string; customerKeyword?: string }
type DocumentItem = ReceiptDocument | ReceivableDocument;
interface Data {
  kind: Kind; items: DocumentItem[]; page: number; more: boolean; loading: boolean; opening: boolean;
  error: string; from: string; to: string; unread: number; userId: string;
  receivablePeriod: string; customerKeyword: string; customerId?: string; suggestions: ReceivableCustomer[];
  suggestionOpen: boolean; queried: boolean; activeFilters: ReceivableFilters | null;
  customerPool: ReceivableCustomer[]; poolKey: string; poolLoading: boolean;
}
interface Methods {
  load(reset?: boolean, filters?: ReceivableFilters): Promise<void>;
  loadUnread(): Promise<void>;
  ensurePool(): Promise<void>;
  applySuggestions(): void;
  onCustomerInput(e: InputEvent): void;
  onCustomerFocus(): void;
  onCustomerBlur(): void;
  clearCustomer(): void;
  selectCustomer(e: TapEvent): void;
  changeReceivablePeriod(e: PickerEvent): void;
  clearReceivablePeriod(): void;
  queryDocuments(): void;
  selectKind(e: TapEvent): void;
  loadMore(): void;
  changeFrom(e: PickerEvent): void;
  openDocument(e: TapEvent): void;
  openSummary(): void;
  openNotifications(): void;
  download(url: string): void;
}
const today = new Date();
function currentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}
const period = currentMonth();
const first = `${today.getFullYear()}-01`;
const defaultReceivablePeriod = (() => {
  const now = new Date();
  const date = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
})();

Page<Data, Methods>({
  data: {
    kind: 'receivables', items: [], page: 1, more: false, loading: false, opening: false, error: '',
    from: first, to: period, unread: 0, userId: '',
    receivablePeriod: '', customerKeyword: '', customerId: undefined,
    suggestions: [], suggestionOpen: false, queried: false, activeFilters: null,
    customerPool: [], poolKey: '', poolLoading: false,
  },

  onShow() {
    void getCurrentUser().then(user => {
      if (user.isChairperson || user.position !== '业务员') { wx.switchTab({ url: '/pages/index/index' }); return; }
      const kind = this.data.kind;
      const changed = !!this.data.userId && this.data.userId !== user.id;
      this.setData(changed ? {
        userId: user.id, items: [], page: 1, more: false, error: '', queried: false, activeFilters: null,
        customerKeyword: '', customerId: undefined, suggestions: [], suggestionOpen: false,
        customerPool: [], poolKey: '',
      } : { userId: user.id });
      if (kind === 'receipts') void this.loadUnread();
    }).catch(() => this.setData({ error: '无法确认账号权限，请重试' }));
  },

  async loadUnread() {
    try {
      const { count } = await getReceiptNotificationUnreadCount();
      this.setData({ unread: Number(count) || 0 });
    } catch {
      // 未读数失败不影响单据列表
    }
  },

  async load(reset = false, filters?: ReceivableFilters) {
    if (this.data.loading || this.data.kind === 'summary') return;
    const kind = this.data.kind;
    const page = reset ? 1 : this.data.page + 1;
    const active = filters || this.data.activeFilters;
    if (!active) return;
    this.setData({ loading: true, error: '' });
    try {
      const query = active as ReceivableFilters;
      const params: Record<string, string | number> = { page };
      if (query.period) params.period = query.period;
      if (query.customerId) params.customerId = query.customerId;
      else if (query.customerKeyword) params.customerKeyword = query.customerKeyword;
      const items = await get<DocumentItem[]>(`/business/${kind}`, params);
      if (kind === this.data.kind) this.setData({ items: reset ? items : [...this.data.items, ...items], page, more: items.length === 50 });
    } catch (error) { this.setData({ error: (error as { message?: string }).message || '加载失败，请重试' }); }
    finally { this.setData({ loading: false }); }
  },

  /** 拉取本人客户池（每个单据类型+期间一份，服务端缓存 5 分钟）；输入时全部在本地过滤，零网络延迟。 */
  async ensurePool() {
    const kind = this.data.kind;
    const period = this.data.receivablePeriod;
    const key = `${kind}:${period}`;
    if (this.data.poolKey === key && this.data.customerPool.length) return;
    if (this.data.poolLoading) return;
    this.setData({ poolLoading: true, poolKey: key, customerPool: [] });
    try {
      const pool = kind === 'receipts'
        ? await getReceiptCustomers(period)
        : await getReceivableCustomers(period);
      if (this.data.poolKey === `${this.data.kind}:${this.data.receivablePeriod}`) this.setData({ customerPool: pool });
    } catch {
      // 拉取失败时保留空池，用户仍可继续输入，下次聚焦重试
    } finally {
      this.setData({ poolLoading: false });
    }
    this.applySuggestions();
  },

  /** 本地过滤：客户名称、拼音首字母（dg）、全拼（dongguan）均命中。 */
  applySuggestions() {
    const keyword = this.data.customerKeyword.trim().toLowerCase();
    if (!keyword) { this.setData({ suggestions: [] }); return; }
    const suggestions = this.data.customerPool
      .filter(item => item.name.toLowerCase().includes(keyword)
        || item.initials.includes(keyword)
        || item.fullPinyin.includes(keyword))
      .slice(0, 20);
    this.setData({ suggestions });
  },

  onCustomerInput(e) {
    const keyword = String(e.detail.value || '');
    this.setData({ customerKeyword: keyword, customerId: undefined, suggestionOpen: true });
    this.applySuggestions();
    void this.ensurePool();
  },

  onCustomerFocus() {
    this.setData({ suggestionOpen: true });
    void this.ensurePool();
    this.applySuggestions();
  },

  onCustomerBlur() {
    setTimeout(() => this.setData({ suggestionOpen: false }), 150);
  },

  clearCustomer() {
    this.setData({ customerKeyword: '', customerId: undefined, suggestions: [], suggestionOpen: false });
  },

  selectCustomer(e) {
    const id = String(e.currentTarget.dataset.id || '');
    const name = String(e.currentTarget.dataset.name || '');
    if (!id) return;
    this.setData({ customerId: id, customerKeyword: name, suggestions: [], suggestionOpen: false });
  },

  changeReceivablePeriod(e) {
    this.setData({ receivablePeriod: String(e.detail.value), suggestions: [], customerPool: [], poolKey: '' });
    void this.ensurePool();
    this.applySuggestions();
  },

  clearReceivablePeriod() {
    this.setData({ receivablePeriod: '', suggestions: [], customerPool: [], poolKey: '' });
    void this.ensurePool();
    this.applySuggestions();
  },

  queryDocuments() {
    if (this.data.loading) return;
    const keyword = this.data.customerKeyword.trim();
    const customerId = this.data.customerId;
    let period = this.data.receivablePeriod;
    if (!period && !customerId && !keyword) period = defaultReceivablePeriod;
    const filters: ReceivableFilters = {};
    if (period) filters.period = period;
    if (customerId) filters.customerId = customerId;
    else if (keyword) filters.customerKeyword = keyword;
    this.setData({ queried: true, activeFilters: filters, receivablePeriod: period, suggestionOpen: false, suggestions: [], page: 1, items: [], more: false, error: '' });
    void this.load(true, filters);
  },

  selectKind(e) {
    const kind = String(e.currentTarget.dataset.kind) as Kind;
    if (!['receivables', 'receipts', 'summary'].includes(kind) || kind === this.data.kind || this.data.loading) return;
    this.setData({
      kind, items: [], page: 1, more: false, error: '', queried: false, activeFilters: null,
      customerKeyword: '', customerId: undefined, suggestions: [], suggestionOpen: false,
      customerPool: [], poolKey: '',
    });
    if (kind === 'receipts') void this.loadUnread();
  },

  loadMore() { if (this.data.more) void this.load(false, this.data.activeFilters || undefined); },

  changeFrom(e) { this.setData({ from: String(e.detail.value) }); },

  openDocument(e) {
    const id = String(e.currentTarget.dataset.id || '');
    if (!/^\d+$/.test(id) || this.data.kind === 'summary') return;
    if (this.data.kind === 'receivables') {
      wx.navigateTo({
        url: `/subpackages/business/pages/detail/detail?id=${id}`,
        fail: () => wx.showToast({ title: '打开失败，请重试', icon: 'none' }),
      });
      return;
    }
    this.download(`/business/receipts/${id}/pdf`);
  },

  openSummary() {
    const to = currentMonth();
    this.setData({ to });
    if (this.data.from > to) { wx.showToast({ title: '请选择有效的期间', icon: 'none' }); return; }
    this.download(`/business/summary/pdf?from=${this.data.from}`);
  },

  openNotifications() {
    wx.navigateTo({
      url: '/subpackages/business/pages/receipt-notices/receipt-notices',
      fail: () => wx.showToast({ title: '打开失败，请重试', icon: 'none' }),
    });
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
